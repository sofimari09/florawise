import type { WeatherDay, WeatherLocation, WeatherResponse } from "./weather";
import { todayInKyiv } from "./date";

export const DEV_WEATHER_SCENARIO = "RAIN_TOMORROW" as const;

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);

export function createRainTomorrowScenario(location: WeatherLocation, startDate = todayInKyiv()): WeatherResponse {
  const forecast: WeatherDay[] = Array.from({ length: 7 }, (_, offset) => {
    const date = addDays(startDate, offset);
    const rainy = offset === 1;
    return {
      date,
      dateTime: `${date}T12:00`,
      temperature: rainy ? 18 : 20,
      minTemperature: rainy ? 18 : 20,
      maxTemperature: rainy ? 18 : 20,
      maxWindSpeed: 3,
      maxWindGusts: 4,
      precipitation: rainy ? 10.3 : 0,
      precipitationProbability: rainy ? 100 : 0,
      humidity: rainy ? 85 : 55,
      windSpeed: 2,
      condition: rainy ? "Дощ" : "Ясно",
      conditionCode: rainy ? 65 : 0,
    };
  });
  const current = { ...forecast[0], dateTime: `${startDate}T09:00` };
  return {
    location: location.name,
    latitude: location.latitude,
    longitude: location.longitude,
    isMock: true,
    current,
    forecast,
  };
}
