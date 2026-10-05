import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db, plantPlacesTable, plantsTable, savedLocationsTable, usersTable } from "@workspace/db";
import { currentUser } from "./flora";

const router: IRouter = Router();
const placeInput = z.object({ name: z.string().trim().min(1).max(120), environmentType: z.enum(["INDOOR", "BALCONY", "OUTDOOR", "GREENHOUSE"]) });
const locationInput = z.object({ displayName: z.string().trim().min(1).max(500), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), isDefault: z.boolean().optional() });
const mapLocation = (row: typeof savedLocationsTable.$inferSelect) => ({ ...row, latitude: Number(row.latitude), longitude: Number(row.longitude), lastUsedAt: row.lastUsedAt.toISOString() });

router.get("/places", async (req, res) => {
  const user = await currentUser(req);
  if (!user) { res.status(401).json({ error: "Необхідно увійти" }); return; }
  res.json(await db.select().from(plantPlacesTable).where(eq(plantPlacesTable.userId, user.id)).orderBy(plantPlacesTable.name));
});
router.post("/places", async (req, res) => {
  const user = await currentUser(req);
  if (!user) { res.status(401).json({ error: "Необхідно увійти" }); return; }
  const parsed = placeInput.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Вкажіть назву місця та середовище" }); return; }
  await db.insert(plantPlacesTable).values({ ...parsed.data, userId: user.id }).onConflictDoNothing();
  const [place] = await db.select().from(plantPlacesTable).where(and(eq(plantPlacesTable.userId, user.id), eq(plantPlacesTable.name, parsed.data.name), eq(plantPlacesTable.environmentType, parsed.data.environmentType)));
  res.status(201).json(place);
});
router.patch("/places/:id", async (req, res) => {
  const user = await currentUser(req);
  if (!user) { res.status(401).json({ error: "Необхідно увійти" }); return; }
  const parsed = placeInput.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Вкажіть назву місця та середовище" }); return; }
  const [existing] = await db.select().from(plantPlacesTable).where(and(eq(plantPlacesTable.id, Number(req.params.id)), eq(plantPlacesTable.userId, user.id)));
  if (!existing) { res.status(404).json({ error: "Місце не знайдено" }); return; }
  const [duplicate] = await db.select().from(plantPlacesTable).where(and(eq(plantPlacesTable.userId, user.id), eq(plantPlacesTable.name, parsed.data.name), eq(plantPlacesTable.environmentType, parsed.data.environmentType)));
  if (duplicate && duplicate.id !== existing.id) { res.status(409).json({ error: "Таке місце вже збережено" }); return; }
  const place = await db.transaction(async tx => {
    const [updated] = await tx.update(plantPlacesTable).set(parsed.data).where(eq(plantPlacesTable.id, existing.id)).returning();
    await tx.update(plantsTable).set({ location: updated.name, environmentType: updated.environmentType }).where(and(eq(plantsTable.placeId, existing.id), eq(plantsTable.userId, user.id)));
    return updated;
  });
  res.json(place);
});
router.delete("/places/:id", async (req, res) => {
  const user = await currentUser(req);
  if (!user) { res.status(401).json({ error: "Необхідно увійти" }); return; }
  const [place] = await db.select().from(plantPlacesTable).where(and(eq(plantPlacesTable.id, Number(req.params.id)), eq(plantPlacesTable.userId, user.id)));
  if (!place) { res.status(404).json({ error: "Місце не знайдено" }); return; }
  const [used] = await db.select().from(plantsTable).where(eq(plantsTable.placeId, place.id)).limit(1);
  if (used) { res.status(409).json({ error: "Спочатку змініть місце рослин, які його використовують" }); return; }
  await db.delete(plantPlacesTable).where(eq(plantPlacesTable.id, place.id));
  res.sendStatus(204);
});
router.get("/locations", async (req, res) => {
  const user = await currentUser(req);
  if (!user) { res.status(401).json({ error: "Необхідно увійти" }); return; }
  const rows = await db.select().from(savedLocationsTable).where(eq(savedLocationsTable.userId, user.id)).orderBy(desc(savedLocationsTable.isDefault), desc(savedLocationsTable.lastUsedAt));
  res.json(rows.map(mapLocation));
});
router.post("/locations", async (req, res) => {
  const user = await currentUser(req);
  if (!user) { res.status(401).json({ error: "Необхідно увійти" }); return; }
  const parsed = locationInput.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Оберіть коректну локацію з результатів пошуку" }); return; }
  const location = await db.transaction(async tx => {
    // Serialize default changes for a single owner across simultaneous requests.
    await tx.select().from(usersTable).where(eq(usersTable.id, user.id)).for("update");
    const [defaultLocation] = await tx.select().from(savedLocationsTable).where(and(eq(savedLocationsTable.userId, user.id), eq(savedLocationsTable.isDefault, true)));
    const isDefault = parsed.data.isDefault ?? !defaultLocation;
    if (isDefault) await tx.update(savedLocationsTable).set({ isDefault: false }).where(eq(savedLocationsTable.userId, user.id));
    const values = { userId: user.id, displayName: parsed.data.displayName, latitude: String(parsed.data.latitude), longitude: String(parsed.data.longitude), lastUsedAt: new Date(), isDefault };
    const [row] = await tx.insert(savedLocationsTable).values(values).onConflictDoUpdate({ target: [savedLocationsTable.userId, savedLocationsTable.latitude, savedLocationsTable.longitude], set: { displayName: values.displayName, lastUsedAt: values.lastUsedAt, ...(isDefault ? { isDefault: true } : {}) } }).returning();
    if (row.isDefault) await tx.update(usersTable).set({ weatherLocationName: row.displayName, weatherLatitude: row.latitude, weatherLongitude: row.longitude }).where(eq(usersTable.id, user.id));
    return row;
  });
  res.status(201).json(mapLocation(location));
});
router.patch("/locations/:id", async (req, res) => {
  const user = await currentUser(req);
  if (!user) { res.status(401).json({ error: "Необхідно увійти" }); return; }
  const parsed = locationInput.pick({ displayName: true, isDefault: true }).partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Некоректні дані локації" }); return; }
  const [existing] = await db.select().from(savedLocationsTable).where(and(eq(savedLocationsTable.id, Number(req.params.id)), eq(savedLocationsTable.userId, user.id)));
  if (!existing) { res.status(404).json({ error: "Локацію не знайдено" }); return; }
  const row = await db.transaction(async tx => {
    await tx.select().from(usersTable).where(eq(usersTable.id, user.id)).for("update");
    if (parsed.data.isDefault) await tx.update(savedLocationsTable).set({ isDefault: false }).where(eq(savedLocationsTable.userId, user.id));
    const [updated] = await tx.update(savedLocationsTable).set({ ...parsed.data, lastUsedAt: new Date() }).where(eq(savedLocationsTable.id, existing.id)).returning();
    if (updated.isDefault) await tx.update(usersTable).set({ weatherLocationName: updated.displayName, weatherLatitude: updated.latitude, weatherLongitude: updated.longitude }).where(eq(usersTable.id, user.id));
    else if (existing.isDefault) await tx.update(usersTable).set({ weatherLocationName: "Ваш регіон", weatherLatitude: null, weatherLongitude: null }).where(eq(usersTable.id, user.id));
    return updated;
  });
  res.json(mapLocation(row));
});
router.delete("/locations/:id", async (req, res) => {
  const user = await currentUser(req);
  if (!user) { res.status(401).json({ error: "Необхідно увійти" }); return; }
  const [location] = await db.select().from(savedLocationsTable).where(and(eq(savedLocationsTable.id, Number(req.params.id)), eq(savedLocationsTable.userId, user.id)));
  if (!location) { res.status(404).json({ error: "Локацію не знайдено" }); return; }
  const [used] = await db.select().from(plantsTable).where(eq(plantsTable.weatherLocationId, location.id)).limit(1);
  if (used) { res.status(409).json({ error: "Спочатку змініть погодну локацію рослин, які її використовують" }); return; }
  await db.transaction(async tx => {
    await tx.select().from(usersTable).where(eq(usersTable.id, user.id)).for("update");
    await tx.delete(savedLocationsTable).where(eq(savedLocationsTable.id, location.id));
    if (location.isDefault) await tx.update(usersTable).set({ weatherLocationName: "Ваш регіон", weatherLatitude: null, weatherLongitude: null }).where(eq(usersTable.id, user.id));
  });
  res.sendStatus(204);
});

type Suggestion = { displayName: string; latitude: number; longitude: number };
const cache = new Map<string, { expires: number; items: Suggestion[] }>();
let queue: Promise<unknown> = Promise.resolve();
let pending = 0;
let lastRequest = 0;
router.get("/locations/search", async (req, res) => {
  const user = await currentUser(req);
  if (!user) { res.status(401).json({ error: "Необхідно увійти" }); return; }
  const parsed = z.string().trim().min(3).max(100).safeParse(req.query.q);
  if (!parsed.success) { res.status(400).json({ error: "Введіть щонайменше 3 символи назви населеного пункту" }); return; }
  const key = parsed.data.toLocaleLowerCase("uk");
  const found = cache.get(key);
  if (found && found.expires > Date.now()) { res.json(found.items); return; }
  if (pending >= 5) { res.status(429).json({ error: "Пошук зайнятий. Спробуйте за кілька секунд" }); return; }
  pending++;
  const search = queue.then(async () => {
    await new Promise(resolve => setTimeout(resolve, Math.max(0, 1100 - (Date.now() - lastRequest))));
    lastRequest = Date.now();
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.search = new URLSearchParams({ q: parsed.data, format: "jsonv2", limit: "6", "accept-language": "uk" }).toString();
    const response = await fetch(url, { headers: { "User-Agent": "FloraWise/1.0 settlement-search" }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error("Geocoding unavailable");
    const rows = z.array(z.object({ display_name: z.string(), lat: z.string(), lon: z.string() })).parse(await response.json());
    const items = rows.map(row => ({ displayName: row.display_name, latitude: Number(row.lat), longitude: Number(row.lon) })).filter(row => Number.isFinite(row.latitude) && Number.isFinite(row.longitude));
    if (cache.size >= 200) cache.delete(cache.keys().next().value!);
    cache.set(key, { expires: Date.now() + 3600000, items });
    return items;
  });
  queue = search.catch(() => undefined);
  try { res.json(await search); }
  catch { res.status(503).json({ error: "Сервіс пошуку локацій тимчасово недоступний. Спробуйте пізніше або використайте вже збережену локацію" }); }
  finally { pending--; }
});

export default router;
