import type { PlantSpecies, CareTask, SpeciesCareRule } from "@workspace/db";
import type { WeatherDay } from "./weather";
import { CARE_LABELS, eligibilityError, eligibilityBasis } from "@workspace/plant-care";
import type { CareContext } from "./effective-care";
import { todayInKyiv } from "./date";

export type RecommendationDraft = {
  type: string; text: string; priority: string; explanation: string;
  relatedTaskId: number | null; originalDate: string | null; suggestedDate: string | null; weather: WeatherDay;
};
// Screening triggers are not universal agronomic/product safety limits.
// Only WATERING/PRUNING retain the pre-existing 8 mm category postponement rule.
export const RULE_PARAMETERS = { significantRainMm: 8, wateringRainCheckMm: 1, safeSprayingWindMps: 8, overdueUrgentDays: 5, hotTemperatureDelta: 5 };
const exposed = (environment: string) => environment === "OUTDOOR";
const weatherRelevant = (environment: string) => ["BALCONY", "OUTDOOR"].includes(environment);
const labels: Record<string, string> = CARE_LABELS;
const priorityRank: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, URGENT: 3 };
const higherPriority = (a: string, b: string) => priorityRank[a] >= priorityRank[b] ? a : b;
const numeric = (value: unknown): number | null => {
  const parsed = Number(value);
  return value !== null && value !== undefined && Number.isFinite(parsed) ? parsed : null;
};
const minForecastTemperature = (weather: WeatherDay) =>
  numeric(weather.minTemperature) ?? (weather.hourly?.length ? Math.min(...weather.hourly.map(hour => hour.temperature)) : weather.temperature);
const maxForecastTemperature = (weather: WeatherDay) =>
  numeric(weather.maxTemperature) ?? (weather.hourly?.length ? Math.max(...weather.hourly.map(hour => hour.temperature)) : weather.temperature);
const maxForecastWind = (weather: WeatherDay) =>
  numeric(weather.maxWindSpeed) ?? (weather.hourly?.length ? Math.max(...weather.hourly.map(hour => hour.windSpeed)) : weather.windSpeed);
const maxForecastGust = (weather: WeatherDay) =>
  numeric(weather.maxWindGusts) ?? (weather.hourly?.length ? Math.max(...weather.hourly.map(hour => hour.windGusts)) : maxForecastWind(weather));
const textForCare = (species: CareContext, type: string) => {
  if (species.id === null) return "";
  const values: Record<string, string | null | undefined> = {
    WATERING: species.wateringRecommendations,
    FERTILIZING: species.fertilizingRecommendations,
    PRUNING: species.pruningRecommendations,
    TRANSPLANTING: species.transplantingRecommendations,
    SOWING: species.sowingPlantingRecommendations,
    PLANTING: species.sowingPlantingRecommendations,
    HARVEST: species.harvestingRecommendations,
  };
  return values[type] ?? "";
};
const minimumTemperatureFromKnowledge = (species: CareContext) => {
  if (species.id === null) return null;
  const text = species.sowingPlantingRecommendations ?? "";
  const match = text.match(/(?:нічн\S*|температур\S*)[^.\n]{0,35}[>≥]\s*(-?\d+(?:[.,]\d+)?)\s*°?\s*C/i);
  return match ? Number(match[1].replace(",", ".")) : null;
};
const frostSensitiveText = (text: string) => /замороз|сильн\S*\s+холод|frost|freez/i.test(text);
const harvestBeforeCold = (species: CareContext) =>
  /до\s+(?:сильн\S*\s+холод|(?:\S+\s+){0,3}замороз)|before[^.;]{0,40}(?:frost|freez)/i.test(textForCare(species, "HARVEST"));
const explicitlySprayTask = (notes: string) => /обприск|спрей|spray|фунгіцид|інсектицид/i.test(notes);
const explicitlyMechanicalTask = (notes: string) => /механіч|вручну|ручн\w*\s+(?:зібрати|видалити|зняти)|видалити вручну/i.test(notes);
const explicitFertilizingMethod = (notes: string) => /під корінь|коренев|позакоренев|по лист|у ґрунт|гранул/i.test(notes);
function thresholds(type: string, species: CareContext, rules: SpeciesCareRule[]) {
  const rule = rules.find(item => item.careType === type);
  const hasSpeciesWeatherThresholds = rule !== undefined && [
    rule.rainThresholdMm, rule.maxWindSpeedMps, rule.minTemperature, rule.maxTemperature,
  ].some(value => value !== null);
  const interval = rule?.intervalDaysMin == null
    ? ""
    : rule.intervalDaysMax == null || rule.intervalDaysMax === rule.intervalDaysMin
      ? `інтервал за правилом — ${rule.intervalDaysMin} дн.`
      : `інтервал за правилом — ${rule.intervalDaysMin}–${rule.intervalDaysMax} дн.`;
  const waterTargetMin = rule?.targetWaterMmWeekMin ?? (species.id === null ? null : species.targetWaterMmWeekMin);
  const waterTargetMax = rule?.targetWaterMmWeekMax ?? (species.id === null ? null : species.targetWaterMmWeekMax);
  const waterTarget = waterTargetMin == null
    ? ""
    : waterTargetMax == null || Number(waterTargetMax) === Number(waterTargetMin)
      ? `ціль води — ${waterTargetMin} мм/тиждень`
      : `ціль води — ${waterTargetMin}–${waterTargetMax} мм/тиждень`;
  const knowledgeNotes = rule ? [
    rule.triggerDescription ? `Умова виду: ${rule.triggerDescription}` : "",
    rule.recommendedAction ? `Дія за джерелом: ${rule.recommendedAction}` : "",
    interval,
    waterTarget,
    rule.notes ?? "",
  ].filter(Boolean).join(". ") : "";
  const ruleMin = numeric(rule?.minTemperature);
  const ruleMax = numeric(rule?.maxTemperature);
  const speciesMin = numeric(species.optimalTempMin);
  const speciesMax = numeric(species.optimalTempMax);
  const plantingMin = minimumTemperatureFromKnowledge(species);
  return {
    rain: numeric(rule?.rainThresholdMm) ?? (["WATERING", "PRUNING"].includes(type) ? RULE_PARAMETERS.significantRainMm : Infinity),
    wind: numeric(rule?.maxWindSpeedMps) ?? Infinity,
    min: ruleMin ?? (type === "TRANSPLANTING" ? speciesMin : ["SOWING", "PLANTING"].includes(type) ? plantingMin ?? speciesMin : -Infinity) ?? -Infinity,
    max: ruleMax ?? (["TRANSPLANTING", "SOWING", "PLANTING"].includes(type) ? speciesMax : null) ?? Infinity,
    source: species.id === null
      ? "загальні погодні правила FloraWise для дій категорії; видові межі невідомі, відповідність цим правилам не означає безпечність усіх умов"
      : hasSpeciesWeatherThresholds ? `погодні пороги правила виду «${species.name}»` : rule ? `загальні погодні правила FloraWise; додатково застосовано знання виду «${species.name}»` : `обережні правила за типом дії та характеристики виду «${species.name}»`,
    notes: knowledgeNotes,
  };
}
function intervalForCare(species: CareContext, type: string, rule?: SpeciesCareRule): { days: number; explanation: string } | null {
  const min = rule?.intervalDaysMin ?? null;
  const max = rule?.intervalDaysMax ?? null;
  const ruleDays = max ?? min;
  if (ruleDays != null && Number.isFinite(ruleDays) && ruleDays > 0) {
    const range = min != null && max != null && min !== max ? `${min}–${max}` : `${ruleDays}`;
    return { days: ruleDays, explanation: `інтервал за правилом виду — ${range} дн.` };
  }

  // A condition-based watering rule overrides an older fixed calendar interval.
  if (type === "WATERING" && rule?.triggerDescription) return null;
  if (species.id === null) return null;
  if (type === "WATERING" && species.wateringFrequencyDays != null && species.wateringFrequencyDays > 0) {
    return { days: species.wateringFrequencyDays, explanation: `фіксований інтервал виду — ${species.wateringFrequencyDays} дн.` };
  }
  if (type === "FERTILIZING" && species.fertilizingFrequencyDays != null && species.fertilizingFrequencyDays > 0) {
    return { days: species.fertilizingFrequencyDays, explanation: `інтервал виду — ${species.fertilizingFrequencyDays} дн.` };
  }
  if (type === "TRANSPLANTING" && species.transplantingFrequencyMonths != null && species.transplantingFrequencyMonths > 0) {
    const days = species.transplantingFrequencyMonths * 30;
    return { days, explanation: `орієнтовний інтервал виду — ${species.transplantingFrequencyMonths} міс.` };
  }
  return null;
}
function taskKnowledge(species: CareContext, type: string): string {
  if (species.id === null) return species.generalCareRecommendations;
  const guidance: Record<string, string | null | undefined> = {
    WATERING: species.wateringRecommendations,
    FERTILIZING: species.fertilizingRecommendations,
    PRUNING: species.pruningRecommendations,
    TRANSPLANTING: species.transplantingRecommendations,
    SOWING: species.sowingPlantingRecommendations,
    PLANTING: species.sowingPlantingRecommendations,
    HARVEST: species.harvestingRecommendations,
  };
  const notes = [guidance[type]];
  if (type === "WATERING") {
    if (species.wateringCheckIntervalDays != null) {
      notes.push(`Перевіряйте умови поливу кожні ${species.wateringCheckIntervalDays} дн.; це інтервал перевірки, не графік поливу.`);
    }
    if (species.soilRecommendations) notes.push(`Ґрунт: ${species.soilRecommendations}`);
  }
  if (["SOWING", "PLANTING", "TRANSPLANTING"].includes(type)) {
    if (species.soilRecommendations) notes.push(`Ґрунт: ${species.soilRecommendations}`);
    if (species.lightRequirements) notes.push(`Світло: ${species.lightRequirements}`);
  }
  if (species.generalCareRecommendations || species.careRecommendations) {
    notes.push(species.generalCareRecommendations || species.careRecommendations);
  }
  return [...new Set(notes.filter((value): value is string => Boolean(value?.trim())))]
    .join(" ");
}
function speciesKnowledgeSummary(species: CareContext): string {
  if (species.id === null) return species.generalCareRecommendations;
  const applicable = (type: string) => !eligibilityError(species, type);
  const notes = [
    applicable("WATERING") ? species.wateringRecommendations : "",
    applicable("WATERING") && species.wateringCheckIntervalDays != null
      ? `Перевірка умов поливу кожні ${species.wateringCheckIntervalDays} дн.; це не частота поливу.`
      : "",
    species.soilRecommendations,
    species.lightRequirements,
    applicable("FERTILIZING") ? species.fertilizingRecommendations : "",
    applicable("PRUNING") ? species.pruningRecommendations : "",
    applicable("TRANSPLANTING") ? species.transplantingRecommendations : "",
    applicable("SOWING") || applicable("PLANTING") ? species.sowingPlantingRecommendations : "",
    applicable("HARVEST") ? species.harvestingRecommendations : "",
    species.generalCareRecommendations || species.careRecommendations,
  ];
  return [...new Set(notes.filter((value): value is string => Boolean(value?.trim())))].join(" ");
}
function weatherReasons(type: string, species: CareContext, weather: WeatherDay, environment: string, rules: SpeciesCareRule[], taskNotes = "") {
  if (!exposed(environment)) return [];
  const limits = thresholds(type, species, rules);
  const reasons: string[] = [];
  if (type === "TREATMENT" && (explicitlyMechanicalTask(taskNotes) || !explicitlySprayTask(taskNotes))) return [];
  const minimum = minForecastTemperature(weather);
  const maximum = maxForecastTemperature(weather);
  if (weather.precipitation > limits.rain) reasons.push(`опади ${weather.precipitation} мм > порогу ${limits.rain} мм (сума за календарну добу)`);
  const wind = Math.max(maxForecastWind(weather), maxForecastGust(weather));
  if (wind > limits.wind) reasons.push(`максимальний вітер ${wind} м/с > порогу ${limits.wind} м/с`);
  if (minimum < limits.min) reasons.push(`мінімальна температура повітря ${minimum}°C < порогу ${limits.min}°C`);
  if (maximum > limits.max) reasons.push(`максимальна температура повітря ${maximum}°C > порогу ${limits.max}°C`);
  const rule = rules.find(item => item.careType === type);
  if (type === "HARVEST" && minimum <= 0 && harvestBeforeCold(species)) reasons.push(`прогнозується заморозок (${minimum}°C), а рекомендації виду вимагають завершити збір до сильних холодів`);
  if (["SOWING", "PLANTING"].includes(type) && minimum <= 0 && frostSensitiveText(textForCare(species, type)) &&
    rule?.minTemperature == null && species.optimalTempMin == null && minimumTemperatureFromKnowledge(species) == null) {
    reasons.push(`прогнозується заморозок (${minimum}°C), а рекомендації виду радять висаджувати після ризику заморозків`);
  }
  if (type === "PRUNING" && minimum <= 0 && frostSensitiveText(textForCare(species, type)) &&
    rule?.minTemperature == null) {
    reasons.push(`прогнозується заморозок (${minimum}°C) під час чутливого до морозу обрізування`);
  }
  return reasons;
}
function missingWeatherMetrics(type: string, species: CareContext, weather: WeatherDay, rules: SpeciesCareRule[]) {
  const limits = thresholds(type, species, rules);
  const hasFullHourlyDay = (weather.hourly?.length ?? 0) >= 23;
  const needsFrostCheck = type === "HARVEST" ? harvestBeforeCold(species) :
    ["SOWING", "PLANTING", "PRUNING"].includes(type) && frostSensitiveText(textForCare(species, type));
  return [
    (Number.isFinite(limits.min) || needsFrostCheck) && numeric(weather.minTemperature) === null && !hasFullHourlyDay
      ? "мінімальна температура за добу невідома; середня температура не замінює перевірку заморозків" : "",
    Number.isFinite(limits.max) && numeric(weather.maxTemperature) === null && !hasFullHourlyDay
      ? "максимальна температура за добу невідома" : "",
    Number.isFinite(limits.wind) && numeric(weather.maxWindSpeed) === null && !hasFullHourlyDay
      ? "максимальна швидкість вітру невідома; середній вітер не підтверджує відповідність порогу" : "",
  ].filter(Boolean);
}
export function isWeatherSuitable(type: string, species: CareContext, weather: WeatherDay, environment: string, rules: SpeciesCareRule[] = [], taskNotes = "") {
  const applicableRules = species.id === null ? [] : rules;
  return !eligibilityError(species, type) &&
    (!exposed(environment) || (type === "TREATMENT" && !explicitlySprayTask(taskNotes)) ||
      missingWeatherMetrics(type, species, weather, applicableRules).length === 0) &&
    weatherWarnings(type, species, weather, environment, applicableRules, taskNotes).length === 0 &&
    weatherReasons(type, species, weather, environment, applicableRules, taskNotes).length === 0;
}

function weatherWarnings(
  type: string,
  species: CareContext,
  weather: WeatherDay,
  environment: string,
  rules: SpeciesCareRule[],
  taskNotes: string,
): string[] {
  if (!weatherRelevant(environment) || !["OUTDOOR", "BALCONY"].includes(environment)) return [];
  const warnings: string[] = [];
  const precipitation = weather.precipitation;
  const minimum = minForecastTemperature(weather);
  const maximum = maxForecastTemperature(weather);
  const wind = Math.max(maxForecastWind(weather), maxForecastGust(weather));
  const maxRain = numeric(rules.find(rule => rule.careType === type)?.rainThresholdMm);
  const maxWind = numeric(rules.find(rule => rule.careType === type)?.maxWindSpeedMps);
  const minLimit = numeric(rules.find(rule => rule.careType === type)?.minTemperature);
  const maxLimit = numeric(rules.find(rule => rule.careType === type)?.maxTemperature);

  if (environment === "BALCONY") {
    if (precipitation > 0 || wind > 0 || minimum <= 0 || maximum >= 35) {
      warnings.push("експозиція балкона невідома; невідомо, чи рослина захищена від опадів і вітру, тому дату автоматично не змінено");
    }
    return warnings;
  }

  if (type === "WATERING") {
    const heatThreshold = numeric(species.optimalTempMax) !== null
      ? Number(species.optimalTempMax) + RULE_PARAMETERS.hotTemperatureDelta : 35;
    if (precipitation >= RULE_PARAMETERS.wateringRainCheckMm) warnings.push(`прогноз опадів ${precipitation} мм на день догляду; перевірте вологість ґрунту, бо опади самі по собі не підтверджують достатнє зволоження`);
    if (maximum >= heatThreshold && precipitation < 2) warnings.push(`спекотний і сухий прогноз (${minimum}–${maximum}°C, поріг перевірки ${heatThreshold}°C, опади ${precipitation} мм); перевірте ґрунт і за потреби полийте раніше`);
    if (precipitation >= RULE_PARAMETERS.wateringRainCheckMm) warnings.push("надійні виміряні опади за попередні 24–48 год недоступні; їх не припущено");
  } else if (type === "FERTILIZING") {
    if (precipitation >= 8) warnings.push(`значні прогнозовані опади (${precipitation} мм) можуть спричинити змивання або стік добрива; ${explicitFertilizingMethod(taskNotes) ? "звірте спосіб внесення з інструкцією добрива" : "спосіб внесення не відомий"}`);
    if (minimum <= 0 || maximum >= 35) warnings.push(`температурний стрес можливий (${minimum}–${maximum}°C); вид добрива і спосіб внесення не відомі`);
    if (maxRain !== null && precipitation > maxRain) warnings.push("поріг опадів задано правилом виду; перевірте інструкцію до конкретного добрива");
  } else if (type === "PRUNING") {
    if (precipitation >= 1 && precipitation <= RULE_PARAMETERS.significantRainMm) warnings.push(`легкі або помірні опади (${precipitation} мм); це не є автоматичною підставою для перенесення, оцініть мокроту рослини та терміновість робіт`);
    if (wind > 8 && maxWind === null) warnings.push(`сильний вітер за прогнозом (${wind} м/с); універсальний поріг для обрізування не задано`);
    if (minimum <= 0 && !frostSensitiveText(textForCare(species, type))) warnings.push(`можливий мороз (${minimum}°C), але чутливість обрізування виду до морозу не визначена`);
  } else if (type === "TRANSPLANTING") {
    if (precipitation >= 8 && maxRain === null) warnings.push(`значні опади (${precipitation} мм); фактичний стан ґрунту невідомий, огляньте його перед пересаджуванням`);
    if (minimum <= 0 || maximum >= 35) warnings.push(`можливий температурний стрес (${minimum}–${maximum}°C); температура повітря не визначає температуру чи вологість ґрунту`);
  } else if (type === "TREATMENT") {
    if (explicitlyMechanicalTask(taskNotes)) return [];
    if ((precipitation > 0 || wind >= RULE_PARAMETERS.safeSprayingWindMps) && !explicitlySprayTask(taskNotes)) {
      warnings.push("спосіб обробки не вказано; правила для обприскування не застосовано, звіртеся з інструкцією препарату");
    } else if (explicitlySprayTask(taskNotes) && (precipitation > 0 || wind >= RULE_PARAMETERS.safeSprayingWindMps || minimum < (minLimit ?? -Infinity) || maximum > (maxLimit ?? Infinity))) {
      warnings.push(`прогноз може вплинути на обприскування (опади ${precipitation} мм, вітер ${wind} м/с, ${minimum}–${maximum}°C); перевірте етикетку препарату`);
    }
  } else if (type === "HARVEST") {
    if (minimum <= 0 && !harvestBeforeCold(species)) warnings.push(`можливий мороз (${minimum}°C), але необхідність зібрати врожай до морозу не підтверджена`);
  } else if (type === "SOWING") {
    if (precipitation >= 8 && maxRain === null) warnings.push(`значні опади (${precipitation} мм) можуть вимити насіння; стан ґрунту за прогнозом невідомий`);
    if (minimum <= 0 && !frostSensitiveText(textForCare(species, type))) warnings.push(`можливий мороз (${minimum}°C); температурний поріг для цього посіву не задано`);
  } else if (type === "PLANTING") {
    if (precipitation >= 8 && maxRain === null) warnings.push(`значні опади (${precipitation} мм); фактичний стан ґрунту невідомий`);
    if (wind > 8 && maxWind === null) warnings.push(`сильний вітер за прогнозом (${wind} м/с); перевірте потребу в опорі чи захисті`);
    if (maximum >= 35 && maxLimit === null) warnings.push(`спекотний прогноз (${maximum}°C); оцініть можливість поливу чи тимчасового захисту`);
    if (minimum <= 0 && !frostSensitiveText(textForCare(species, type))) warnings.push(`можливий мороз (${minimum}°C); видовий поріг не задано, температура ґрунту невідома`);
  }
  return warnings;
}
export function generateRules(
  species: CareContext,
  tasks: CareTask[],
  forecast: WeatherDay[],
  location: string,
  environment: string,
  lastWatered: string | null,
  rules: SpeciesCareRule[] = [],
  lastCompletedByType: Record<string, string> = {},
): RecommendationDraft[] {
  if (!forecast.length) return [];
  tasks = tasks.filter(task => !eligibilityError(species, task.type));
  rules = species.id === null ? [] : rules.filter(rule => !eligibilityError(species, rule.careType));
  if (eligibilityError(species, "WATERING")) lastWatered = null;
  const completedByType = Object.fromEntries(
    Object.entries(lastCompletedByType).filter(([type]) => !eligibilityError(species, type)),
  );
  if (lastWatered && !completedByType.WATERING) completedByType.WATERING = lastWatered;
  const basis = eligibilityBasis(species);
  const results: RecommendationDraft[] = [];
  const today = todayInKyiv();
  const elapsed = (date: string) => Math.max(0, Math.floor((Date.parse(today) - Date.parse(date.slice(0, 10))) / 86400000));
  const environments: Record<string, string> = { INDOOR: "приміщення", BALCONY: "балкон", OUTDOOR: "надворі", GREENHOUSE: "теплиця" };
  const environmentLabel = environments[environment] ?? environment;
  const wateringRule = rules.find(rule => rule.careType === "WATERING");
  const conditionBasedWatering = Boolean(wateringRule?.triggerDescription);
  for (const task of [...tasks].sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate) || a.id - b.id)) {
    if (!["PLANNED", "POSTPONED"].includes(task.status)) continue;
    const overdue = elapsed(task.scheduledDate);
    const weather = overdue > 0
      ? forecast.find(day => day.date === today)
      : forecast.find(day => day.date === task.scheduledDate);
    const taskRule = rules.find(rule => rule.careType === task.type);
    const limits = thresholds(task.type, species, rules);
    const taskNotes = typeof task.notes === "string" ? task.notes : "";
    const missingMetrics = weather && exposed(environment) && (task.type !== "TREATMENT" || explicitlySprayTask(taskNotes))
      ? missingWeatherMetrics(task.type, species, weather, rules) : [];
    let reasons = weather && !missingMetrics.length ? weatherReasons(task.type, species, weather, environment, rules, taskNotes) : [];
    const warnings = weather ? weatherWarnings(task.type, species, weather, environment, rules, taskNotes) : [];
    warnings.push(...missingMetrics);
    if (task.type === "FERTILIZING" && !explicitFertilizingMethod(taskNotes) && reasons.length) {
      warnings.push(...reasons, "спосіб внесення добрива невідомий; погодний поріг не є достатньою підставою для певної зміни дати");
      reasons = [];
    }
    if (task.type === "WATERING" && exposed(environment) && task.scheduledDate > today) {
      const previousDate = new Date(Date.parse(`${task.scheduledDate}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
      const precedingForecast = previousDate >= today ? forecast.find(day => day.date === previousDate) : undefined;
      if (precedingForecast && precedingForecast.precipitation >= RULE_PARAMETERS.wateringRainCheckMm) {
        warnings.push(`перед поливом, ${previousDate}, прогнозуються опади ${precedingForecast.precipitation} мм; це прогноз за попередню календарну добу, не виміряний дощ і не доказ вологості ґрунту — перевірте ґрунт перед дією`);
      }
    }
    let priority = task.priority;
    const priorityReasons: string[] = [];
    if (overdue > 0) {
      priority = higherPriority(priority, overdue >= RULE_PARAMETERS.overdueUrgentDays ? "URGENT" : "HIGH");
      priorityReasons.push(`завдання прострочене на ${overdue} дн.`);
    }
    if (task.postponementCount >= 3) {
      priority = higherPriority(priority, "HIGH");
      priorityReasons.push(`завдання вже переносили ${task.postponementCount} рази`);
    }
    const lastCompleted = completedByType[task.type] ?? null;
    const careInterval = intervalForCare(species, task.type, taskRule);
    if (lastCompleted && careInterval) {
      const days = elapsed(lastCompleted);
      const intervalOverdue = days - careInterval.days;
      if (intervalOverdue > 0) {
        priority = higherPriority(priority, intervalOverdue > RULE_PARAMETERS.overdueUrgentDays ? "URGENT" : "HIGH");
        const condition = taskRule?.triggerDescription ? `; перевірте умову перед дією: ${taskRule.triggerDescription}` : "";
        priorityReasons.push(`останній догляд «${labels[task.type] ?? task.type}» виконано ${lastCompleted.slice(0, 10)} (${days} дн. тому), ${careInterval.explanation}, перевищення — ${intervalOverdue} дн.${condition}`);
      }
    }
    if (species.id !== null && task.type === "WATERING" && species.optimalTempMax !== null && weather && exposed(environment) && weather.temperature >= Number(species.optimalTempMax) + RULE_PARAMETERS.hotTemperatureDelta && weather.precipitation < 2) {
      priority = higherPriority(priority, "HIGH");
      priorityReasons.push(`температура ${weather.temperature}°C ≥ ${Number(species.optimalTempMax) + RULE_PARAMETERS.hotTemperatureDelta}°C, опади ${weather.precipitation} мм < 2 мм`);
    }
    const historyNote = lastCompleted
      ? `Останню дію «${labels[task.type] ?? task.type}» виконано ${lastCompleted.slice(0, 10)}.`
      : `Історії виконання дії «${labels[task.type] ?? task.type}» немає.`;
    const context = `${species.id === null ? `Рослина поза довідником: «${species.name}».` : `Вид: «${species.name}».`} ${basis} Локація: «${location}». Середовище: ${environmentLabel}. Застосовано ${limits.source}. ${limits.notes} ${taskKnowledge(species, task.type)} ${historyNote} ${weatherRelevant(environment) ? "Час виконання не задано; оцінено календарну добу за Europe/Kyiv, а не конкретну годину. Зовнішній прогноз не вимірює стан ґрунту." : ""}`;
    if (weatherRelevant(environment) && task.scheduledDate <= today && !weather) {
      results.push({
        type: "WEATHER_WARNING",
        text: `${labels[task.type] ?? "Догляд"}: погоду на день виконання не перевірено.`,
        priority: higherPriority(priority, "HIGH"),
        explanation: `${context} ${priorityReasons.length ? `${priorityReasons.join("; ")}. ` : ""}Для завдання на ${task.scheduledDate} немає прогнозу на ${overdue > 0 ? `сьогодні (${today})` : "запланований день"}. Погодні умови невідомі; не вважайте дію безпечною лише через відсутність прогнозу. Дату не змінено.`,
        relatedTaskId: task.id, originalDate: task.scheduledDate, suggestedDate: null, weather: forecast[0],
      });
      continue;
    }
    if (weather && reasons.length) {
      const harvestNeedsEarlier = task.type === "HARVEST" &&
        (reasons.some(reason => /заморозок/.test(reason)) || minForecastTemperature(weather) < limits.min);
      const plantingNeedsEarlier = task.type === "PLANTING" && maxForecastTemperature(weather) > limits.max;
      const earlier = harvestNeedsEarlier || plantingNeedsEarlier;
      const pivotDate = overdue > 0 ? today : task.scheduledDate;
      const alternatives = [...forecast].sort((a, b) => a.date.localeCompare(b.date));
      const alternative = earlier
        ? alternatives.filter(day => day.date >= today && day.date < task.scheduledDate).reverse()
          .find(day => isWeatherSuitable(task.type, species, day, environment, rules, taskNotes))
        : alternatives.filter(day => day.date > pivotDate)
          .find(day => isWeatherSuitable(task.type, species, day, environment, rules, taskNotes));
      const dateChangeType = earlier ? "раніше виконати" : "перенести";
      const riskDate = weather.date;
      priority = higherPriority(priority, "HIGH");
      results.push({
        type: alternative ? "WEATHER_RESCHEDULE" : "WEATHER_WARNING",
        text: alternative
          ? `${labels[task.type] ?? "Догляд"} рекомендовано ${dateChangeType} на ${alternative.date}.`
          : `${labels[task.type] ?? "Догляд"} потребує перевірки погодних умов.`,
        priority,
        explanation: `${context} ${priorityReasons.length ? `${priorityReasons.join("; ")}. ` : ""}Прогноз на ${riskDate}: ${reasons.join("; ")}. ${warnings.join(". ")}${alternative
          ? ` Найближча дата в доступному прогнозі, що відповідає застосованим правилам: ${alternative.date}.`
          : " Придатної дати в доступному прогнозі немає; дату не змінено."} ${earlier ? `Рекомендовано виконати раніше: ${alternative?.date ?? "придатну дату не знайдено"}.` : `Рекомендовано перенести: ${alternative?.date ?? "придатну дату не знайдено"}.`} Дату буде змінено лише після вашого підтвердження.`,
        relatedTaskId: task.id, originalDate: task.scheduledDate, suggestedDate: alternative?.date ?? null, weather,
      });
      continue;
    }
    if (warnings.length) {
      results.push({
        type: "WEATHER_WARNING",
        text: `${labels[task.type] ?? "Догляд"} потребує перевірки погодних умов.`,
        priority: higherPriority(priority, "MEDIUM"),
        explanation: `${context} ${priorityReasons.length ? `${priorityReasons.join("; ")}. ` : ""}Прогноз на ${weather?.date ?? task.scheduledDate}: ${warnings.join(". ")}. Погодні дані є орієнтиром, а не вимірюванням умов біля рослини; дату автоматично не змінено.`,
        relatedTaskId: task.id, originalDate: task.scheduledDate, suggestedDate: null, weather: weather ?? forecast[0],
      });
      continue;
    }
    if (priority !== task.priority || priorityReasons.length > 0) results.push({
      type: "PRIORITY", text: `${labels[task.type] ?? "Догляд"} має ${priority === "URGENT" ? "терміновий" : "високий"} пріоритет.`, priority,
      explanation: `${context} ${priorityReasons.join("; ")}. Ручний пріоритет не знижено.${!exposed(environment) ? " Зовнішні опади не впливають на полив у цьому середовищі." : ""}`,
      relatedTaskId: task.id, originalDate: task.scheduledDate, suggestedDate: null, weather: weather ?? forecast[0],
    });
  }
  if (!results.length) {
    const activeCount = tasks.filter(task => ["PLANNED", "POSTPONED"].includes(task.status)).length;
    const checks = rules.map(rule => {
      const limits = thresholds(rule.careType, species, rules);
      const parameters = [
        Number.isFinite(limits.rain) ? `поріг опадів — ${limits.rain} мм` : "",
        Number.isFinite(limits.wind) ? `максимальний вітер — ${limits.wind} м/с` : "",
        Number.isFinite(limits.min) ? `мінімальна температура — ${limits.min}°C` : "",
        Number.isFinite(limits.max) ? `максимальна температура — ${limits.max}°C` : "",
      ].filter(Boolean).join("; ");
      const reasons = weatherReasons(rule.careType, species, forecast[0], environment, rules);
      return `${labels[rule.careType] ?? "Догляд"}: застосовано ${limits.source}; ${parameters}. ${exposed(environment) ? `Прогноз на ${forecast[0].date}: ${forecast[0].precipitation} мм, ${forecast[0].windSpeed} м/с, ${forecast[0].temperature}°C. ${reasons.length ? `Пороги спрацювали: ${reasons.join("; ")}.` : "Прогноз відповідає цим порогам."}` : "Зовнішній прогноз не використано для оцінки умов у приміщенні чи теплиці."} ${limits.notes}`;
    });
    const risk = rules.some(rule => weatherReasons(rule.careType, species, forecast[0], environment, rules).length > 0);
    const historySummary = Object.entries(completedByType)
      .filter(([type]) => labels[type])
      .map(([type, completedAt]) => `${labels[type]} — ${completedAt.slice(0, 10)}`)
      .join("; ");
    const overdueHistory = Object.entries(completedByType).flatMap(([type, completedAt]) => {
      const interval = intervalForCare(species, type, rules.find(rule => rule.careType === type));
      const days = elapsed(completedAt);
      if (!interval || days <= interval.days) return [];
      const exceededBy = days - interval.days;
      const condition = rules.find(rule => rule.careType === type)?.triggerDescription;
      return [{
        type,
        days,
        interval: interval.explanation,
        exceededBy,
        condition,
        priority: exceededBy > RULE_PARAMETERS.overdueUrgentDays ? "URGENT" : "HIGH",
      }];
    });
    const historyPriority = overdueHistory.reduce((current, item) => higherPriority(current, item.priority), "LOW");
    const historyUrgencyText = overdueHistory.length
      ? `Минув перевірений інтервал для: ${overdueHistory.map(item => `${labels[item.type] ?? item.type} — ${item.days} дн. після останньої дії, ${item.interval}${item.condition ? `; перевірте умову: ${item.condition}` : ""}`).join("; ")}.`
      : "";
    const wateringHistory = lastWatered
      ? `Останній виконаний полив: ${lastWatered.slice(0, 10)}; ${intervalForCare(species, "WATERING", wateringRule)
        ? `${intervalForCare(species, "WATERING", wateringRule)?.explanation}${elapsed(lastWatered) > (intervalForCare(species, "WATERING", wateringRule)?.days ?? Infinity)
          ? `, перевищення — ${elapsed(lastWatered) - (intervalForCare(species, "WATERING", wateringRule)?.days ?? 0)} дн.`
          : ""}`
        : conditionBasedWatering
        ? `автоматичне прострочення за фіксованою частотою не застосовано; перевірте умову виду: ${wateringRule?.triggerDescription}.`
        : species.id === null || species.wateringFrequencyDays === null
          ? "інтервал поливу невідомий, прострочення поливу не припущено"
          : `орієнтовний інтервал виду — ${species.wateringFrequencyDays} дн.`}.`
      : eligibilityError(species, "WATERING")
        ? "Полив не застосовується до цього виду."
        : "Історії виконаного поливу немає: дату не припущено.";
    results.push({
      type: "GENERAL",
      text: species.id === null
        ? `Загальні поради для категорії рослини «${species.name}». Видові ризики та частота догляду невідомі.`
        : risk
          ? `Для ${species.name} прогноз виходить за пороги правил виду. Перевірте умови догляду.`
        : overdueHistory.length
          ? `Перевірте ${overdueHistory.map(item => (labels[item.type] ?? item.type).toLocaleLowerCase("uk")).join(" та ")} для ${species.name}: минув перевірений інтервал після останньої дії.`
          : conditionBasedWatering
            ? `Перевірте умову поливу для ${species.name}: ${wateringRule?.triggerDescription}.`
            : `Для ${species.name} немає критичних змін у плані догляду.`,
      priority: higherPriority(risk ? "MEDIUM" : "LOW", historyPriority),
      explanation: `${basis} Локація: «${location}». Середовище: ${environmentLabel}. Перевірено ${activeCount} активних завдань і доступний прогноз. ${checks.join(" ")} ${wateringHistory} ${historySummary ? `Останні виконані дії: ${historySummary}.` : ""} ${historyUrgencyText} ${!exposed(environment) && !eligibilityError(species, "WATERING") ? "Зовнішній дощ і вітер не є підставою для перенесення догляду. Умови приміщення чи теплиці не оцінено за зовнішнім прогнозом." : ""} Завдання не створено, дати не змінено. ${speciesKnowledgeSummary(species)}`,
      relatedTaskId: null, originalDate: null, suggestedDate: null, weather: forecast[0],
    });
  }
  return results;
}
