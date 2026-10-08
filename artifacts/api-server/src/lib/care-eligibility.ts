import { eligibilityError, eligibilityVersion, allowedCareTypes } from "@workspace/plant-care";
import type { PlantSpecies, CareTask } from "@workspace/db";
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
export function carePlan(species: CareContext, now = new Date(), plantRevision = 0) {
  // Category eligibility alone is not evidence for a biological cadence.
  if (species.id === null) return [];
  const firstDate = (days: number) => new Date(now.getTime() + days * 86400000).toISOString().slice(0, 10);
  const candidates = [
    { type: "WATERING" as const, days: species.wateringFrequencyDays, reason: `Орієнтовний інтервал для виду — ${species.wateringFrequencyDays} днів. ${species.wateringRecommendations}` },
    { type: "FERTILIZING" as const, days: species.fertilizingFrequencyDays, reason: `Інтервал — ${species.fertilizingFrequencyDays} днів. ${species.fertilizingRecommendations}` },
    { type: "TRANSPLANTING" as const, days: species.transplantingFrequencyMonths == null ? null : species.transplantingFrequencyMonths * 30, reason: `Орієнтовний інтервал — ${species.transplantingFrequencyMonths} місяців. ${species.transplantingRecommendations}` },
  ];
  const allowed = allowedCareTypes(species);
  return candidates.filter(item => item.days != null && item.days > 0 && allowed.includes(item.type)).map(item => ({
    type: item.type, scheduledDate: firstDate(item.days!), reason: item.reason, eligibilityVersion: eligibilityVersion(species, plantRevision),
  }));
}
