import { logger } from "./logger";

export type WeatherDay = {
  date: string;
  dateTime: string;
  temperature: number;
  precipitation: number;
  humidity: number;
  windSpeed: number;
  condition: string;
  conditionCode: number;
};

export type WeatherResponse = {
  location: string;
  latitude: number | null;
  longitude: number | null;
  isMock: boolean;
  current: WeatherDay;
  forecast: WeatherDay[];
};

export type WeatherLocation = {
  name: string;
  latitude: number | null;
  longitude: number | null;
};

export interface WeatherServiceClient {
  getForecast(location: WeatherLocation): Promise<WeatherResponse>;
}

const datePart = (dateTime: string) => dateTime.slice(0, 10);

const conditionForCode = (code: number): string => {
  if (code === 0) return "Ясно";
  if (code === 1) return "Переважно ясно";
  if (code === 2) return "Мінлива хмарність";
  if (code === 3) return "Хмарно";
  if (code === 45 || code === 48) return "Туман";
  if ([51, 53, 55].includes(code)) return "Мряка";
  if ([56, 57].includes(code)) return "Крижана мряка";
  if ([61, 63, 65].includes(code)) return "Дощ";
  if ([66, 67].includes(code)) return "Крижаний дощ";
  if ([71, 73, 75, 77].includes(code)) return "Сніг";
  if ([80, 81, 82].includes(code)) return "Зливи";
  if ([85, 86].includes(code)) return "Снігові зливи";
  if ([95, 96, 99].includes(code)) return "Гроза";
  return "Невідомі погодні умови";
};

const toWeatherDay = (dateTime: string, temperature: number, precipitation: number, humidity: number, windSpeed: number, conditionCode: number): WeatherDay => ({
  date: datePart(dateTime),
  dateTime,
  temperature,
  precipitation,
  humidity,
  windSpeed,
  condition: conditionForCode(conditionCode),
  conditionCode,
});

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

type OpenMeteoResponse = {
  current?: Record<string, unknown>;
  daily?: Record<string, unknown>;
};

export class RealWeatherService implements WeatherServiceClient {
  constructor(private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {}

  async getForecast(location: WeatherLocation): Promise<WeatherResponse> {
    if (!finite(location.latitude) || !finite(location.longitude)) {
      throw new Error("Weather coordinates are unavailable");
    }

    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(location.latitude));
    url.searchParams.set("longitude", String(location.longitude));
    url.searchParams.set("current", "temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m");
    url.searchParams.set("daily", "weather_code,temperature_2m_mean,precipitation_sum,relative_humidity_2m_mean,wind_speed_10m_mean");
    url.searchParams.set("forecast_days", "7");
    url.searchParams.set("timezone", "auto");
    url.searchParams.set("temperature_unit", "celsius");
    url.searchParams.set("precipitation_unit", "mm");
    url.searchParams.set("wind_speed_unit", "ms");

    const response = await this.fetcher(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`Open-Meteo returned ${response.status}`);
    const body = await response.json() as OpenMeteoResponse;
    const current = body.current;
    const daily = body.daily;
    if (!isRecord(current) || !isRecord(daily)) throw new Error("Open-Meteo response is missing current or daily weather");

    const currentTime = current.time;
    const currentTemperature = current.temperature_2m;
    const currentHumidity = current.relative_humidity_2m;
    const currentPrecipitation = current.precipitation;
    const currentWind = current.wind_speed_10m;
    const currentCode = current.weather_code;
    if (typeof currentTime !== "string" || !finite(currentTemperature) || !finite(currentHumidity) ||
      !finite(currentPrecipitation) || !finite(currentWind) || !finite(currentCode)) {
      throw new Error("Open-Meteo response contains incomplete current weather");
    }

    const asArray = (value: unknown): unknown[] => {
      if (!Array.isArray(value)) throw new Error("Open-Meteo response contains incomplete daily forecast");
      return value;
    };
    const dates = asArray(daily.time);
    const temperatures = asArray(daily.temperature_2m_mean);
    const precipitations = asArray(daily.precipitation_sum);
    const humidities = asArray(daily.relative_humidity_2m_mean);
    const winds = asArray(daily.wind_speed_10m_mean);
    const codes = asArray(daily.weather_code);
    const forecast: WeatherDay[] = [];
    for (let index = 0; index < dates.length; index += 1) {
      const date = dates[index];
      const temperature = temperatures[index];
      const precipitation = precipitations[index];
      const humidity = humidities[index];
      const wind = winds[index];
      const code = codes[index];
      if (typeof date !== "string" || !finite(temperature) || !finite(precipitation) ||
        !finite(humidity) || !finite(wind) || !finite(code)) {
        throw new Error(`Open-Meteo forecast contains incomplete data for day ${index}`);
      }
      forecast.push(toWeatherDay(date, temperature, precipitation, humidity, wind, code));
    }
    if (!forecast.length) throw new Error("Open-Meteo returned an empty forecast");

    return {
      location: location.name,
      latitude: location.latitude,
      longitude: location.longitude,
      isMock: false,
      current: toWeatherDay(currentTime, currentTemperature, currentPrecipitation, currentHumidity, currentWind, currentCode),
      forecast,
    };
  }
}

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
};

export class MockWeatherService implements WeatherServiceClient {
  async getForecast(location: WeatherLocation): Promise<WeatherResponse> {
    const templates = [
      { temperature: 20, precipitation: 0.4, humidity: 57, windSpeed: 3, condition: "Ясно", conditionCode: 0 },
      { temperature: 18, precipitation: 13, humidity: 86, windSpeed: 4, condition: "Значні опади", conditionCode: 65 },
      { temperature: 29, precipitation: 0.2, humidity: 38, windSpeed: 2, condition: "Спекотно й сухо", conditionCode: 0 },
      { temperature: 21, precipitation: 0.8, humidity: 61, windSpeed: 12, condition: "Хмарно з вітром", conditionCode: 3 },
      { temperature: 22, precipitation: 1.2, humidity: 65, windSpeed: 4, condition: "Хмарно з проясненнями", conditionCode: 2 },
      { temperature: 19, precipitation: 0, humidity: 54, windSpeed: 3, condition: "Комфортно", conditionCode: 1 },
      { temperature: 23, precipitation: 2, humidity: 60, windSpeed: 5, condition: "Мінлива хмарність", conditionCode: 2 },
    ];
    const identity = `${location.name}|${location.latitude ?? ""}|${location.longitude ?? ""}`;
    const hash = [...identity].reduce((value, char) => (Math.imul(value, 31) + char.charCodeAt(0)) >>> 0, 0);
    const rotation = hash % templates.length;
    const temperatureOffset = (hash % 7) - 3;
    const forecast = templates.map((_, index) => {
      const day = templates[(index + rotation) % templates.length];
      const date = addDays(new Date(), index);
      return {
        ...day,
        temperature: day.temperature + temperatureOffset,
        date,
        dateTime: `${date}T12:00`,
      };
    });
    return {
      location: location.name,
      latitude: location.latitude,
      longitude: location.longitude,
      isMock: true,
      current: { ...forecast[0], dateTime: new Date().toISOString() },
      forecast,
    };
  }
}

export class WeatherServiceWithFallback implements WeatherServiceClient {
  constructor(
    private readonly real: WeatherServiceClient,
    private readonly fallback: WeatherServiceClient,
  ) {}

  async getForecast(location: WeatherLocation): Promise<WeatherResponse> {
    try {
      return await this.real.getForecast(location);
    } catch (error) {
      logger.warn({ error, location: location.name }, "Real weather unavailable; using demonstration weather");
      return this.fallback.getForecast(location);
    }
  }
}

export const mockWeatherService: WeatherServiceClient = new MockWeatherService();
export const realWeatherService: WeatherServiceClient = new RealWeatherService();
export const weatherService: WeatherServiceClient = new WeatherServiceWithFallback(realWeatherService, mockWeatherService);
