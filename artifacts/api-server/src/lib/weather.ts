import { todayInKyiv } from "./date";

export type WeatherDay = {
  date: string;
  dateTime: string;
  temperature: number;
  precipitation: number;
  precipitationProbability?: number | null;
  humidity: number;
  windSpeed: number;
  condition: string;
  conditionCode: number;
  minTemperature?: number;
  maxTemperature?: number;
  maxWindSpeed?: number;
  maxWindGusts?: number;
  hourly?: WeatherHour[];
};

export type WeatherHour = {
  dateTime: string;
  temperature: number;
  precipitation: number;
  humidity: number;
  windSpeed: number;
  windGusts: number;
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

const toWeatherDay = (dateTime: string, temperature: number, precipitation: number, humidity: number, windSpeed: number, conditionCode: number, precipitationProbability?: number | null): WeatherDay => ({
  date: datePart(dateTime),
  dateTime,
  temperature,
  precipitation,
  ...(precipitationProbability === undefined ? {} : { precipitationProbability }),
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
  hourly?: Record<string, unknown>;
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
    url.searchParams.set("hourly", "temperature_2m,precipitation,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,weather_code");
    url.searchParams.set("daily", "weather_code,temperature_2m_mean,temperature_2m_min,temperature_2m_max,precipitation_sum,precipitation_probability_max,relative_humidity_2m_mean,wind_speed_10m_mean,wind_speed_10m_max,wind_gusts_10m_max");
    url.searchParams.set("forecast_days", "7");
    url.searchParams.set("timezone", "Europe/Kyiv");
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
    const optionalArray = (value: unknown, fallback: unknown[]): unknown[] =>
      Array.isArray(value) ? value : fallback;
    const dates = asArray(daily.time);
    const temperatures = asArray(daily.temperature_2m_mean);
    const minimumTemperatures = optionalArray(daily.temperature_2m_min, temperatures);
    const maximumTemperatures = optionalArray(daily.temperature_2m_max, temperatures);
    const precipitations = asArray(daily.precipitation_sum);
    const precipitationProbabilities = asArray(daily.precipitation_probability_max);
    const humidities = asArray(daily.relative_humidity_2m_mean);
    const winds = asArray(daily.wind_speed_10m_mean);
    const maximumWinds = optionalArray(daily.wind_speed_10m_max, winds);
    const maximumGusts = Array.isArray(daily.wind_gusts_10m_max) ? daily.wind_gusts_10m_max : [];
    const codes = asArray(daily.weather_code);
    const hourly = body.hourly;
    const hourlyByDate = new Map<string, WeatherHour[]>();
    if (isRecord(hourly)) {
      const hourlyTimes = Array.isArray(hourly.time) ? hourly.time : [];
      const hourlyTemperatures = Array.isArray(hourly.temperature_2m) ? hourly.temperature_2m : [];
      const hourlyPrecipitations = Array.isArray(hourly.precipitation) ? hourly.precipitation : [];
      const hourlyHumidities = Array.isArray(hourly.relative_humidity_2m) ? hourly.relative_humidity_2m : [];
      const hourlyWinds = Array.isArray(hourly.wind_speed_10m) ? hourly.wind_speed_10m : [];
      const hourlyGusts = Array.isArray(hourly.wind_gusts_10m) ? hourly.wind_gusts_10m : [];
      const hourlyCodes = Array.isArray(hourly.weather_code) ? hourly.weather_code : [];
      for (let index = 0; index < hourlyTimes.length; index += 1) {
        const time = hourlyTimes[index];
        const temperature = hourlyTemperatures[index];
        const precipitation = hourlyPrecipitations[index];
        const humidity = hourlyHumidities[index];
        const wind = hourlyWinds[index];
        const gusts = hourlyGusts[index];
        const code = hourlyCodes[index];
        if (typeof time !== "string" || !finite(temperature) || !finite(precipitation) ||
          !finite(humidity) || !finite(wind) || !finite(gusts) || !finite(code)) continue;
        const hour: WeatherHour = {
          dateTime: time,
          temperature,
          precipitation,
          humidity,
          windSpeed: wind,
          windGusts: gusts,
          condition: conditionForCode(code),
          conditionCode: code,
        };
        const date = datePart(time);
        hourlyByDate.set(date, [...(hourlyByDate.get(date) ?? []), hour]);
      }
    }
    const forecast: WeatherDay[] = [];
    for (let index = 0; index < dates.length; index += 1) {
      const date = dates[index];
      const temperature = temperatures[index];
      const minimumTemperature = minimumTemperatures[index];
      const maximumTemperature = maximumTemperatures[index];
      const precipitation = precipitations[index];
      const precipitationProbability = precipitationProbabilities[index];
      const humidity = humidities[index];
      const wind = winds[index];
      const maximumWind = maximumWinds[index];
      const maximumGust = maximumGusts[index];
      const code = codes[index];
      if (typeof date !== "string" || !finite(temperature) || !finite(precipitation) ||
        (precipitationProbability !== null && !finite(precipitationProbability)) ||
        !finite(humidity) || !finite(wind) || !finite(code) ||
        !finite(minimumTemperature) || !finite(maximumTemperature) || !finite(maximumWind) ||
        (maximumGust !== undefined && !finite(maximumGust))) {
        throw new Error(`Open-Meteo forecast contains incomplete data for day ${index}`);
      }
      forecast.push({
        ...toWeatherDay(date, temperature, precipitation, humidity, wind, code, precipitationProbability),
        minTemperature: minimumTemperature,
        maxTemperature: maximumTemperature,
        maxWindSpeed: maximumWind,
        ...(maximumGust === undefined ? {} : { maxWindGusts: maximumGust }),
        ...(hourlyByDate.has(date) ? { hourly: hourlyByDate.get(date) } : {}),
      });
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

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);

export class MockWeatherService implements WeatherServiceClient {
  async getForecast(location: WeatherLocation): Promise<WeatherResponse> {
    const templates = [
      { temperature: 20, precipitation: 0.4, precipitationProbability: 10, humidity: 57, windSpeed: 3, condition: "Ясно", conditionCode: 0 },
      { temperature: 18, precipitation: 13, precipitationProbability: 95, humidity: 86, windSpeed: 4, condition: "Значні опади", conditionCode: 65 },
      { temperature: 29, precipitation: 0.2, precipitationProbability: 0, humidity: 38, windSpeed: 2, condition: "Спекотно й сухо", conditionCode: 0 },
      { temperature: 21, precipitation: 0.8, precipitationProbability: 20, humidity: 61, windSpeed: 12, condition: "Хмарно з вітром", conditionCode: 3 },
      { temperature: 22, precipitation: 1.2, precipitationProbability: 35, humidity: 65, windSpeed: 4, condition: "Хмарно з проясненнями", conditionCode: 2 },
      { temperature: 19, precipitation: 0, precipitationProbability: 5, humidity: 54, windSpeed: 3, condition: "Комфортно", conditionCode: 1 },
      { temperature: 23, precipitation: 2, precipitationProbability: 60, humidity: 60, windSpeed: 5, condition: "Мінлива хмарність", conditionCode: 2 },
    ];
    const identity = `${location.name}|${location.latitude ?? ""}|${location.longitude ?? ""}`;
    const hash = [...identity].reduce((value, char) => (Math.imul(value, 31) + char.charCodeAt(0)) >>> 0, 0);
    const rotation = hash % templates.length;
    const temperatureOffset = (hash % 7) - 3;
    const forecast = templates.map((_, index) => {
      const day = templates[(index + rotation) % templates.length];
      const date = addDays(todayInKyiv(), index);
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
      current: forecast[0],
      forecast,
    };
  }
}

type WeatherCacheEntry = {
  expiresAt: number;
  promise?: Promise<WeatherResponse>;
  value?: WeatherResponse;
};

export class CachedWeatherService implements WeatherServiceClient {
  private readonly entries = new Map<string, WeatherCacheEntry>();

  constructor(
    private readonly provider: WeatherServiceClient,
    private readonly ttlMs = 5 * 60 * 1000,
    private readonly clock: () => number = Date.now,
  ) {}

  async getForecast(location: WeatherLocation): Promise<WeatherResponse> {
    if (!finite(location.latitude) || !finite(location.longitude)) {
      return this.provider.getForecast(location);
    }
    const key = `${location.latitude}|${location.longitude}|Europe/Kyiv`;
    const now = this.clock();
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > now) {
      const value = cached.value ?? await cached.promise!;
      return { ...value, location: location.name };
    }

    const promise = this.provider.getForecast(location);
    this.entries.set(key, { expiresAt: now + this.ttlMs, promise });
    try {
      const value = await promise;
      this.entries.set(key, { expiresAt: this.clock() + this.ttlMs, value });
      return { ...value, location: location.name };
    } catch (error) {
      if (this.entries.get(key)?.promise === promise) this.entries.delete(key);
      throw error;
    }
  }
}

export const realWeatherService: WeatherServiceClient = new RealWeatherService();
export const weatherService: WeatherServiceClient = new CachedWeatherService(realWeatherService);
