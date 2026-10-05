import { and, eq, isNull } from "drizzle-orm";
import { db, plantsTable, plantPlacesTable, savedLocationsTable, usersTable } from "@workspace/db";

/** Additive, repeatable backfill. Never deletes or replaces existing user selections. */
export async function migrateLegacyLocations() {
  const users = await db.select().from(usersTable);
  for (const user of users) {
    await db.transaction(async (tx) => {
      const existingDefault = await tx.select().from(savedLocationsTable).where(and(eq(savedLocationsTable.userId, user.id), eq(savedLocationsTable.isDefault, true))).limit(1);
      if (!existingDefault.length && user.weatherLatitude !== null && user.weatherLongitude !== null) {
        await tx.insert(savedLocationsTable).values({
          userId: user.id, displayName: user.weatherLocationName,
          latitude: user.weatherLatitude, longitude: user.weatherLongitude, isDefault: true,
        }).onConflictDoNothing();
        const [location] = await tx.select().from(savedLocationsTable).where(and(eq(savedLocationsTable.userId, user.id), eq(savedLocationsTable.latitude, user.weatherLatitude), eq(savedLocationsTable.longitude, user.weatherLongitude)));
        if (location) await tx.update(savedLocationsTable).set({ isDefault: true }).where(eq(savedLocationsTable.id, location.id));
      }
      const plants = await tx.select().from(plantsTable).where(eq(plantsTable.userId, user.id));
      for (const plant of plants) {
        if (plant.placeId === null) {
          await tx.insert(plantPlacesTable).values({ userId: user.id, name: plant.location, environmentType: plant.environmentType }).onConflictDoNothing();
          const [place] = await tx.select().from(plantPlacesTable).where(and(eq(plantPlacesTable.userId, user.id), eq(plantPlacesTable.name, plant.location), eq(plantPlacesTable.environmentType, plant.environmentType)));
          if (place) await tx.update(plantsTable).set({ placeId: place.id }).where(and(eq(plantsTable.id, plant.id), isNull(plantsTable.placeId)));
        }
        if (plant.weatherLocationId === null && plant.weatherLocationName && plant.weatherLatitude !== null && plant.weatherLongitude !== null) {
          await tx.insert(savedLocationsTable).values({ userId: user.id, displayName: plant.weatherLocationName, latitude: plant.weatherLatitude, longitude: plant.weatherLongitude }).onConflictDoNothing();
          const [location] = await tx.select().from(savedLocationsTable).where(and(eq(savedLocationsTable.userId, user.id), eq(savedLocationsTable.latitude, plant.weatherLatitude), eq(savedLocationsTable.longitude, plant.weatherLongitude)));
          if (location) await tx.update(plantsTable).set({ weatherLocationId: location.id }).where(and(eq(plantsTable.id, plant.id), isNull(plantsTable.weatherLocationId)));
        }
      }
    });
  }
}
