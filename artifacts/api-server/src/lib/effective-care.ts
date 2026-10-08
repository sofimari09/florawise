import type { PlantSpecies, Plant } from "@workspace/db";
import { isCategory, CATEGORY_LABELS } from "@workspace/plant-care";

export type CustomCareContext = {
  id: null; name: string; category: string; applicableCareTypes: null; careRevision: number;
  optimalTempMin: null; optimalTempMax: null; wateringFrequencyDays: null;
  fertilizingFrequencyDays: null; transplantingFrequencyMonths: null;
  wateringRecommendations: null; fertilizingRecommendations: null; transplantingRecommendations: null;
  generalCareRecommendations: string; careRecommendations: string;
};
export type CareContext = PlantSpecies | CustomCareContext;
export const CUSTOM_LIMITATION = "Видових даних немає. Поради базуються на категорії рослини та умовах вирощування.";
export function customCareContext(plant: Pick<Plant, "name" | "category">): CustomCareContext {
  if (!isCategory(plant.category)) throw new Error("Оберіть дійсну категорію рослини");
  const guidance = `${CUSTOM_LIMITATION} Категорія: «${CATEGORY_LABELS[plant.category]}». Перевіряйте фактичний стан рослини й вологість ґрунту перед поливом. Підживлення та обробку виконуйте лише за потреби й відповідно до інструкції засобу. Частота поливу, температурні та вологісні межі невідомі; повну оцінку видових ризиків не виконано.`;
  return {
    id: null, name: plant.name, category: plant.category, applicableCareTypes: null, careRevision: 0,
    optimalTempMin: null, optimalTempMax: null, wateringFrequencyDays: null,
    fertilizingFrequencyDays: null, transplantingFrequencyMonths: null,
    wateringRecommendations: null, fertilizingRecommendations: null, transplantingRecommendations: null,
    generalCareRecommendations: guidance, careRecommendations: guidance,
  };
}
