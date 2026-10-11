import type { PlantSpecies, CareTask, SpeciesCareRule } from "@workspace/db";
import type { WeatherDay } from "./weather";
import { CARE_LABELS, eligibilityError, eligibilityBasis } from "@workspace/plant-care";
import type { CareContext } from "./effective-care";

export type RecommendationDraft = {
  type: string; text: string; priority: string; explanation: string;
  relatedTaskId: number | null; originalDate: string | null; suggestedDate: string | null; weather: WeatherDay;
};
export const RULE_PARAMETERS = { significantRainMm: 8, safeSprayingWindMps: 8, overdueUrgentDays: 5, hotTemperatureDelta: 5 };
const exposed = (environment: string) => ["BALCONY", "OUTDOOR"].includes(environment);
const labels: Record<string, string> = CARE_LABELS;
const priorityRank: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, URGENT: 3 };
const higherPriority = (a: string, b: string) => priorityRank[a] >= priorityRank[b] ? a : b;
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
  return {
    rain: rule?.rainThresholdMm !== null && rule?.rainThresholdMm !== undefined ? Number(rule.rainThresholdMm) : type === "TREATMENT" ? 1 : ["WATERING", "FERTILIZING", "PRUNING", "HARVEST"].includes(type) ? RULE_PARAMETERS.significantRainMm : Infinity,
    wind: rule?.maxWindSpeedMps !== null && rule?.maxWindSpeedMps !== undefined ? Number(rule.maxWindSpeedMps) : ["TREATMENT", "PRUNING"].includes(type) ? RULE_PARAMETERS.safeSprayingWindMps : Infinity,
    min: rule?.minTemperature !== null && rule?.minTemperature !== undefined ? Number(rule.minTemperature) : type === "TRANSPLANTING" && species.id !== null && species.optimalTempMin !== null ? Number(species.optimalTempMin) - 3 : -Infinity,
    max: rule?.maxTemperature !== null && rule?.maxTemperature !== undefined ? Number(rule.maxTemperature) : type === "TRANSPLANTING" && species.id !== null && species.optimalTempMax !== null ? Number(species.optimalTempMax) + 3 : Infinity,
    source: species.id === null
      ? "загальні погодні правила FloraWise для дій категорії; видові межі невідомі, відповідність цим правилам не означає безпечність усіх умов"
      : hasSpeciesWeatherThresholds ? `погодні пороги правила виду «${species.name}»` : rule ? `загальні погодні правила FloraWise; додатково застосовано знання виду «${species.name}»` : `базові правила FloraWise та характеристики виду «${species.name}»`,
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
function weatherReasons(type: string, species: CareContext, weather: WeatherDay, environment: string, rules: SpeciesCareRule[]) {
  if (!exposed(environment)) return [];
  const limits = thresholds(type, species, rules);
  const reasons: string[] = [];
  if (weather.precipitation >= limits.rain) reasons.push(`опади ${weather.precipitation} мм ≥ порогу ${limits.rain} мм`);
  if (weather.windSpeed > limits.wind) reasons.push(`вітер ${weather.windSpeed} м/с > порогу ${limits.wind} м/с`);
  if (weather.temperature < limits.min) reasons.push(`температура ${weather.temperature}°C < мінімуму ${limits.min}°C`);
  if (weather.temperature > limits.max) reasons.push(`температура ${weather.temperature}°C > максимуму ${limits.max}°C`);
  return reasons;
}
export function isWeatherSuitable(type: string, species: CareContext, weather: WeatherDay, environment: string, rules: SpeciesCareRule[] = []) {
  return !eligibilityError(species, type) && weatherReasons(type, species, weather, environment, species.id === null ? [] : rules).length === 0;
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
  const today = new Date().toISOString().slice(0, 10);
  const elapsed = (date: string) => Math.max(0, Math.floor((Date.parse(today) - Date.parse(date.slice(0, 10))) / 86400000));
  const environments: Record<string, string> = { INDOOR: "приміщення", BALCONY: "балкон", OUTDOOR: "надворі", GREENHOUSE: "теплиця" };
  const environmentLabel = environments[environment] ?? environment;
  const wateringRule = rules.find(rule => rule.careType === "WATERING");
  const conditionBasedWatering = Boolean(wateringRule?.triggerDescription);
  for (const task of [...tasks].sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate) || a.id - b.id)) {
    if (!["PLANNED", "POSTPONED"].includes(task.status)) continue;
    const weather = forecast.find(day => day.date === task.scheduledDate) ?? (task.scheduledDate < today ? forecast[0] : undefined);
    const taskRule = rules.find(rule => rule.careType === task.type);
    const limits = thresholds(task.type, species, rules);
    const reasons = weather ? weatherReasons(task.type, species, weather, environment, rules) : [];
    let priority = task.priority;
    const priorityReasons: string[] = [];
    const overdue = elapsed(task.scheduledDate);
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
    const context = `${species.id === null ? `Рослина поза довідником: «${species.name}».` : `Вид: «${species.name}».`} ${basis} Локація: «${location}». Середовище: ${environmentLabel}. Застосовано ${limits.source}. ${limits.notes} ${taskKnowledge(species, task.type)} ${historyNote}`;
    if (weather && reasons.length) {
      const earliest = task.scheduledDate < today ? today : task.scheduledDate;
      const alternative = forecast.find(day => day.date > earliest && isWeatherSuitable(task.type, species, day, environment, rules));
      priority = higherPriority(priority, "HIGH");
      results.push({
        type: "WEATHER_RESCHEDULE", text: `${labels[task.type] ?? "Догляд"} рекомендовано перенести${alternative ? ` на ${alternative.date}` : ""}.`,
        priority, explanation: `${context} ${priorityReasons.length ? `${priorityReasons.join("; ")}. ` : ""}Прогноз на ${weather.date}: ${reasons.join("; ")}. ${alternative ? `Наступна дата, що відповідає тим самим порогам: ${alternative.date}.` : "Сприятливої дати в доступному прогнозі немає."} Дату буде змінено лише після вашого підтвердження.`,
        relatedTaskId: task.id, originalDate: task.scheduledDate, suggestedDate: alternative?.date ?? null, weather,
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
