import assert from "node:assert/strict";
import test from "node:test";
import type { CareTask, PlantSpecies, SpeciesCareRule } from "@workspace/db";
import { generateRules, isWeatherSuitable } from "./recommendation-engine";
import { MockWeatherService } from "./weather";

const date = (offset = 0) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const species = { id: 1, name: "Тестовий вид", category: "INDOOR_DECORATIVE", applicableCareTypes: null, careRevision: 0, optimalTempMin: "18", optimalTempMax: "28", wateringFrequencyDays: 7, careRecommendations: "Перевірте ґрунт.", generalCareRecommendations: null } as PlantSpecies;
const task = (overrides: Partial<CareTask> = {}): CareTask => ({ id: 1, plantId: 1, type: "WATERING", scheduledDate: date(), status: "PLANNED", priority: "MEDIUM", notes: "", createdAt: new Date(), postponementCount: 0, ...overrides });
const forecast = [{ date: date(), temperature: 22, precipitation: 10, humidity: 60, windSpeed: 3, condition: "Дощ" }, { date: date(1), temperature: 22, precipitation: 0, humidity: 55, windSpeed: 2, condition: "Ясно" }];
const rule = (overrides: Partial<SpeciesCareRule>): SpeciesCareRule => ({ id: 1, speciesId: 1, careType: "WATERING", rainThresholdMm: null, maxWindSpeedMps: null, minTemperature: null, maxTemperature: null, notes: null, ...overrides });

test("outdoor rain proposes a date; indoor and greenhouse rain do not", () => {
  assert.equal(generateRules(species, [task()], forecast, "Львів", "OUTDOOR", null)[0].type, "WEATHER_RESCHEDULE");
  for (const environment of ["INDOOR", "GREENHOUSE"]) assert.equal(generateRules(species, [task()], forecast, "Львів", environment, null)[0].type, "GENERAL");
});
test("species-specific threshold replaces the general fallback", () => {
  assert.equal(generateRules(species, [task()], forecast, "Львів", "OUTDOOR", null, [rule({ rainThresholdMm: "20" })])[0].type, "GENERAL");
  const result = generateRules(species, [task()], forecast, "Львів", "OUTDOOR", null, [rule({ rainThresholdMm: "5" })])[0];
  assert.match(result.explanation, /порогу 5 мм/);
  assert.equal(result.suggestedDate, date(1));
});
test("structured wind and temperature thresholds use the same suitability check", () => {
  assert.equal(isWeatherSuitable("WATERING", species, forecast[1], "OUTDOOR", [rule({ maxWindSpeedMps: "1" })]), false);
  assert.equal(isWeatherSuitable("WATERING", species, forecast[1], "OUTDOOR", [rule({ maxTemperature: "20" })]), false);
});
test("latest completed watering date changes priority without affecting indoor rain", () => {
  assert.equal(generateRules(species, [task()], forecast, "Львів", "INDOOR", date(-20))[0].priority, "URGENT");
  assert.equal(generateRules(species, [task()], forecast, "Львів", "INDOOR", date())[0].type, "GENERAL");
});
test("postponed tasks are active and overdue status raises priority", () => {
  const result = generateRules(species, [task({ status: "POSTPONED", scheduledDate: date(-6) })], forecast, "Львів", "INDOOR", null)[0];
  assert.equal(result.priority, "URGENT");
  assert.match(result.explanation, /прострочене на 6/);
});
test("future tasks beyond the forecast are not rescheduled using today's rain", () => {
  assert.equal(generateRules(species, [task({ scheduledDate: date(20) })], forecast, "Львів", "OUTDOOR", null)[0].type, "GENERAL");
});
test("rules do not mutate tasks and output is deterministic", () => {
  const input = task({ priority: "URGENT" });
  const before = JSON.stringify(input);
  const first = generateRules(species, [input], forecast, "Львів", "OUTDOOR", null);
  assert.deepEqual(first, generateRules(species, [input], forecast, "Львів", "OUTDOOR", null));
  assert.equal(first[0].priority, "URGENT");
  assert.equal(JSON.stringify(input), before);
});
test("species thresholds are explained and affect advice even without planned tasks", () => {
  const rainy = generateRules(species, [], forecast, "Львів", "OUTDOOR", null, [rule({ rainThresholdMm: "0.5" })])[0];
  const tolerant = generateRules(species, [], forecast, "Львів", "OUTDOOR", null, [rule({ rainThresholdMm: "20" })])[0];
  assert.match(rainy.explanation, /поріг опадів — 0.5 мм/);
  assert.match(rainy.explanation, /опади 10 мм ≥ порогу 0.5 мм/);
  assert.equal(rainy.priority, "MEDIUM");
  assert.equal(tolerant.priority, "LOW");
  assert.equal(rainy.relatedTaskId, null);
  assert.equal(rainy.suggestedDate, null);
  const indoor = generateRules(species, [], forecast, "Львів", "INDOOR", null, [rule({ rainThresholdMm: "0.5" })])[0];
  assert.equal(indoor.priority, "LOW");
  assert.match(indoor.explanation, /Зовнішній прогноз не використано/);
});
test("mock weather is deterministic and location-aware", async () => {
  const service = new MockWeatherService();
  const lviv = { name: "Львів", latitude: 49.84, longitude: 24.03 };
  const first = await service.getForecast(lviv);
  assert.deepEqual(first, await service.getForecast(lviv));
  assert.notDeepEqual(first.forecast, (await service.getForecast({ name: "Забужжя", latitude: 50.48, longitude: 24.17 })).forecast);
  assert.equal(first.isMock, true);
});
