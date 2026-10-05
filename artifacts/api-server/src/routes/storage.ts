import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { eq } from "drizzle-orm";
import { db, plantPhotosTable } from "@workspace/db";
import { RequestPhotoUploadBody, CompletePhotoUploadBody } from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError, objectStorageClient } from "../lib/objectStorage";
import { setObjectAclPolicy } from "../lib/objectAcl";
import { ownedPhoto } from "../lib/plant-photos";
import { MAX_PHOTO_SIZE, matchesPhotoType } from "../lib/photo-validation";

const router: IRouter = Router();
const storage = new ObjectStorageService();

// No demo identity fallback: private files always require a real Clerk session.
router.use("/storage", (req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  if (!getAuth(req).userId) { res.status(401).json({ error: "Увійдіть, щоб завантажити або переглянути приватне фото." }); return; }
  next();
});

router.post("/storage/uploads/request-url", async (req, res) => {
  const parsed = RequestPhotoUploadBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Оберіть JPEG, PNG або WebP розміром до 5 МБ." }); return; }
  try {
    const uploadURL = await storage.getObjectEntityUploadURL();
    const objectPath = `/objects/photos/${randomUUID()}`;
    await db.insert(plantPhotosTable).values({
      objectPath, uploadPath: storage.normalizeObjectEntityPath(uploadURL),
      clerkUserId: getAuth(req).userId!, ...parsed.data,
    });
    res.json({ uploadURL, objectPath });
  } catch {
    req.log.error("Photo upload URL unavailable");
    res.status(503).json({ error: "Не вдалося підготувати завантаження фото. Спробуйте ще раз." });
  }
});

router.post("/storage/uploads/complete", async (req, res) => {
  const parsed = CompletePhotoUploadBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Некоректний шлях фото." }); return; }
  const userId = getAuth(req).userId!;
  const photo = await ownedPhoto(parsed.data.objectPath, userId);
  if (!photo) { res.status(404).json({ error: "Фото не знайдено." }); return; }
  if (photo.ready) { res.json({ objectPath: photo.objectPath }); return; }
  try {
    const source = await storage.getObjectEntityFile(photo.uploadPath);
    const [metadata] = await source.getMetadata();
    // Read a fixed generation so a still-valid PUT URL cannot change the verified file.
    const version = source.bucket.file(source.name, { generation: metadata.generation });
    if (Number(metadata.size) !== photo.size || Number(metadata.size) > MAX_PHOTO_SIZE || metadata.contentType !== photo.contentType) {
      res.status(400).json({ error: "Розмір або тип завантаженого фото не відповідає вибраному файлу." }); return;
    }
    const [header] = await version.download({ start: 0, end: 15 });
    if (!matchesPhotoType(header, photo.contentType)) {
      res.status(400).json({ error: "Файл не є зображенням JPEG, PNG або WebP." }); return;
    }
    const fullPath = `${storage.getPrivateObjectDir().replace(/\/$/, "")}/${photo.objectPath.slice("/objects/".length)}`;
    const [, bucket, ...parts] = fullPath.split("/");
    const destination = objectStorageClient.bucket(bucket).file(parts.join("/"));
    // Final photo is immutable and has no PUT URL. Concurrent completion is safe.
    try { await version.copy(destination, { preconditionOpts: { ifGenerationMatch: 0 } }); }
    catch (error) { if ((error as { code?: number }).code !== 412) throw error; }
    await setObjectAclPolicy(destination, { owner: userId, visibility: "private" });
    await db.update(plantPhotosTable).set({ ready: true }).where(eq(plantPhotosTable.objectPath, photo.objectPath));
    res.json({ objectPath: photo.objectPath });
  } catch (error) {
    if (error instanceof ObjectNotFoundError) { res.status(400).json({ error: "Фото ще не завантажено. Спробуйте ще раз." }); return; }
    req.log.error("Photo finalization failed");
    res.status(503).json({ error: "Не вдалося перевірити й зберегти фото. Спробуйте ще раз." });
  }
});

router.get("/storage/objects/photos/:id", async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  const objectPath = `/objects/photos/${req.params.id}`;
  const userId = getAuth(req).userId!;
  const photo = await ownedPhoto(objectPath, userId);
  if (!photo?.ready) { res.status(404).json({ error: "Фото не знайдено." }); return; }
  try {
    const file = await storage.getObjectEntityFile(objectPath);
    if (!await storage.canAccessObjectEntity({ userId, objectFile: file })) {
      res.status(404).json({ error: "Фото не знайдено." }); return;
    }
    res.setHeader("Content-Type", photo.contentType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Length", photo.size);
    await pipeline(file.createReadStream(), res);
  } catch (error) {
    if (res.headersSent) { res.destroy(); return; }
    res.status(error instanceof ObjectNotFoundError ? 404 : 503).json({ error: "Не вдалося отримати фото." });
  }
});

export default router;
