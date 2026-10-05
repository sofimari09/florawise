import { and, eq } from "drizzle-orm";
import { db, plantPhotosTable } from "@workspace/db";

export async function ownedPhoto(objectPath: string, clerkUserId: string) {
  const [photo] = await db.select().from(plantPhotosTable).where(and(
    eq(plantPhotosTable.objectPath, objectPath),
    eq(plantPhotosTable.clerkUserId, clerkUserId),
  )).limit(1);
  return photo;
}

export async function canAttachPhoto(objectPath: string | null | undefined, clerkUserId: string | null) {
  if (!objectPath) return true;
  if (!clerkUserId) return false;
  return Boolean((await ownedPhoto(objectPath, clerkUserId))?.ready);
}
