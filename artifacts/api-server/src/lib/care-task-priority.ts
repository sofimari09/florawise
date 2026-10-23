export type PriorityWeights = {
  temporal: number;
  sensitivity: number;
  weather: number;
};

export type PriorityFactors = {
  temporal: number;
  sensitivity: number;
  weather: number | null;
};

export type WeatherPrioritySignal = "RESCHEDULE" | "WARNING" | "CLEAR" | null;
export type CareTaskPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

function configuredWeight(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return defaultValue;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a finite non-negative number.`);
  }
  return value;
}

export const CARE_PRIORITY_WEIGHTS: Readonly<PriorityWeights> = Object.freeze({
  temporal: configuredWeight("FLORAWISE_PRIORITY_WEIGHT_D", 0.4),
  sensitivity: configuredWeight("FLORAWISE_PRIORITY_WEIGHT_S", 0.35),
  weather: configuredWeight("FLORAWISE_PRIORITY_WEIGHT_W", 0.25),
});

if (CARE_PRIORITY_WEIGHTS.temporal + CARE_PRIORITY_WEIGHTS.sensitivity + CARE_PRIORITY_WEIGHTS.weather <= 0) {
  throw new Error("At least one FloraWise care-priority weight must be positive.");
}
if (CARE_PRIORITY_WEIGHTS.temporal + CARE_PRIORITY_WEIGHTS.sensitivity <= 0) {
  throw new Error("FloraWise temporal or sensitivity weight must be positive for weather-free fallback.");
}

export const CARE_PRIORITY_HORIZONS = {
  temporalDays: 7,
  sensitivityDays: 30,
} as const;

const clamp = (value: number) => Math.min(1, Math.max(0, value));

export function temporalUrgency(daysUntilDue: number, horizonDays = CARE_PRIORITY_HORIZONS.temporalDays): number {
  if (!Number.isFinite(daysUntilDue) || !Number.isFinite(horizonDays) || horizonDays <= 0) {
    throw new Error("Temporal urgency requires finite dates and a positive horizon.");
  }
  return clamp(1 - daysUntilDue / horizonDays);
}

export function delaySensitivity(intervalDays: number | null, horizonDays = CARE_PRIORITY_HORIZONS.sensitivityDays): number {
  if (!Number.isFinite(horizonDays) || horizonDays <= 0) {
    throw new Error("Sensitivity normalization requires a positive horizon.");
  }
  if (intervalDays === null || !Number.isFinite(intervalDays) || intervalDays <= 0) return 0.5;
  return clamp(1 - intervalDays / horizonDays);
}

export function weatherUrgency(signal: WeatherPrioritySignal): number | null {
  if (signal === null) return null;
  if (signal === "RESCHEDULE") return 1;
  if (signal === "WARNING") return 0.5;
  return 0;
}

export function weatherSignalForPriority(
  environment: string,
  forecastAvailableForTask: boolean,
  signal: WeatherPrioritySignal,
): WeatherPrioritySignal {
  if (environment !== "OUTDOOR" || !forecastAvailableForTask) return null;
  return signal;
}

export function priorityFromScore(score: number): Exclude<CareTaskPriority, "URGENT"> {
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new Error("Weighted priority score must be between 0 and 1.");
  }
  if (score < 0.4) return "LOW";
  if (score < 0.7) return "MEDIUM";
  return "HIGH";
}

export function weightedPriority(
  factors: PriorityFactors,
  weights: PriorityWeights = CARE_PRIORITY_WEIGHTS,
  emergencyOverride = false,
): { score: number; priority: CareTaskPriority } {
  const entries: Array<[keyof PriorityWeights, number | null]> = [
    ["temporal", factors.temporal],
    ["sensitivity", factors.sensitivity],
    ["weather", factors.weather],
  ];
  let availableWeight = 0;
  let weightedTotal = 0;

  for (const [key, value] of entries) {
    const weight = weights[key];
    if (!Number.isFinite(weight) || weight < 0) throw new Error(`Priority weight "${key}" must be finite and non-negative.`);
    if (value === null) continue;
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`Priority factor "${key}" must be between 0 and 1.`);
    availableWeight += weight;
    weightedTotal += weight * value;
  }

  if (availableWeight <= 0) throw new Error("At least one available priority factor must have a positive weight.");
  const score = clamp(weightedTotal / availableWeight);
  return { score, priority: emergencyOverride ? "URGENT" : priorityFromScore(score) };
}
