import assert from "node:assert/strict";
import test from "node:test";
import type { CareTask, PlantSpecies, SpeciesCareRule } from "@workspace/db";
import { generateRules, isWeatherSuitable, RULE_PARAMETERS } from "./recommendation-engine";
import { MockWeatherService } from "./weather";
import { customCareContext } from "./effective-care";
import { carePlan } from "./care-eligibility";
import { todayInKyiv } from "./date";

const date = (offset = 0) => new Date(Date.parse(`${todayInKyiv()}T00:00:00.000Z`) + offset * 86400000).toISOString().slice(0, 10);

test("today comparisons follow Kyiv civil dates across UTC midnight and seasonal offsets", () => {
  assert.equal(todayInKyiv(new Date("2026-10-21T21:30:00.000Z")), "2026-10-22");
  assert.equal(todayInKyiv(new Date("2026-10-22T21:30:00.000Z")), "2026-10-23");
  assert.equal(todayInKyiv(new Date("2026-01-01T22:30:00.000Z")), "2026-01-02");
});
const species = { id: 1, name: "Тестовий вид", category: "INDOOR_DECORATIVE", applicableCareTypes: null, careRevision: 0, optimalTempMin: "18", optimalTempMax: "28", wateringFrequencyDays: 7, careRecommendations: "Перевірте ґрунт.", generalCareRecommendations: null } as PlantSpecies;
const task = (overrides: Partial<CareTask> = {}): CareTask => ({ id: 1, plantId: 1, type: "WATERING", scheduledDate: date(), status: "PLANNED", priority: "MEDIUM", notes: "", createdAt: new Date(), postponementCount: 0, ...overrides });
const forecast = [{ date: date(), dateTime: `${date()}T12:00`, temperature: 22, precipitation: 10, humidity: 60, windSpeed: 3, condition: "Дощ", conditionCode: 61 }, { date: date(1), dateTime: `${date(1)}T12:00`, temperature: 22, precipitation: 0, humidity: 55, windSpeed: 2, condition: "Ясно", conditionCode: 0 }];
const rule = (overrides: Partial<SpeciesCareRule>): SpeciesCareRule => ({ id: 1, speciesId: 1, careType: "WATERING", rainThresholdMm: null, maxWindSpeedMps: null, minTemperature: null, maxTemperature: null, notes: null, ruleCode: null, triggerDescription: null, recommendedAction: null, intervalDaysMin: null, intervalDaysMax: null, targetWaterMmWeekMin: null, targetWaterMmWeekMax: null, ...overrides });

const crop = {
  ...species, category: "VEGETABLE", optimalTempMin: null, optimalTempMax: null,
  sowingPlantingRecommendations: "Висаджувати після ризику заморозків.",
  harvestingRecommendations: "Завершити збір до сильних холодів.",
} as PlantSpecies;
const weatherDays = (changes: Array<Partial<(typeof forecast)[number]> & {
  minTemperature?: number; maxTemperature?: number; maxWindSpeed?: number; maxWindGusts?: number;
}>) => changes.map((change, index) => ({
  ...forecast[1], date: date(index), dateTime: `${date(index)}T12:00`,
  temperature: 20, minTemperature: 12, maxTemperature: 24, precipitation: 0,
  maxWindSpeed: 3, maxWindGusts: 4, ...change,
}));
const weatherAdvice = (type: CareTask["type"], days: ReturnType<typeof weatherDays>, environment = "OUTDOOR", notes = "", offset = 0, care = crop) =>
  generateRules(care, [task({ type, scheduledDate: date(offset), notes })], days, "Тестова локація", environment, null);

test("rain forecast before tomorrow's watering prompts a soil check, not an observation claim", () => {
  const result = weatherAdvice("WATERING", weatherDays([{ precipitation: 12 }, {}]), "OUTDOOR", "", 1)[0];
  assert.equal(result.type, "WEATHER_WARNING");
  assert.equal(result.suggestedDate, null);
  assert.match(result.explanation, /перед поливом/);
  assert.match(result.explanation, /не виміряний дощ/);
});
test("negligible rainfall does not generate a task weather card", () => {
  assert.ok(weatherAdvice("WATERING", weatherDays([{ precipitation: 0.2 }, {}])).every(item => !item.type.startsWith("WEATHER_")));
});
test("hot dry weather prompts checking soil and potentially watering earlier without an invented cadence", () => {
  const result = weatherAdvice("WATERING", weatherDays([{ maxTemperature: 36 }, {}]))[0];
  assert.equal(result.type, "WEATHER_WARNING");
  assert.match(result.explanation, /за потреби полийте раніше/);
  assert.equal(result.suggestedDate, null);
});
test("significant rain postpones outdoor pruning but not indoor pruning", () => {
  const days = weatherDays([{ precipitation: 12 }, {}]);
  const rose = { ...crop, category: "OUTDOOR_DECORATIVE" } as PlantSpecies;
  assert.equal(weatherAdvice("PRUNING", days, "OUTDOOR", "", 0, rose)[0].suggestedDate, date(1));
  assert.ok(weatherAdvice("PRUNING", days, "INDOOR", "", 0, rose).every(item => !item.type.startsWith("WEATHER_")));
});
test("spraying warnings require product guidance and never impose spray rules on mechanical removal", () => {
  const days = weatherDays([{ precipitation: 2, maxWindGusts: 12 }, {}]);
  const result = weatherAdvice("TREATMENT", days, "OUTDOOR", "Обприскування листя")[0];
  assert.equal(result.type, "WEATHER_WARNING");
  assert.match(result.explanation, /етикетку препарату/);
  assert.equal(result.suggestedDate, null);
  assert.ok(weatherAdvice("TREATMENT", days, "OUTDOOR", "Механічне видалення вручну").every(item => !item.type.startsWith("WEATHER_")));
  assert.match(weatherAdvice("TREATMENT", days)[0].explanation, /спосіб обробки не вказано/);
});
test("heavy rain affecting fertilizing is a warning when application method is unknown", () => {
  const result = weatherAdvice("FERTILIZING", weatherDays([{ precipitation: 15 }, {}]))[0];
  assert.equal(result.type, "WEATHER_WARNING");
  assert.match(result.explanation, /спосіб внесення не відомий/);
  assert.equal(result.suggestedDate, null);
});
test("transplanting uses species temperature bounds and forecast minima, never inferred soil conditions", () => {
  const care = { ...crop, category: "OUTDOOR_DECORATIVE", optimalTempMin: "10" } as PlantSpecies;
  const result = weatherAdvice("TRANSPLANTING", weatherDays([{ temperature: 12, minTemperature: -2 }, {}]), "OUTDOOR", "", 0, care)[0];
  assert.equal(result.type, "WEATHER_RESCHEDULE");
  assert.equal(result.suggestedDate, date(1));
  assert.match(result.explanation, /температуру чи вологість ґрунту/);
});
test("frost-sensitive sowing and planting are postponed to a forecast day without frost", () => {
  for (const type of ["SOWING", "PLANTING"] as const) {
    const result = weatherAdvice(type, weatherDays([{ minTemperature: -2 }, {}]))[0];
    assert.equal(result.type, "WEATHER_RESCHEDULE");
    assert.equal(result.suggestedDate, date(1));
  }
});
test("frost-sensitive harvest is suggested earlier, within the forecast and never in the past", () => {
  const result = weatherAdvice("HARVEST", weatherDays([{}, {}, { minTemperature: -2 }]), "OUTDOOR", "", 2)[0];
  assert.equal(result.type, "WEATHER_RESCHEDULE");
  assert.equal(result.suggestedDate, date(1));
  assert.ok(result.suggestedDate! >= date());
});
test("rain alone does not postpone harvest", () => {
  assert.ok(weatherAdvice("HARVEST", weatherDays([{ precipitation: 20 }, {}])).every(item => item.type !== "WEATHER_RESCHEDULE"));
});
test("a harvest instruction mentioning after-frost is not misread as frost sensitivity", () => {
  const care = { ...crop, harvestingRecommendations: "Збирати після перших заморозків." } as PlantSpecies;
  const result = weatherAdvice("HARVEST", weatherDays([{}, { minTemperature: -2 }]), "OUTDOOR", "", 1, care);
  assert.ok(result.every(item => item.type !== "WEATHER_RESCHEDULE"));
});
test("unknown fertilizer method remains warning-only even with explicit species weather limits", () => {
  const result = generateRules(crop, [task({ type: "FERTILIZING" })], weatherDays([{ precipitation: 15 }, {}]),
    "Тест", "OUTDOOR", null, [rule({ careType: "FERTILIZING", rainThresholdMm: "5" })])[0];
  assert.equal(result.type, "WEATHER_WARNING");
  assert.equal(result.suggestedDate, null);
});
test("greenhouse is sheltered and balcony with unknown exposure never receives automatic rescheduling", () => {
  const days = weatherDays([{ precipitation: 12 }, {}]);
  assert.ok(weatherAdvice("WATERING", days, "GREENHOUSE").every(item => !item.type.startsWith("WEATHER_")));
  const balcony = weatherAdvice("WATERING", days, "BALCONY")[0];
  assert.equal(balcony.type, "WEATHER_WARNING");
  assert.match(balcony.explanation, /експозиція балкона невідома/);
  assert.equal(balcony.suggestedDate, null);
});
test("missing observations and missing today's forecast stay unknown instead of generating a date", () => {
  assert.match(weatherAdvice("WATERING", weatherDays([{ precipitation: 2 }, {}]))[0].explanation, /24–48 год недоступні/);
  const onlyTomorrow = weatherDays([{}, {}]).slice(1);
  const result = weatherAdvice("PLANTING", onlyTomorrow)[0];
  assert.equal(result.type, "WEATHER_WARNING");
  assert.equal(result.suggestedDate, null);
});
test("weather restrictions take precedence over overdue spraying urgency", () => {
  const result = weatherAdvice("TREATMENT", weatherDays([{ precipitation: 3, maxWindGusts: 15 }, {}]), "OUTDOOR", "Обприскування", -7);
  assert.equal(result[0].type, "WEATHER_WARNING");
  assert.equal(result[0].priority, "URGENT");
  assert.ok(result.every(item => item.type !== "PRIORITY"));
});

test("outdoor rain proposes a date; indoor and greenhouse rain do not", () => {
  assert.equal(generateRules(species, [task()], forecast, "Львів", "OUTDOOR", null)[0].type, "WEATHER_RESCHEDULE");
  for (const environment of ["INDOOR", "GREENHOUSE"]) assert.equal(generateRules(species, [task()], forecast, "Львів", environment, null)[0].type, "GENERAL");
});
test("species-specific threshold replaces the general fallback", () => {
  assert.equal(generateRules(species, [task()], forecast, "Львів", "OUTDOOR", null, [rule({ rainThresholdMm: "20" })])[0].type, "WEATHER_WARNING");
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
  assert.match(result.explanation, /опади 10 мм > порогу 5 мм/);
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
test("scheduled tasks use the forecast for their exact date, not today's rain", () => {
  const result = generateRules(species, [task({ scheduledDate: forecast[1].date })], forecast, "Львів", "OUTDOOR", null);
  assert.equal(result.some(item => item.type === "WEATHER_RESCHEDULE"), false);
  assert.equal(result[0].type, "WEATHER_WARNING");
  assert.match(result[0].explanation, /перед поливом/);
});
test("nearest suitable alternative is chosen by date, not forecast array order", () => {
  const laterDryDay = { ...forecast[1], date: date(2), dateTime: `${date(2)}T12:00` };
  const result = generateRules(species, [task()], [laterDryDay, forecast[0], forecast[1]], "Львів", "OUTDOOR", null)[0];
  assert.equal(result.type, "WEATHER_RESCHEDULE");
  assert.equal(result.suggestedDate, date(1));
});
test("rain must exceed the applicable threshold and no alternative date is invented", () => {
  const exactlyAtThreshold = [{ ...forecast[0], precipitation: RULE_PARAMETERS.significantRainMm }, ...forecast.slice(1)];
  assert.equal(generateRules(species, [task()], exactlyAtThreshold, "Львів", "OUTDOOR", null)[0].type, "WEATHER_WARNING");
  const rainyForecast = forecast.map(day => ({ ...day, precipitation: 12 }));
  const noAlternative = generateRules(species, [task()], rainyForecast, "Львів", "OUTDOOR", null)[0];
  assert.equal(noAlternative.type, "WEATHER_WARNING");
  assert.equal(noAlternative.suggestedDate, null);
  assert.match(noAlternative.explanation, /Придатної дати в доступному прогнозі немає/);
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
  assert.match(rainy.explanation, /опади 10 мм > порогу 0.5 мм/);
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
  assert.equal(isWeatherSuitable("TRANSPLANTING", transplant, { ...forecast[1], temperature: -30 }, "OUTDOOR"), false);
});
