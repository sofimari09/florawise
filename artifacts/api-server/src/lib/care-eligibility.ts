import { CARE_TYPES, eligibilityError, eligibilityVersion, allowedCareTypes } from "@workspace/plant-care";
import type { PlantSpecies, CareTask, SpeciesCareRule } from "@workspace/db";
import type { CareContext } from "./effective-care";

export class CareEligibilityError extends Error {}
export function assertEligible(species: CareContext, type: unknown) {
  const error = eligibilityError(species, type);
  if (error) throw new CareEligibilityError(error);
}
export function assertTaskUpdate(current: CareTask, merged: CareTask, species: CareContext) {
  const error = eligibilityError(species, merged.type);
  if (!error) return;
  // Full payloads retaining a legacy type are safe only when they do not schedule it again.
  const unchangedCare = current.type === merged.type && current.plantId === merged.plantId && current.scheduledDate === merged.scheduledDate;
  const unchangedStatus = current.status === merged.status;
  const closing = ["COMPLETED", "CANCELLED"].includes(merged.status) && !["COMPLETED", "CANCELLED"].includes(current.status);
  if (unchangedCare && (unchangedStatus || closing)) return;
  throw new CareEligibilityError(error);
}
export function carePlan(species: CareContext, now = new Date(), plantRevision = 0, rules: SpeciesCareRule[] = []) {
  // Category eligibility alone is not evidence for a biological cadence.
  if (species.id === null) return [];
  const firstDate = (days: number) => new Date(now.getTime() + days * 86400000).toISOString().slice(0, 10);
  type CareType = typeof CARE_TYPES[number];
  const candidates: Array<{ type: CareType; days: number | null; reason: string }> = [
    {
      type: "WATERING",
      days: species.wateringFrequencyDays,
      reason: species.wateringFrequencyDays == null
        ? species.wateringRecommendations?.trim() || "Немає підтвердженого фіксованого інтервалу."
        : `Орієнтовний інтервал для виду — ${species.wateringFrequencyDays} днів. ${species.wateringRecommendations ?? ""}`.trim(),
    },
    {
      type: "FERTILIZING",
      days: species.fertilizingFrequencyDays,
      reason: species.fertilizingFrequencyDays == null
        ? species.fertilizingRecommendations?.trim() || "Немає підтвердженого інтервалу."
        : `Інтервал — ${species.fertilizingFrequencyDays} днів. ${species.fertilizingRecommendations ?? ""}`.trim(),
    },
    {
      type: "TRANSPLANTING",
      days: species.transplantingFrequencyMonths == null ? null : species.transplantingFrequencyMonths * 30,
      reason: species.transplantingFrequencyMonths == null
        ? species.transplantingRecommendations?.trim() || "Немає підтвердженого інтервалу."
        : `Орієнтовний інтервал — ${species.transplantingFrequencyMonths} місяців. ${species.transplantingRecommendations ?? ""}`.trim(),
    },
  ];
  const plannedTypes = new Set(candidates.filter(item => item.days != null && item.days > 0).map(item => item.type));
  for (const rule of rules) {
    if (!(CARE_TYPES as readonly string[]).includes(rule.careType)) continue;
    const type = rule.careType as CareType;
    if (plannedTypes.has(type)) continue;
    const min = rule.intervalDaysMin;
    const max = rule.intervalDaysMax;
    const days = max ?? min;
    if (days == null || !Number.isFinite(days) || days <= 0) continue;
    const interval = min != null && max != null && min !== max ? `${min}–${max}` : `${days}`;
    const notes = [
      `Інтервал за джерелом — ${interval} днів.`,
      rule.triggerDescription ? `Умова: ${rule.triggerDescription}` : "",
      rule.recommendedAction ? `Рекомендована дія: ${rule.recommendedAction}` : "",
    ].filter(Boolean).join(" ");
    candidates.push({ type, days, reason: notes });
    plannedTypes.add(type);
  }
  const allowed = allowedCareTypes(species);
  return candidates.filter(item => item.days != null && item.days > 0 && allowed.includes(item.type)).map(item => ({
    type: item.type, scheduledDate: firstDate(item.days!), reason: item.reason, eligibilityVersion: eligibilityVersion(species, plantRevision),
  }));
}
