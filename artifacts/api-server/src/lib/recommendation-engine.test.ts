import assert from "node:assert/strict";
import test from "node:test";
import type { CareTask, PlantSpecies, SpeciesCareRule } from "@workspace/db";
import { generateRules, isWeatherSuitable } from "./recommendation-engine";
import { MockWeatherService } from "./weather";
import { customCareContext } from "./effective-care";
import { carePlan } from "./care-eligibility";

const date = (offset = 0) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const species = { id: 1, name: "Тестовий вид", category: "INDOOR_DECORATIVE", applicableCareTypes: null, careRevision: 0, optimalTempMin: "18", optimalTempMax: "28", wateringFrequencyDays: 7, careRecommendations: "Перевірте ґрунт.", generalCareRecommendations: null } as PlantSpecies;
const task = (overrides: Partial<CareTask> = {}): CareTask => ({ id: 1, plantId: 1, type: "WATERING", scheduledDate: date(), status: "PLANNED", priority: "MEDIUM", notes: "", createdAt: new Date(), postponementCount: 0, ...overrides });
const forecast = [{ date: date(), temperature: 22, precipitation: 10, humidity: 60, windSpeed: 3, condition: "Дощ" }, { date: date(1), temperature: 22, precipitation: 0, humidity: 55, windSpeed: 2, condition: "Ясно" }];
const rule = (overrides: Partial<SpeciesCareRule>): SpeciesCareRule => ({ id: 1, speciesId: 1, careType: "WATERING", rainThresholdMm: null, maxWindSpeedMps: null, minTemperature: null, maxTemperature: null, notes: null, ruleCode: null, triggerDescription: null, recommendedAction: null, intervalDaysMin: null, intervalDaysMax: null, targetWaterMmWeekMin: null, targetWaterMmWeekMax: null, ...overrides });

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
test("indoor decorative plant keeps condition-based care and filters harvest and sowing tasks", () => {
  const monstera = {
    ...species,
    name: "Монстера",
    category: "INDOOR_DECORATIVE",
    wateringRecommendations: "Перевіряйте вологість субстрату перед поливом.",
    wateringCheckIntervalDays: 3,
  } as PlantSpecies;
  const result = generateRules(
    monstera,
    [task({ type: "HARVEST" }), task({ id: 2, type: "SOWING" })],
    forecast,
    "Київ",
    "INDOOR",
    date(-8),
    [rule({ triggerDescription: "верхній шар ґрунту підсох", recommendedAction: "полити після перевірки" })],
  )[0];
  assert.equal(result.type, "GENERAL");
  assert.match(result.text, /Перевірте умову поливу/);
  assert.match(result.explanation, /верхній шар ґрунту підсох/);
  assert.match(result.explanation, /це не частота поливу/);
  assert.match(result.explanation, /автоматичне прострочення за фіксованою частотою не застосовано/);
  assert.doesNotMatch(`${result.text} ${result.explanation}`, /HARVEST|SOWING|Збір врожаю|Посів/);
  assert.equal(result.suggestedDate, null);
});
test("outdoor decorative plant uses rain and wind forecast only for its outdoor task", () => {
  const rose = { ...species, name: "Троянда", category: "OUTDOOR_DECORATIVE" } as PlantSpecies;
  const input = task();
  const before = JSON.stringify(input);
  const result = generateRules(rose, [input], forecast, "Одеса", "OUTDOOR", null, [rule({ rainThresholdMm: "5" })])[0];
  assert.equal(result.type, "WEATHER_RESCHEDULE");
  assert.equal(result.suggestedDate, date(1));
  assert.match(result.explanation, /Локація: «Одеса»/);
  assert.match(result.explanation, /опади 10 мм ≥ порогу 5 мм/);
  assert.match(result.explanation, /Дату буде змінено лише після вашого підтвердження/);
  assert.equal(JSON.stringify(input), before);
});
test("berry fertilizing urgency uses the latest completed action for that task type", () => {
  const blackcurrant = {
    ...species,
    id: 2,
    name: "Смородина чорна",
    category: "BERRY_SHRUB",
    wateringFrequencyDays: null,
    fertilizingFrequencyDays: null,
  } as PlantSpecies;
  const fertilizingRule = rule({
    careType: "FERTILIZING",
    intervalDaysMin: 7,
    intervalDaysMax: 7,
    recommendedAction: "Підживити за потреби",
  });
  const dryWeather = [{ ...forecast[0], precipitation: 0 }, forecast[1]];
  const result = generateRules(
    blackcurrant,
    [task({ type: "FERTILIZING", priority: "LOW" })],
    dryWeather,
    "Львів",
    "OUTDOOR",
    null,
    [fertilizingRule],
    { FERTILIZING: date(-8) },
  )[0];
  assert.equal(result.type, "PRIORITY");
  assert.equal(result.priority, "HIGH");
  assert.match(result.explanation, /останній догляд «Підживлення»/);
  assert.match(result.explanation, /8 дн\. тому.*інтервал за правилом виду — 7 дн\./);
  assert.equal(result.suggestedDate, null);
});
test("structured wind and temperature thresholds use the same suitability check", () => {
  assert.equal(isWeatherSuitable("WATERING", species, forecast[1], "OUTDOOR", [rule({ maxWindSpeedMps: "1" })]), false);
  assert.equal(isWeatherSuitable("WATERING", species, forecast[1], "OUTDOOR", [rule({ maxTemperature: "20" })]), false);
});
test("latest completed watering date changes priority without affecting indoor rain", () => {
  assert.equal(generateRules(species, [task()], forecast, "Львів", "INDOOR", date(-20))[0].priority, "URGENT");
  assert.equal(generateRules(species, [task()], forecast, "Львів", "INDOOR", date())[0].type, "GENERAL");
});
test("a verified knowledge-base interval raises watering urgency from history without creating a task", () => {
  const knowledgeSpecies = { ...species, wateringFrequencyDays: null } as PlantSpecies;
  const result = generateRules(
    knowledgeSpecies,
    [],
    forecast,
    "Львів",
    "INDOOR",
    date(-8),
    [rule({ intervalDaysMin: 7, intervalDaysMax: 7 })],
    { WATERING: date(-8) },
  )[0];
  assert.equal(result.type, "GENERAL");
  assert.equal(result.priority, "HIGH");
  assert.equal(result.relatedTaskId, null);
  assert.equal(result.suggestedDate, null);
  assert.match(result.explanation, /інтервал за правилом виду — 7 дн\./);
  assert.match(result.explanation, /Завдання не створено, дати не змінено/);
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
test("condition-based watering does not turn an old fixed interval into overdue advice", () => {
  const conditionRule = rule({ triggerDescription: "Верхній шар ґрунту підсох", recommendedAction: "Перевірити вологість перед поливом" });
  const result = generateRules(species, [], forecast, "Львів", "INDOOR", date(-30), [conditionRule])[0];
  assert.equal(result.priority, "LOW");
  assert.match(result.explanation, /Умова виду: Верхній шар ґрунту підсох/);
  assert.match(result.explanation, /автоматичне прострочення за фіксованою частотою не застосовано/);
  assert.doesNotMatch(result.explanation, /інтервал виду — 7 дн/);
});
test("mock weather is deterministic and location-aware", async () => {
  const service = new MockWeatherService();
  const lviv = { name: "Львів", latitude: 49.84, longitude: 24.03 };
  const first = await service.getForecast(lviv);
  assert.deepEqual(first, await service.getForecast(lviv));
  assert.notDeepEqual(first.forecast, (await service.getForecast({ name: "Забужжя", latitude: 50.48, longitude: 24.17 })).forecast);
  assert.equal(first.isMock, true);
});

test("custom guidance has no invented cadence or temperature bounds, even with history", () => {
  const custom = customCareContext({ name: "Невідома рослина", category: "HERB" });
  assert.deepEqual(carePlan(custom), []);
  assert.equal(custom.wateringFrequencyDays, null);
  assert.equal(custom.optimalTempMax, null);
  const result = generateRules(custom, [], forecast, "Львів", "INDOOR", date(-100))[0];
  assert.equal(result.type, "GENERAL");
  assert.match(result.explanation, /Видових даних немає/);
  assert.match(result.explanation, /інтервал поливу невідомий/);
  assert.doesNotMatch(result.explanation, /інтервал виду —/);
  assert.doesNotMatch(result.text, /немає критичних/);
  assert.equal(generateRules(custom, [task()], [{ ...forecast[0], temperature: 80 }], "Львів", "INDOOR", date(-100))[0].priority, "LOW");
});

test("custom advice retains general weather and overdue rules, never species refinements", () => {
  const custom = customCareContext({ name: "Яблуня — лише назва", category: "HERB" });
  const outside = generateRules(custom, [task()], forecast, "Львів", "OUTDOOR", null, [rule({ rainThresholdMm: "50" })])[0];
  assert.equal(outside.type, "WEATHER_RESCHEDULE");
  assert.match(outside.explanation, /загальні погодні правила/);
  assert.match(outside.explanation, /не означає безпечність/);
  for (const environment of ["INDOOR", "GREENHOUSE"]) {
    assert.equal(generateRules(custom, [task()], forecast, "Львів", environment, null)[0].type, "GENERAL");
  }
  const overdue = generateRules(custom, [task({ scheduledDate: date(-8), postponementCount: 4 })], forecast, "Львів", "INDOOR", null)[0];
  assert.equal(overdue.priority, "URGENT");
  assert.match(overdue.explanation, /переносили 4/);
  assert.equal(isWeatherSuitable("PRUNING", custom, forecast[1], "INDOOR"), false);
  assert.equal(generateRules(custom, [task({ type: "PRUNING" })], forecast, "Львів", "OUTDOOR", null)[0].relatedTaskId, null);
  const transplant = customCareContext({ name: "Без видових меж", category: "INDOOR_DECORATIVE" });
  assert.equal(isWeatherSuitable("TRANSPLANTING", transplant, { ...forecast[1], temperature: -30 }, "OUTDOOR"), true);
});
