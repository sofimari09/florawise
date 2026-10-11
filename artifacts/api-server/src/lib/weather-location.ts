import { db, plantPlacesTable, savedLocationsTable, type Plant, type User } from "@workspace/db";
import { and, eq } from "drizzle-orm";

export type WeatherLocation = {
  name: string;
  latitude: number | null;
  longitude: number | null;
  source: "plant" | "profile" | "fallback";
};

export const FALLBACK_WEATHER_LOCATION: WeatherLocation = {
  name: "Ваш регіон",
  latitude: null,
  longitude: null,
  source: "fallback",
};

const coordinate = (value: string | null) => value === null ? null : Number(value);

export function resolveWeatherLocation(user: User, plant?: Plant | null): WeatherLocation {
  if (
    plant?.weatherLocationName &&
    plant.weatherLatitude !== null &&
    plant.weatherLongitude !== null
  ) {
    return {
      name: plant.weatherLocationName,
      latitude: coordinate(plant.weatherLatitude),
      longitude: coordinate(plant.weatherLongitude),
      source: "plant",
    };
  }

  if (!user.weatherLocationName) return FALLBACK_WEATHER_LOCATION;
  return {
    name: user.weatherLocationName,
    latitude: coordinate(user.weatherLatitude),
    longitude: coordinate(user.weatherLongitude),
    source: user.weatherLocationName === FALLBACK_WEATHER_LOCATION.name ? "fallback" : "profile",
  };
}

export async function resolveSavedWeatherLocation(user: User, plant?: Plant | null): Promise<WeatherLocation> {
  if (plant?.weatherLocationId) {
    const [location] = await db.select().from(savedLocationsTable).where(and(eq(savedLocationsTable.id, plant.weatherLocationId), eq(savedLocationsTable.userId, user.id)));
    if (location) return { name: location.displayName, latitude: Number(location.latitude), longitude: Number(location.longitude), source: "plant" };
  }
  const [location] = await db.select().from(savedLocationsTable).where(and(eq(savedLocationsTable.userId, user.id), eq(savedLocationsTable.isDefault, true)));
  if (location) return { name: location.displayName, latitude: Number(location.latitude), longitude: Number(location.longitude), source: "profile" };
  // Keep pre-SavedLocation plant coordinates as a compatibility fallback, below the user's saved default.
  if (plant?.weatherLocationName && plant.weatherLatitude !== null && plant.weatherLongitude !== null) {
    return resolveWeatherLocation(user, plant);
  }
  return resolveWeatherLocation(user, plant);
}

export async function plantEnvironment(plant: Plant): Promise<string> {
  if (plant.placeId) {
    const [place] = await db.select().from(plantPlacesTable).where(and(eq(plantPlacesTable.id, plant.placeId), eq(plantPlacesTable.userId, plant.userId)));
    if (place) return place.environmentType;
  }
  return plant.environmentType;
}