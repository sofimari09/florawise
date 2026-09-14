import type { PlantSpecies, CareTask } from "@workspace/db";
import type { WeatherDay } from "./weather";

export type RecommendationDraft = {
  type: string;
  text: string;
  priority: string;
  explanation: string;
  relatedTaskId: number | null;
  originalDate: string | null;
  suggestedDate: string | null;
  weather: WeatherDay;
};

export const RULE_PARAMETERS = {
  significantRainMm: 8,
  safeSprayingWindMps: 8,
  overdueUrgentDays: 5,
  hotTemperatureDelta: 5,
};

export function isWeatherSuitable(
  taskType: string,
  species: PlantSpecies,
  forecast: WeatherDay,
): boolean {
  if (taskType === "TREATMENT" && (forecast.precipitation >= 1 || forecast.windSpeed > RULE_PARAMETERS.safeSprayingWindMps)) return false;
  if (taskType === "PRUNING" && (forecast.precipitation >= RULE_PARAMETERS.significantRainMm || forecast.windSpeed > RULE_PARAMETERS.safeSprayingWindMps)) return false;
  if (["WATERING", "FERTILIZING", "HARVEST"].includes(taskType) && forecast.precipitation >= RULE_PARAMETERS.significantRainMm) return false;
  if (taskType === "TRANSPLANTING" && (forecast.temperature < Number(species.optimalTempMin) - 3 || forecast.temperature > Number(species.optimalTempMax) + 3)) return false;
  return true;
}

function nextSuitable(task: CareTask, species: PlantSpecies, forecast: WeatherDay[]): WeatherDay | null {
  const index = forecast.findIndex((day) => day.date === task.scheduledDate);
  return forecast.slice(Math.max(index + 1, 1)).find((day) => isWeatherSuitable(task.type, species, day)) ?? null;
}

export function generateRules(
  species: PlantSpecies,
  tasks: CareTask[],
  forecast: WeatherDay[],
  location: string,
  lastWatered: string | null,
): RecommendationDraft[] {
  const results: RecommendationDraft[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const dateDistance = (date: string) => Math.max(0, Math.ceil((Date.parse(today) - Date.parse(date)) / 86400000));
  for (const task of tasks) {
    const weather = forecast.find((day) => day.date === task.scheduledDate) ?? forecast[0];
    if (!weather) continue;
    const outdoor = /балкон|сад|двір|терас|город|теплиц/i.test(location);
    const alternative = nextSuitable(task, species, forecast);
    const overdueDays = dateDistance(task.scheduledDate);
    let priority = task.priority;
    if (task.type === "WATERING" && outdoor && weather.precipitation >= RULE_PARAMETERS.significantRainMm) {
      results.push({
        type: "WEATHER_RESCHEDULE",
        text: `Полив рекомендовано перенести з ${task.scheduledDate} через значні опади.`,
        priority: "HIGH",
        explanation: `На ${task.scheduledDate} для локації «${location}» прогнозується ${weather.precipitation} мм опадів. Для вуличної рослини додатковий полив не потрібен.`,
        relatedTaskId: task.id,
        originalDate: task.scheduledDate,
        suggestedDate: alternative?.date ?? null,
        weather,
      });
      continue;
    }
    if (task.type === "TREATMENT" && (weather.precipitation >= 1 || weather.windSpeed > RULE_PARAMETERS.safeSprayingWindMps)) {
      const reason = weather.windSpeed > RULE_PARAMETERS.safeSprayingWindMps
        ? `швидкість вітру ${weather.windSpeed} м/с перевищує безпечний поріг`
        : `на цю дату прогнозується дощ`;
      results.push({
        type: "WEATHER_RESCHEDULE",
        text: `Обробку рекомендовано перенести${alternative ? ` на ${alternative.date}` : ""}.`,
        priority: "HIGH",
        explanation: `На ${task.scheduledDate} ${reason}. Найближча сприятлива дата у доступному прогнозі${alternative ? ` — ${alternative.date}.` : " не знайдена."}`,
        relatedTaskId: task.id,
        originalDate: task.scheduledDate,
        suggestedDate: alternative?.date ?? null,
        weather,
      });
      continue;
    }
    if (task.type === "PRUNING" && (weather.precipitation >= RULE_PARAMETERS.significantRainMm || weather.windSpeed > RULE_PARAMETERS.safeSprayingWindMps)) {
      results.push({
        type: "WEATHER_RESCHEDULE",
        text: `Обрізку рекомендовано перенести${alternative ? ` на ${alternative.date}` : ""}.`,
        priority: "MEDIUM",
        explanation: `Опади ${weather.precipitation} мм або вітер ${weather.windSpeed} м/с роблять обрізку несприятливою. Умови перевірено за правилами для виду «${species.name}».`,
        relatedTaskId: task.id,
        originalDate: task.scheduledDate,
        suggestedDate: alternative?.date ?? null,
        weather,
      });
      continue;
    }
    if (task.type === "TRANSPLANTING" && !isWeatherSuitable(task.type, species, weather)) {
      results.push({
        type: "WEATHER_RESCHEDULE",
        text: `Пересадку рекомендовано перенести${alternative ? ` на ${alternative.date}` : ""}.`,
        priority: "MEDIUM",
        explanation: `Температура ${weather.temperature}°C виходить за прийнятний діапазон для ${species.name} (${species.optimalTempMin}–${species.optimalTempMax}°C).`,
        relatedTaskId: task.id,
        originalDate: task.scheduledDate,
        suggestedDate: alternative?.date ?? null,
        weather,
      });
      continue;
    }
    if (task.type === "FERTILIZING" && outdoor && weather.precipitation >= RULE_PARAMETERS.significantRainMm) {
      results.push({
        type: "WEATHER_RESCHEDULE",
        text: `Підживлення краще перенести${alternative ? ` на ${alternative.date}` : ""}.`,
        priority: "MEDIUM",
        explanation: `Значні опади ${weather.precipitation} мм можуть знизити ефективність добрива для вуличної рослини.`,
        relatedTaskId: task.id,
        originalDate: task.scheduledDate,
        suggestedDate: alternative?.date ?? null,
        weather,
      });
      continue;
    }
    if (task.type === "WATERING" && weather.temperature >= Number(species.optimalTempMax) + RULE_PARAMETERS.hotTemperatureDelta && weather.precipitation < 2) priority = "HIGH";
    if (task.type === "WATERING" && lastWatered) {
      const daysSinceWatering = dateDistance(lastWatered);
      if (daysSinceWatering > species.wateringFrequencyDays) priority = daysSinceWatering > species.wateringFrequencyDays + RULE_PARAMETERS.overdueUrgentDays ? "URGENT" : "HIGH";
    }
    if (overdueDays > 0 && task.type === "PRUNING" && isWeatherSuitable(task.type, species, weather)) priority = "HIGH";
    if (priority !== task.priority || task.status === "PLANNED" && task.scheduledDate < today) {
      results.push({
        type: "PRIORITY",
        text: `${task.type === "WATERING" ? "Полив" : task.type === "PRUNING" ? "Обрізка" : "Догляд"} має ${priority === "URGENT" ? "терміновий" : "високий"} пріоритет.`,
        priority,
        explanation: `Завдання ${task.scheduledDate < today ? "прострочене" : "наближається"}; враховано ручний пріоритет, інтервал догляду для ${species.name}, погодні умови та ${task.postponementCount} попередніх перенесень.`,
        relatedTaskId: task.id,
        originalDate: task.scheduledDate,
        suggestedDate: null,
        weather,
      });
    }
  }
  if (results.length === 0) {
    const weather = forecast[0];
    results.push({
      type: "GENERAL",
      text: `Для ${species.name} зараз немає критичних змін у плані догляду.`,
      priority: "LOW",
      explanation: `Перевірено ${tasks.length} запланованих завдань, характеристики виду та прогноз на 7 днів. Умови виглядають сприятливо.`,
      relatedTaskId: null,
      originalDate: null,
      suggestedDate: null,
      weather,
    });
  }
  return results;
}