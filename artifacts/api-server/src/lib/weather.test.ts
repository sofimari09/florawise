import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MockWeatherService,
  RealWeatherService,
  CachedWeatherService,
} from "./weather";

const openMeteoFixture = {
  current: {
    time: "2026-10-11T14:30",
    temperature_2m: 17.4,
    relative_humidity_2m: 63,
    precipitation: 0.2,
    wind_speed_10m: 3.1,
    weather_code: 2,
  },
  daily: {
    time: ["2026-10-11", "2026-10-12"],
    temperature_2m_mean: [16.5, 14.2],
    precipitation_sum: [1.3, 7.8],
    precipitation_probability_max: [70, 90],
    relative_humidity_2m_mean: [68, 75],
    wind_speed_10m_mean: [2.8, 4.2],
    weather_code: [3, 61],
    temperature_2m_min: [10, 8],
    temperature_2m_max: [20, 18],
    wind_speed_10m_max: [5, 7],
    wind_gusts_10m_max: [9, 12],
  },
  hourly: {
    time: ["2026-10-11T18:00", "2026-10-12T03:00"],
    temperature_2m: [15, 8], precipitation: [1.3, 2], relative_humidity_2m: [70, 80],
    wind_speed_10m: [4, 6], wind_gusts_10m: [8, 11], weather_code: [61, 61],
  },
};

test("Open-Meteo uses the saved coordinates and returns current plus daily weather", async () => {
  let requestedUrl: URL | undefined;
  const service = new RealWeatherService(async input => {
    requestedUrl = new URL(String(input));
    return new Response(JSON.stringify(openMeteoFixture), { status: 200 });
  });
  const forecast = await service.getForecast({ name: "Забужжя", latitude: 50.4, longitude: 24.1 });

  assert.equal(requestedUrl?.searchParams.get("latitude"), "50.4");
  assert.equal(requestedUrl?.searchParams.get("longitude"), "24.1");
  assert.equal(requestedUrl?.searchParams.get("wind_speed_unit"), "ms");
  assert.match(requestedUrl?.searchParams.get("daily") ?? "", /precipitation_probability_max/);
  assert.equal(forecast.location, "Забужжя");
  assert.equal(forecast.isMock, false);
  assert.equal(forecast.current.temperature, 17.4);
  assert.equal(forecast.current.humidity, 63);
  assert.equal(forecast.current.windSpeed, 3.1);
  assert.equal(forecast.current.condition, "Мінлива хмарність");
  assert.equal(forecast.current.conditionCode, 2);
  assert.equal(forecast.current.dateTime, "2026-10-11T14:30");
  assert.equal(forecast.forecast[0].precipitation, 1.3);
  assert.equal(forecast.forecast[0].precipitationProbability, 70);
  assert.equal(forecast.forecast[1].precipitation, 7.8);
  assert.equal(forecast.forecast[1].precipitationProbability, 90);
  assert.equal(forecast.forecast[1].date, "2026-10-12");
  assert.equal(requestedUrl?.searchParams.get("timezone"), "Europe/Kyiv");
  assert.match(requestedUrl?.searchParams.get("hourly") ?? "", /wind_gusts_10m/);
  assert.equal(requestedUrl?.searchParams.has("past_days"), false);
  assert.equal(forecast.forecast[0].minTemperature, 10);
  assert.equal(forecast.forecast[1].maxWindGusts, 12);
  assert.equal(forecast.forecast[1].hourly?.[0].dateTime, "2026-10-12T03:00");
});

test("coordinate cache deduplicates concurrent calls, preserves display names, expires, and does not cache errors", async () => {
  let calls = 0;
  let now = 0;
  let fail = false;
  const provider = new RealWeatherService(async () => {
    calls++;
    if (fail) throw new Error("offline");
    return new Response(JSON.stringify(openMeteoFixture), { status: 200 });
  });
  const service = new CachedWeatherService(provider, 1000, () => now);
  const location = { name: "Забужжя", latitude: 50.4, longitude: 24.1 };
  const results = await Promise.all([service.getForecast(location), service.getForecast({ ...location, name: "Коротка назва" })]);
  assert.equal(calls, 1);
  assert.equal(results[1].location, "Коротка назва");
  now = 1001;
  fail = true;
  await assert.rejects(service.getForecast(location), /offline/);
  fail = false;
  await service.getForecast(location);
  assert.equal(calls, 3);
});

test("real provider failure is surfaced and does not silently become mock weather", async () => {
  const service = new RealWeatherService(async () => { throw new Error("service unavailable"); });
  await assert.rejects(service.getForecast({ name: "Забужжя", latitude: 50.4, longitude: 24.1 }), /service unavailable/);
});

test("mock weather is available as an explicitly constructed test fixture", async () => {
  const forecast = await new MockWeatherService().getForecast({ name: "Забужжя", latitude: 50.4, longitude: 24.1 });
  assert.equal(forecast.location, "Забужжя");
  assert.equal(forecast.isMock, true);
  assert.equal(forecast.current.conditionCode >= 0, true);
  assert.equal(typeof forecast.forecast[0].precipitationProbability, "number");
  assert.equal(forecast.forecast.length, 7);
});

test("missing coordinates fail clearly instead of falling back to demo data", async () => {
  const service = new RealWeatherService(async () => {
    throw new Error("The real provider should not be called without coordinates");
  });
  await assert.rejects(service.getForecast({ name: "Ваш регіон", latitude: null, longitude: null }), /coordinates are unavailable/);
});
