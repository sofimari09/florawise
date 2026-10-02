import type { Plant, User } from "@workspace/db";

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