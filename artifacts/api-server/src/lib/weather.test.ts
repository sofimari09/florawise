import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MockWeatherService,
  RealWeatherService,
  WeatherServiceWithFallback,
  type WeatherServiceClient,
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
    relative_humidity_2m_mean: [68, 75],
    wind_speed_10m_mean: [2.8, 4.2],
    weather_code: [3, 61],
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
  assert.equal(forecast.location, "Забужжя");
  assert.equal(forecast.isMock, false);
  assert.equal(forecast.current.temperature, 17.4);
  assert.equal(forecast.current.humidity, 63);
  assert.equal(forecast.current.windSpeed, 3.1);
  assert.equal(forecast.current.condition, "Мінлива хмарність");
  assert.equal(forecast.current.conditionCode, 2);
  assert.equal(forecast.current.dateTime, "2026-10-11T14:30");
  assert.equal(forecast.forecast[1].precipitation, 7.8);
  assert.equal(forecast.forecast[1].date, "2026-10-12");
});

test("mock weather is clearly marked when real weather is unavailable", async () => {
  const real: WeatherServiceClient = { getForecast: async () => { throw new Error("service unavailable"); } };
  const service = new WeatherServiceWithFallback(real, new MockWeatherService());
  const forecast = await service.getForecast({ name: "Забужжя", latitude: 50.4, longitude: 24.1 });

  assert.equal(forecast.location, "Забужжя");
  assert.equal(forecast.isMock, true);
  assert.equal(forecast.current.conditionCode >= 0, true);
  assert.equal(forecast.forecast.length, 7);
});

test("missing coordinates fall back to demo data instead of failing", async () => {
  const service = new WeatherServiceWithFallback(new RealWeatherService(async () => {
    throw new Error("The real provider should not be called without coordinates");
  }), new MockWeatherService());
  const result = await service.getForecast({ name: "Ваш регіон", latitude: null, longitude: null });

  assert.equal(result.isMock, true);
  assert.equal(result.latitude, null);
  assert.equal(result.longitude, null);
});
