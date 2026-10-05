import type { PlantSpecies, CareTask, SpeciesCareRule } from "@workspace/db";
import type { WeatherDay } from "./weather";

export type RecommendationDraft = {
  type: string; text: string; priority: string; explanation: string;
  relatedTaskId: number | null; originalDate: string | null; suggestedDate: string | null; weather: WeatherDay;
};
export const RULE_PARAMETERS = { significantRainMm: 8, safeSprayingWindMps: 8, overdueUrgentDays: 5, hotTemperatureDelta: 5 };
const exposed = (environment: string) => ["BALCONY", "OUTDOOR"].includes(environment);
const labels: Record<string, string> = { WATERING: "Полив", FERTILIZING: "Підживлення", PRUNING: "Обрізка", TRANSPLANTING: "Пересадка", TREATMENT: "Обробка", HARVEST: "Збір урожаю" };
const priorityRank: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, URGENT: 3 };
const higherPriority = (a: string, b: string) => priorityRank[a] >= priorityRank[b] ? a : b;
function thresholds(type: string, species: PlantSpecies, rules: SpeciesCareRule[]) {
  const rule = rules.find(item => item.careType === type);
  return {
    rain: rule?.rainThresholdMm !== null && rule?.rainThresholdMm !== undefined ? Number(rule.rainThresholdMm) : type === "TREATMENT" ? 1 : ["WATERING", "FERTILIZING", "PRUNING", "HARVEST"].includes(type) ? RULE_PARAMETERS.significantRainMm : Infinity,
    wind: rule?.maxWindSpeedMps !== null && rule?.maxWindSpeedMps !== undefined ? Number(rule.maxWindSpeedMps) : ["TREATMENT", "PRUNING"].includes(type) ? RULE_PARAMETERS.safeSprayingWindMps : Infinity,
    min: rule?.minTemperature !== null && rule?.minTemperature !== undefined ? Number(rule.minTemperature) : type === "TRANSPLANTING" ? Number(species.optimalTempMin) - 3 : -Infinity,
    max: rule?.maxTemperature !== null && rule?.maxTemperature !== undefined ? Number(rule.maxTemperature) : type === "TRANSPLANTING" ? Number(species.optimalTempMax) + 3 : Infinity,
    source: rule ? `правило виду «${species.name}»` : `базові правила FloraWise та характеристики виду «${species.name}»`,
    notes: rule?.notes ?? "",
  };
}
function weatherReasons(type: string, species: PlantSpecies, weather: WeatherDay, environment: string, rules: SpeciesCareRule[]) {
  if (!exposed(environment)) return [];
  const limits = thresholds(type, species, rules);
  const reasons: string[] = [];
  if (weather.precipitation >= limits.rain) reasons.push(`опади ${weather.precipitation} мм ≥ порогу ${limits.rain} мм`);
  if (weather.windSpeed > limits.wind) reasons.push(`вітер ${weather.windSpeed} м/с > порогу ${limits.wind} м/с`);
  if (weather.temperature < limits.min) reasons.push(`температура ${weather.temperature}°C < мінімуму ${limits.min}°C`);
  if (weather.temperature > limits.max) reasons.push(`температура ${weather.temperature}°C > максимуму ${limits.max}°C`);
  return reasons;
}
export function isWeatherSuitable(type: string, species: PlantSpecies, weather: WeatherDay, environment: string, rules: SpeciesCareRule[] = []) {
  return weatherReasons(type, species, weather, environment, rules).length === 0;
}
export function generateRules(species: PlantSpecies, tasks: CareTask[], forecast: WeatherDay[], location: string, environment: string, lastWatered: string | null, rules: SpeciesCareRule[] = []): RecommendationDraft[] {
  if (!forecast.length) return [];
  const results: RecommendationDraft[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const elapsed = (date: string) => Math.max(0, Math.floor((Date.parse(today) - Date.parse(date.slice(0, 10))) / 86400000));
  const environments: Record<string, string> = { INDOOR: "приміщення", BALCONY: "балкон", OUTDOOR: "надворі", GREENHOUSE: "теплиця" };
  const environmentLabel = environments[environment] ?? environment;
  for (const task of [...tasks].sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate) || a.id - b.id)) {
    if (!["PLANNED", "POSTPONED"].includes(task.status)) continue;
    const weather = forecast.find(day => day.date === task.scheduledDate) ?? (task.scheduledDate < today ? forecast[0] : undefined);
    const limits = thresholds(task.type, species, rules);
    const reasons = weather ? weatherReasons(task.type, species, weather, environment, rules) : [];
    const context = `Вид: «${species.name}». Локація: «${location}». Середовище: ${environmentLabel}. Застосовано ${limits.source}.`;
    if (weather && reasons.length) {
      const earliest = task.scheduledDate < today ? today : task.scheduledDate;
      const alternative = forecast.find(day => day.date > earliest && isWeatherSuitable(task.type, species, day, environment, rules));
      results.push({
        type: "WEATHER_RESCHEDULE", text: `${labels[task.type] ?? "Догляд"} рекомендовано перенести${alternative ? ` на ${alternative.date}` : ""}.`,
        priority: higherPriority(task.priority, "HIGH"), explanation: `${context} Прогноз на ${weather.date}: ${reasons.join("; ")}. ${alternative ? `Наступна дата, що відповідає тим самим порогам: ${alternative.date}.` : "Сприятливої дати в доступному прогнозі немає."} ${limits.notes} Дату буде змінено лише після вашого підтвердження.`,
        relatedTaskId: task.id, originalDate: task.scheduledDate, suggestedDate: alternative?.date ?? null, weather,
      });
      continue;
    }
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
    if (task.type === "WATERING" && lastWatered) {
      const days = elapsed(lastWatered);
      if (days > species.wateringFrequencyDays) {
        priority = higherPriority(priority, days > species.wateringFrequencyDays + RULE_PARAMETERS.overdueUrgentDays ? "URGENT" : "HIGH");
        priorityReasons.push(`останній виконаний полив: ${lastWatered.slice(0, 10)} (${days} дн. тому), інтервал виду — ${species.wateringFrequencyDays} дн.`);
      }
    }
    if (task.type === "WATERING" && weather && exposed(environment) && weather.temperature >= Number(species.optimalTempMax) + RULE_PARAMETERS.hotTemperatureDelta && weather.precipitation < 2) {
      priority = higherPriority(priority, "HIGH");
      priorityReasons.push(`температура ${weather.temperature}°C ≥ ${Number(species.optimalTempMax) + RULE_PARAMETERS.hotTemperatureDelta}°C, опади ${weather.precipitation} мм < 2 мм`);
    }
    if (priority !== task.priority || overdue > 0) results.push({
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
    results.push({
      type: "GENERAL",
      text: risk ? `Для ${species.name} прогноз виходить за пороги правил виду. Перевірте умови догляду.` : `Для ${species.name} немає критичних змін у плані догляду.`,
      priority: risk ? "MEDIUM" : "LOW",
      explanation: `Локація: «${location}». Середовище: ${environmentLabel}. Перевірено ${activeCount} активних завдань і доступний прогноз. ${checks.join(" ")} ${lastWatered ? `Останній виконаний полив: ${lastWatered.slice(0, 10)}; орієнтовний інтервал виду — ${species.wateringFrequencyDays} дн.` : "Історії виконаного поливу немає: дату не припущено."} ${!exposed(environment) ? "Зовнішній дощ не є підставою для перенесення поливу." : ""} Завдання не створено, дати не змінено. ${species.generalCareRecommendations ?? species.careRecommendations}`,
      relatedTaskId: null, originalDate: null, suggestedDate: null, weather: forecast[0],
    });
  }
  return results;
}
