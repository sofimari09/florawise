export const CARE_TYPES = ["WATERING", "FERTILIZING", "PRUNING", "TRANSPLANTING", "TREATMENT", "HARVEST", "SOWING", "PLANTING"] as const;
export type CareType = typeof CARE_TYPES[number];
export const PLANT_CATEGORIES = ["INDOOR_DECORATIVE", "OUTDOOR_DECORATIVE", "FRUIT_TREE", "BERRY_SHRUB", "VEGETABLE", "HERB"] as const;
export type PlantCategory = typeof PLANT_CATEGORIES[number];
export const CATEGORY_LABELS: Record<PlantCategory, string> = {
  INDOOR_DECORATIVE: "Кімнатна декоративна", OUTDOOR_DECORATIVE: "Садова декоративна",
  FRUIT_TREE: "Плодове дерево", BERRY_SHRUB: "Ягідний кущ",
  VEGETABLE: "Овочева культура", HERB: "Зелень / пряна культура",
};
export const CARE_LABELS: Record<CareType, string> = {
  WATERING: "Полив", FERTILIZING: "Підживлення", PRUNING: "Обрізка", TRANSPLANTING: "Пересадка",
  TREATMENT: "Обробка", HARVEST: "Збір урожаю", SOWING: "Посів", PLANTING: "Висаджування",
};
export const CATEGORY_DEFAULTS: Record<PlantCategory, readonly CareType[]> = {
  INDOOR_DECORATIVE: ["WATERING", "FERTILIZING", "PRUNING", "TRANSPLANTING", "TREATMENT"],
  OUTDOOR_DECORATIVE: ["WATERING", "FERTILIZING", "PRUNING", "TRANSPLANTING", "TREATMENT"],
  FRUIT_TREE: ["WATERING", "FERTILIZING", "PRUNING", "TREATMENT", "HARVEST"],
  BERRY_SHRUB: ["WATERING", "FERTILIZING", "PRUNING", "TREATMENT", "HARVEST"],
  VEGETABLE: ["SOWING", "PLANTING", "WATERING", "FERTILIZING", "TREATMENT", "HARVEST"],
  HERB: ["SOWING", "PLANTING", "WATERING", "FERTILIZING", "HARVEST"],
};
export const isCategory = (value: unknown): value is PlantCategory => typeof value === "string" && PLANT_CATEGORIES.includes(value as PlantCategory);
export const isCareType = (value: unknown): value is CareType => typeof value === "string" && CARE_TYPES.includes(value as CareType);
export type SpeciesApplicability = { category: string | null; applicableCareTypes?: readonly string[] | null };
export function allowedCareTypes(species: SpeciesApplicability): CareType[] {
  if (!isCategory(species.category)) return [];
  const defaults = CATEGORY_DEFAULTS[species.category];
  return defaults.filter(type => species.applicableCareTypes == null || species.applicableCareTypes.includes(type));
}
export function applicabilityError(species: SpeciesApplicability): string | null {
  if (!isCategory(species.category)) return "Оберіть дійсну категорію рослини";
  const refinement = species.applicableCareTypes;
  if (refinement != null && (new Set(refinement).size !== refinement.length || refinement.some(type => !isCareType(type) || !CATEGORY_DEFAULTS[species.category as PlantCategory].includes(type)))) {
    return "Уточнення виду може містити лише унікальні види догляду, дозволені категорією";
  }
  return null;
}
export function eligibilityError(species: SpeciesApplicability, type: unknown): string | null {
  if (!isCareType(type)) return "Невідомий тип догляду. Оберіть тип зі списку";
  if (!allowedCareTypes(species).includes(type)) return `«${CARE_LABELS[type]}» не застосовується до поточного виду та категорії рослини`;
  return null;
}
export function eligibilityBasis(species: SpeciesApplicability): string {
  return `Категорія: «${isCategory(species.category) ? CATEGORY_LABELS[species.category] : "Не класифіковано"}». Застосовність: ${species.applicableCareTypes == null ? "типові дії категорії" : "явне уточнення виду"}.`;
}
/** Stable snapshot, including changes that preserve the same effective allowed set. */
export function eligibilityVersion(species: SpeciesApplicability & { id: number; careRevision?: number }, plantRevision = 0): string {
  return JSON.stringify([species.id, species.category, species.applicableCareTypes == null ? null : [...species.applicableCareTypes].sort(), species.careRevision ?? 0, plantRevision]);
}
