import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { and, count, desc, eq, gte, lte, inArray, or, isNull, max, ne } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { z } from "zod/v4";
import { createHash } from "node:crypto";
import {
  db,
  careLogsTable,
  plantsTable,
  recommendationsTable,
  remindersTable,
  reportsTable,
  speciesTable,
  tasksTable,
  usersTable,
  plantPlacesTable,
  savedLocationsTable,
  speciesCareRulesTable,
  speciesCareRuleSourcesTable,
  speciesKnowledgeSourcesTable,
  knowledgeSourcesTable,
  notificationsTable,
  type PlantSpecies,
  type CareTask,
} from "@workspace/db";
import { CreateReportResponse, ListReportsResponse } from "@workspace/api-zod";
import { weatherService } from "../lib/weather";
import { logger } from "../lib/logger";
import { createRainTomorrowScenario, DEV_WEATHER_SCENARIO } from "../lib/weather-test-scenario";
import { generateRules, isWeatherSuitable, RULE_PARAMETERS, type RecommendationDraft } from "../lib/recommendation-engine";
import { resolveSavedWeatherLocation, plantEnvironment } from "../lib/weather-location";
import { dateInKyivOffset, todayInKyiv } from "../lib/date";
import {
  CARE_PRIORITY_HORIZONS,
  delaySensitivity,
  temporalUrgency,
  weatherSignalForPriority,
  weatherUrgency,
  weightedPriority,
  type WeatherPrioritySignal,
} from "../lib/care-task-priority";
import { canAttachPhoto } from "../lib/plant-photos";
import { calculateCareReport } from "../lib/care-report";
import { isCurrentRealWeatherNotification, notificationDateLabel, notificationEventHash, taskNotificationDedupeKey, taskNotificationKind } from "../lib/notification-policy";
import { identityInput, normalizeSearch, resolvePlantName, resolveIdentityFields } from "../lib/plant-identity";
import { customCareContext, type CareContext } from "../lib/effective-care";
import { CARE_TYPES, CARE_LABELS, PLANT_CATEGORIES, CATEGORY_LABELS, allowedCareTypes, applicabilityError, eligibilityError, eligibilityVersion, isCategory, isCareType } from "@workspace/plant-care";
import { CareEligibilityError, assertEligible, assertTaskUpdate, carePlan } from "../lib/care-eligibility";

const router: IRouter = Router();
type FloraTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const today = todayInKyiv;
const isWeatherExposed = (environment: string) => environment === "OUTDOOR";
const isWeatherRelevant = (environment: string) => ["BALCONY", "OUTDOOR"].includes(environment);
const MAX_WEATHER_RECOMMENDATION_AGE_MS = 6 * 60 * 60 * 1000;
const recommendationRefreshMessage = "Оновіть рекомендацію за актуальним прогнозом.";
class WeatherUnavailableError extends Error {}
class RecommendationConflictError extends Error {}

function requestedDevScenario(value: unknown, res: Response): boolean | null {
  if (value === undefined) return false;
  if (process.env.NODE_ENV !== "development" || value !== DEV_WEATHER_SCENARIO) {
    res.status(400).json({ error: "Тестовий прогноз доступний лише в режимі розробки" });
    return null;
  }
  return true;
}
const careLabels: Record<string, string> = { ...CARE_LABELS, OTHER: "Інший догляд" };
const idFrom = (req: Request) => Number(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
const stringParam = (value: unknown) => typeof value === "string" ? value : undefined;
const dates = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(date => !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date);
const taskInput = z.object({
  plantId: z.coerce.number().int().positive(),
  type: z.enum(CARE_TYPES),
  scheduledDate: dates,
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]),
  notes: z.string(),
});
const environmentTypes = ["INDOOR", "BALCONY", "OUTDOOR", "GREENHOUSE"] as const;
const profileWeatherLocationInput = z.object({
  weatherLocationName: z.string().trim().min(1),
  weatherLatitude: z.number().min(-90).max(90).nullable(),
  weatherLongitude: z.number().min(-180).max(180).nullable(),
}).refine((value) => (value.weatherLatitude === null) === (value.weatherLongitude === null), {
  message: "Широта й довгота мають бути заповнені разом",
});
const plantInput = z.object({
  ...identityInput,
  location: z.string().trim().min(1, "Локація обов'язкова"),
  photoUrl: z.string().url().refine(value => /^https?:\/\//.test(value), "Фото має бути HTTP(S) URL").or(z.literal("")),
  photoObjectPath: z.string().regex(/^\/objects\/photos\/[0-9a-f-]{36}$/).nullable().optional(),
  placeId: z.number().int().positive().optional(),
  weatherLocationId: z.number().int().positive().nullable().optional(),
  environmentType: z.enum(environmentTypes).optional(),
  weatherLocationName: z.string().trim().min(1).nullable().optional(),
  weatherLatitude: z.number().min(-90).max(90).nullable().optional(),
  weatherLongitude: z.number().min(-180).max(180).nullable().optional(),
});
const hasValidWeatherOverride = (value: {
  weatherLocationName?: string | null;
  weatherLatitude?: number | null;
  weatherLongitude?: number | null;
}) => {
  const fields = [value.weatherLocationName, value.weatherLatitude, value.weatherLongitude];
  if (fields.every((field) => field === undefined)) return true;
  if (fields.every((field) => field === null)) return true;
  return typeof value.weatherLocationName === "string" &&
    value.weatherLocationName.length > 0 &&
    typeof value.weatherLatitude === "number" &&
    typeof value.weatherLongitude === "number";
};
const dbCoordinate = (value: number | null | undefined) =>
  value === undefined ? undefined : value === null ? null : String(value);
const optionalNumber = z.preprocess(value => value === "" || value === undefined ? null : value, z.coerce.number().nullable());
const speciesInput = z.object({
  name: z.string().trim().min(1),
  description: z.string(),
  careRecommendations: z.string(),
  optimalTempMin: optionalNumber,
  optimalTempMax: optionalNumber,
  optimalHumidity: z.preprocess(value => value === "" || value === undefined || value === null ? null : value, z.coerce.number().min(0).max(100).nullable()),
  wateringFrequencyDays: z.preprocess(value => value === "" || value === undefined || value === null ? null : value, z.coerce.number().int().positive().nullable()),
  lightRequirements: z.string(),
  soilRecommendations: z.string(),
  wateringRecommendations: z.string(),
  fertilizingRecommendations: z.string(),
  pruningRecommendations: z.string(),
  transplantingRecommendations: z.string(),
  imageUrl: z.preprocess(value => value === "" || value === undefined ? null : value, z.string().url().nullable()),
  scientificName: z.string().trim().nullable().optional(),
  category: z.enum(PLANT_CATEGORIES),
  applicableCareTypes: z.array(z.enum(CARE_TYPES)).nullable().optional(),
  suitableEnvironmentTypes: z.array(z.enum(environmentTypes)).nullable().optional(),
  lifeCycle: z.string().nullable().optional(),
  wateringCheckIntervalDays: z.number().int().positive().nullable().optional(),
  targetWaterMmWeekMin: z.number().min(0).nullable().optional(),
  targetWaterMmWeekMax: z.number().min(0).nullable().optional(),
  sowingPlantingRecommendations: z.string().nullable().optional(),
  humidityMin: z.number().int().min(0).max(100).nullable().optional(),
  humidityMax: z.number().int().min(0).max(100).nullable().optional(),
  fertilizingFrequencyDays: z.number().int().positive().nullable().optional(),
  pruningSeason: z.string().nullable().optional(),
  transplantingFrequencyMonths: z.number().int().positive().nullable().optional(),
  harvestingRecommendations: z.string().nullable().optional(),
  generalCareRecommendations: z.string().nullable().optional(),
}).refine(data => data.targetWaterMmWeekMin == null || data.targetWaterMmWeekMax == null || data.targetWaterMmWeekMin <= data.targetWaterMmWeekMax);

export async function currentUser(req: Request) {
  const auth = getAuth(req);
  const clerkUserId = auth.userId ?? (process.env.NODE_ENV === "development" ? "preview-demo-user" : null);
  if (!clerkUserId) return null;
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.clerkUserId, clerkUserId)).limit(1);
  if (existing) {
    if (clerkUserId === "preview-demo-user" && existing.username !== "Демо-користувач") {
      const [updated] = await db.update(usersTable).set({ username: "Демо-користувач", email: "demo@florawise.app" }).where(eq(usersTable.id, existing.id)).returning();
      return updated;
    }
    return existing;
  }
  if (clerkUserId === "preview-demo-user") {
    const [created] = await db.insert(usersTable).values({ clerkUserId, username: "Демо-користувач", email: "demo@florawise.app", role: "USER" }).onConflictDoNothing({ target: usersTable.clerkUserId }).returning();
    if (created) return created;
    const [concurrent] = await db.select().from(usersTable).where(eq(usersTable.clerkUserId, clerkUserId)).limit(1);
    return concurrent;
  }
  const [created] = await db.insert(usersTable).values({ clerkUserId, username: "Користувач", email: `${clerkUserId}@florawise.app`, role: "USER" }).onConflictDoNothing({ target: usersTable.clerkUserId }).returning();
  if (created) return created;
  const [concurrent] = await db.select().from(usersTable).where(eq(usersTable.clerkUserId, clerkUserId)).limit(1);
  return concurrent;
}

async function getPlantForUser(req: Request, plantId: number) {
  const user = await currentUser(req);
  if (!user) return { user: null, plant: null };
  const [plant] = await db.select().from(plantsTable).where(and(eq(plantsTable.id, plantId), eq(plantsTable.userId, user.id))).limit(1);
  return { user, plant };
}

async function mapSpecies(species: PlantSpecies) {
  return {
    ...species,
    allowedCareTypes: allowedCareTypes(species),
    categoryLabel: isCategory(species.category) ? CATEGORY_LABELS[species.category] : "Потрібна класифікація",
    optimalTempMin: species.optimalTempMin === null ? null : Number(species.optimalTempMin),
    optimalTempMax: species.optimalTempMax === null ? null : Number(species.optimalTempMax),
    targetWaterMmWeekMin: species.targetWaterMmWeekMin === null ? null : Number(species.targetWaterMmWeekMin),
    targetWaterMmWeekMax: species.targetWaterMmWeekMax === null ? null : Number(species.targetWaterMmWeekMax),
  };
}

async function mapPlant(plant: typeof plantsTable.$inferSelect) {
  const species = await linkedSpecies(plant);
  const context = species ?? customCareContext(plant);
  const tasks = await db.select().from(tasksTable).where(and(eq(tasksTable.plantId, plant.id), inArray(tasksTable.status, ["PLANNED", "POSTPONED"]))).orderBy(tasksTable.scheduledDate);
  const mappedTasks = await mapTasks(tasks, [plant]);
  const [place] = plant.placeId ? await db.select().from(plantPlacesTable).where(and(eq(plantPlacesTable.id, plant.placeId), eq(plantPlacesTable.userId, plant.userId))) : [];
  const [location] = plant.weatherLocationId ? await db.select().from(savedLocationsTable).where(and(eq(savedLocationsTable.id, plant.weatherLocationId), eq(savedLocationsTable.userId, plant.userId))) : [];
  const next = tasks[0];
  return {
    ...plant,
    name: species ? resolvePlantName({}, species.name, plant).name : plant.name,
    identityKind: plant.speciesId === null ? "CUSTOM" : "LINKED",
    photoUrl: plant.photoObjectPath ? `/api/storage${plant.photoObjectPath}` : plant.photoUrl,
    location: place?.name ?? plant.location,
    environmentType: place?.environmentType ?? plant.environmentType,
    weatherLocationName: location?.displayName ?? plant.weatherLocationName,
    weatherLatitude: location ? Number(location.latitude) : plant.weatherLatitude === null ? null : Number(plant.weatherLatitude),
    weatherLongitude: location ? Number(location.longitude) : plant.weatherLongitude === null ? null : Number(plant.weatherLongitude),
    speciesName: species?.name ?? null,
    category: context.category,
    categoryLabel: isCategory(context.category) ? CATEGORY_LABELS[context.category] : "Потрібна класифікація",
    allowedCareTypes: allowedCareTypes(context),
    nextTask: next?.scheduledDate ?? null,
    nextTaskType: next?.type ?? null,
    careStatus: next?.scheduledDate && next.scheduledDate < today() ? "OVERDUE" : next ? "PLANNED" : "NO_PLAN",
    hasHighPriorityTasks: mappedTasks.some(task => ["HIGH", "URGENT"].includes(task.priority)),
  };
}

function mapUser(user: typeof usersTable.$inferSelect) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    weatherLocationName: user.weatherLocationName,
    weatherLatitude: user.weatherLatitude === null ? null : Number(user.weatherLatitude),
    weatherLongitude: user.weatherLongitude === null ? null : Number(user.weatherLongitude),
  };
}

type TaskPriorityContext = {
  species: CareContext;
  rules: (typeof speciesCareRulesTable.$inferSelect)[];
  environment: string;
  forecast: Awaited<ReturnType<typeof weatherService.getForecast>> | null;
  locationName: string;
  lastCompletedByType: Record<string, string>;
};

const isActiveCareTask = (task: CareTask) => ["PLANNED", "POSTPONED"].includes(task.status);

function daysUntilTask(task: CareTask): number {
  const due = Date.parse(`${task.scheduledDate}T00:00:00.000Z`);
  const current = Date.parse(`${today()}T00:00:00.000Z`);
  return Math.round((due - current) / 86_400_000);
}

function intervalDaysForSensitivity(
  type: string,
  species: CareContext,
  rules: TaskPriorityContext["rules"],
): number | null {
  // The catalog has no direct delay-sensitivity measure. A verified care cadence
  // is only a transparent model proxy; missing or condition-triggered cadence is neutral.
  const rule = rules.find((item) => item.careType === type);
  const ruleInterval = rule?.intervalDaysMax ?? rule?.intervalDaysMin ?? null;
  if (rule?.triggerDescription?.trim()) return null;
  if (ruleInterval !== null && Number.isFinite(ruleInterval) && ruleInterval > 0) return ruleInterval;
  if (species.id === null) return null;
  if (type === "WATERING") return species.wateringFrequencyDays;
  if (type === "FERTILIZING") return species.fertilizingFrequencyDays;
  if (type === "TRANSPLANTING" && species.transplantingFrequencyMonths !== null) {
    return species.transplantingFrequencyMonths * 30;
  }
  // wateringCheckIntervalDays is intentionally excluded: it is a soil-check interval,
  // not evidence of a fixed watering cadence or delay sensitivity.
  return null;
}

async function loadTaskPriorityContext(plant: typeof plantsTable.$inferSelect): Promise<TaskPriorityContext> {
  const [species, users, environment, completedCare] = await Promise.all([
    effectiveCare(plant),
    db.select().from(usersTable).where(eq(usersTable.id, plant.userId)).limit(1),
    plantEnvironment(plant),
    db.select({ type: tasksTable.type, completedAt: max(careLogsTable.completedAt) })
      .from(careLogsTable)
      .innerJoin(tasksTable, eq(careLogsTable.taskId, tasksTable.id))
      .where(and(eq(tasksTable.plantId, plant.id), eq(tasksTable.status, "COMPLETED")))
      .groupBy(tasksTable.type),
  ]);
  const rules = species.id === null
    ? []
    : await db.select().from(speciesCareRulesTable).where(eq(speciesCareRulesTable.speciesId, species.id));
  const lastCompletedByType: Record<string, string> = {};
  for (const action of completedCare) {
    if (action.completedAt) lastCompletedByType[action.type] = todayInKyiv(action.completedAt);
  }

  let forecast: TaskPriorityContext["forecast"] = null;
  let locationName = plant.weatherLocationName ?? "Ваш регіон";
  if (isWeatherExposed(environment) && users[0]) {
    try {
      const location = await resolveSavedWeatherLocation(users[0], plant);
      locationName = location.name;
      const result = await weatherService.getForecast(location);
      // Demonstration data is not evidence for a live task priority.
      if (!result.isMock) forecast = result;
    } catch (error) {
      logger.warn({ error, plantId: plant.id, locationName }, "Погоду для пріоритету догляду не отримано; використаємо фактори D/S");
    }
  }

  return { species, rules, environment, forecast, locationName, lastCompletedByType };
}

function calculateTaskPriority(task: CareTask, context: TaskPriorityContext): CareTask["priority"] {
  const daysUntilDue = daysUntilTask(task);
  const overdueDays = Math.max(0, -daysUntilDue);
  const temporal = temporalUrgency(daysUntilDue, CARE_PRIORITY_HORIZONS.temporalDays);
  const sensitivity = delaySensitivity(
    intervalDaysForSensitivity(task.type, context.species, context.rules),
    CARE_PRIORITY_HORIZONS.sensitivityDays,
  );

  let weatherSignal: WeatherPrioritySignal = null;
  let forecastAvailableForTask = false;
  let engineEmergencyOverride = false;
  if (isWeatherExposed(context.environment) && context.forecast) {
    const forecastDate = task.scheduledDate < today() ? today() : task.scheduledDate;
    if (context.forecast.forecast.some((day) => day.date === forecastDate)) {
      forecastAvailableForTask = true;
      const drafts = generateRules(
        context.species,
        [task],
        context.forecast.forecast,
        context.locationName,
        context.environment,
        context.lastCompletedByType.WATERING ?? null,
        context.rules,
        context.lastCompletedByType,
      ).filter((draft) => draft.relatedTaskId === task.id);
      if (drafts.some((draft) => draft.type === "WEATHER_RESCHEDULE")) weatherSignal = "RESCHEDULE";
      else if (drafts.some((draft) => draft.type === "WEATHER_WARNING")) weatherSignal = "WARNING";
      else weatherSignal = "CLEAR";
      engineEmergencyOverride = drafts.some((draft) => draft.priority === "URGENT");
    }
  }

  const emergencyOverride =
    task.priority === "URGENT" ||
    overdueDays >= RULE_PARAMETERS.overdueUrgentDays ||
    engineEmergencyOverride;
  return weightedPriority(
    {
      temporal,
      sensitivity,
      weather: weatherUrgency(weatherSignalForPriority(context.environment, forecastAvailableForTask, weatherSignal)),
    },
    undefined,
    emergencyOverride,
  ).priority;
}

async function mapTaskWithContext(
  task: CareTask,
  plant: typeof plantsTable.$inferSelect | undefined,
  context?: TaskPriorityContext,
) {
  let priority = task.priority;
  if (isActiveCareTask(task)) {
    const overdueDays = Math.max(0, -daysUntilTask(task));
    if (task.priority === "URGENT" || overdueDays >= RULE_PARAMETERS.overdueUrgentDays) {
      priority = "URGENT";
    } else if (plant) {
      priority = calculateTaskPriority(task, context ?? await loadTaskPriorityContext(plant));
    }
  }
  return {
    ...task,
    priority,
    plantName: plant?.name ?? "Рослина",
    isOverdue: ["PLANNED", "POSTPONED"].includes(task.status) && task.scheduledDate < today(),
  };
}

async function mapTask(task: CareTask, knownPlant?: typeof plantsTable.$inferSelect) {
  const [plant] = knownPlant
    ? [knownPlant]
    : await db.select().from(plantsTable).where(eq(plantsTable.id, task.plantId));
  return mapTaskWithContext(task, plant);
}

async function mapTasks(
  tasks: CareTask[],
  knownPlants: (typeof plantsTable.$inferSelect)[] = [],
) {
  const plantsById = new Map(knownPlants.map((plant) => [plant.id, plant]));
  const missingPlantIds = [...new Set(tasks.map((task) => task.plantId))]
    .filter((plantId) => !plantsById.has(plantId));
  if (missingPlantIds.length) {
    const fetchedPlants = await db.select().from(plantsTable).where(inArray(plantsTable.id, missingPlantIds));
    for (const plant of fetchedPlants) plantsById.set(plant.id, plant);
  }

  const contexts = new Map<number, Promise<TaskPriorityContext>>();
  return Promise.all(tasks.map(async (task) => {
    const plant = plantsById.get(task.plantId);
    const active = isActiveCareTask(task);
    const daysOverdue = Math.max(0, -daysUntilTask(task));
    const needsContext = active && plant && task.priority !== "URGENT" && daysOverdue < RULE_PARAMETERS.overdueUrgentDays;
    if (needsContext && plant && !contexts.has(plant.id)) {
      contexts.set(plant.id, loadTaskPriorityContext(plant));
    }
    const context = needsContext && plant ? await contexts.get(plant.id) : undefined;
    return mapTaskWithContext(task, plant, context);
  }));
}

const devScenarioKey = "__floraWiseDevWeatherScenario";
const devScenarioStartKey = "__floraWiseDevWeatherScenarioStart";
function parseStoredRecommendationWeather(weatherJson: string) {
  const parsed = JSON.parse(weatherJson || "{}") as Record<string, unknown>;
  const { [devScenarioKey]: scenario, [devScenarioStartKey]: scenarioStart, ...weather } = parsed;
  return {
    weather,
    scenario: typeof scenario === "string" ? scenario : null,
    scenarioStart: typeof scenarioStart === "string" ? scenarioStart : null,
  };
}

async function mapRecommendation(rec: typeof recommendationsTable.$inferSelect) {
  const [plant] = await db.select().from(plantsTable).where(eq(plantsTable.id, rec.plantId));
  const species = plant ? await effectiveCare(plant) : null;
  const [task] = rec.relatedTaskId ? await db.select().from(tasksTable).where(eq(tasksTable.id, rec.relatedTaskId)) : [];
  const environment = plant ? await plantEnvironment(plant) : null;
  const isWeatherRecommendation = ["WEATHER_RESCHEDULE", "WEATHER_WARNING"].includes(rec.type);
  const isWeatherReschedule = rec.type === "WEATHER_RESCHEDULE";
  const activeTask = !!task && task.plantId === rec.plantId && ["PLANNED", "POSTPONED"].includes(task.status);
  const eligibleTask = !!species && !!task && task.plantId === rec.plantId &&
    (rec.careType === null || task.type === rec.careType) && eligibilityError(species, task.type) === null;
  let staleReason: string | null = null;
  if (rec.applied) staleReason = null;
  else if (rec.supersededAt) staleReason = "Цю рекомендацію оновлено. Перегляньте актуальну пораду.";
  else if (!plant || !species) staleReason = "Рослину або її вид більше не знайдено.";
  else if (rec.relatedTaskId !== null && !task) staleReason = "Пов’язане завдання більше не існує.";
  else if (task && task.plantId !== rec.plantId) staleReason = "Пов’язане завдання належить іншій рослині.";
  else if (task?.status === "COMPLETED") staleReason = "Завдання вже виконано; цю пораду не можна застосувати.";
  else if (task?.status === "CANCELLED") staleReason = "Завдання скасовано; цю пораду не можна застосувати.";
  else if (task && rec.careType !== null && task.type !== rec.careType) staleReason = "Тип догляду в завданні змінився; ця порада більше не застосовна.";
  else if (task && eligibilityError(species!, task.type)) staleReason = "Застосовність цього виду догляду змінилася.";
  else if (isWeatherRecommendation && environment && !isWeatherRelevant(environment)) staleReason = "Зовнішній прогноз не застосовується до догляду в приміщенні чи теплиці.";
  else if (isWeatherReschedule && environment === "BALCONY") staleReason = "Експозиція балкона невідома; погодна рекомендація не може автоматично змінювати дату.";
  else if (isWeatherRecommendation && task && rec.originalDate !== task.scheduledDate) {
    staleReason = `Завдання вже перенесено з ${rec.originalDate ?? "невідомої дати"} на ${task.scheduledDate}. ${recommendationRefreshMessage}`;
  } else if (isWeatherRecommendation && rec.suggestedDate && rec.suggestedDate < today()) {
    staleReason = `Запропонована дата ${rec.suggestedDate} уже минула. ${recommendationRefreshMessage}`;
  } else if (isWeatherRecommendation && rec.generatedAt.getTime() < Date.now() - MAX_WEATHER_RECOMMENDATION_AGE_MS) {
    staleReason = `Погодні дані застаріли. ${recommendationRefreshMessage}`;
  } else if (isWeatherRecommendation && (rec.eligibilityVersion === null || rec.careType === null)) {
    staleReason = `Це стара порада без повного знімка плану догляду. ${recommendationRefreshMessage}`;
  } else if (plant && species && rec.eligibilityVersion !== await careSnapshot(plant, species)) {
    staleReason = `Умови вирощування або план догляду змінилися. ${recommendationRefreshMessage}`;
  }
  const actionable = isWeatherReschedule && environment === "OUTDOOR" && !staleReason && !rec.applied && activeTask &&
    task?.scheduledDate === rec.originalDate && !!rec.suggestedDate && rec.suggestedDate >= today() &&
    rec.suggestedDate !== rec.originalDate;
  const refreshable = isWeatherRecommendation && !rec.applied && !rec.supersededAt &&
    activeTask && eligibleTask && !!environment && isWeatherRelevant(environment) && !!staleReason;
  const storedWeather = parseStoredRecommendationWeather(rec.weatherJson);
  return {
    ...rec,
    plantName: plant?.name ?? "Рослина",
    applied: Boolean(rec.applied),
    appliedAt: rec.appliedAt?.toISOString() ?? null,
    actionable,
    refreshable,
    staleReason,
    supersededAt: rec.supersededAt?.toISOString() ?? null,
    weather: storedWeather.weather,
  };
}

type NotificationWrite = typeof notificationsTable.$inferInsert;
async function writeNotification(source: typeof db | FloraTransaction, notification: NotificationWrite): Promise<void> {
  await source.insert(notificationsTable).values(notification).onConflictDoUpdate({
    target: [notificationsTable.userId, notificationsTable.dedupeKey],
    set: { staleAt: null },
  });
}

function weatherNotificationWrite(
  userId: number,
  recommendation: typeof recommendationsTable.$inferSelect,
): NotificationWrite | null {
  let storedWeather: ReturnType<typeof parseStoredRecommendationWeather>;
  try {
    storedWeather = parseStoredRecommendationWeather(recommendation.weatherJson);
  } catch {
    return null;
  }
  if (!isCurrentRealWeatherNotification({
    recommendationType: recommendation.type,
    relatedTaskId: recommendation.relatedTaskId,
    applied: Boolean(recommendation.applied),
    superseded: recommendation.supersededAt !== null,
    generatedAtMs: recommendation.generatedAt.getTime(),
    nowMs: Date.now(),
    weatherIsMock: storedWeather.weather.isMock,
    hasDevelopmentScenario: Boolean(storedWeather.scenario),
    maxAgeMs: MAX_WEATHER_RECOMMENDATION_AGE_MS,
  })) return null;
  const signature = [
    recommendation.type,
    recommendation.relatedTaskId,
    recommendation.originalDate ?? "",
    recommendation.suggestedDate ?? "",
    recommendation.text,
  ].join("|");
  const isReschedule = recommendation.type === "WEATHER_RESCHEDULE";
  return {
    userId,
    type: recommendation.type,
    title: isReschedule ? "Погодна рекомендація щодо дати" : "Попередження про погоду",
    message: recommendation.text,
    dedupeKey: `weather:${recommendation.id}:${notificationEventHash(signature)}`,
    href: `/recommendations?recommendationId=${recommendation.id}`,
    plantId: recommendation.plantId,
    taskId: recommendation.relatedTaskId,
    reminderId: null,
    recommendationId: recommendation.id,
  };
}

async function syncUserNotifications(userId: number) {
  const plants = await db.select().from(plantsTable).where(eq(plantsTable.userId, userId));
  const plantById = new Map(plants.map(plant => [plant.id, plant]));
  const plantIds = [...plantById.keys()];
  const tasks = plantIds.length
    ? await db.select().from(tasksTable).where(inArray(tasksTable.plantId, plantIds))
    : [];
  const taskById = new Map(tasks.map(task => [task.id, task]));
  const reminders = tasks.length
    ? await db.select().from(remindersTable).where(inArray(remindersTable.taskId, tasks.map(task => task.id)))
    : [];
  const reminderByTask = new Map<number, (typeof reminders)[number]>();
  for (const reminder of reminders) {
    if (reminder.status === "PENDING" && !reminderByTask.has(reminder.taskId)) reminderByTask.set(reminder.taskId, reminder);
  }

  const todayDate = today();
  const tomorrowDate = dateInKyivOffset(1, todayDate);
  const activeKeys = new Set<string>();
  const taskWrites: NotificationWrite[] = [];
  for (const task of tasks) {
    const reminder = reminderByTask.get(task.id);
    const kind = taskNotificationKind({
      status: task.status,
      scheduledDate: task.scheduledDate,
      reminderDate: reminder?.reminderDate,
      today: todayDate,
      tomorrow: tomorrowDate,
    });
    if (!kind) continue;
    const key = taskNotificationDedupeKey(kind, task.id, task.scheduledDate);
    activeKeys.add(key);
    const plant = plantById.get(task.plantId);
    if (!plant) continue;
    const careName = careLabels[task.type] ?? "догляд";
    const message = kind === "OVERDUE_TASK"
      ? `${careName} рослини «${plant.name}» прострочено. Перевірте стан рослини та заплануйте догляд.`
      : task.scheduledDate === todayDate
        ? `Сьогодні потрібно виконати ${careName.toLocaleLowerCase("uk")} рослини «${plant.name}».`
        : `Завтра заплановано ${careName.toLocaleLowerCase("uk")} рослини «${plant.name}».`;
    taskWrites.push({
      userId,
      type: kind,
      title: kind === "OVERDUE_TASK" ? "Прострочене завдання" : "Найближчий догляд",
      message,
      dedupeKey: key,
      href: `/calendar?taskId=${task.id}`,
      plantId: plant.id,
      taskId: task.id,
      reminderId: reminder?.id ?? null,
      recommendationId: null,
    });
  }

  const recommendations = plantIds.length
    ? await db.select().from(recommendationsTable)
      .where(and(inArray(recommendationsTable.plantId, plantIds), inArray(recommendationsTable.type, ["WEATHER_RESCHEDULE", "WEATHER_WARNING"])))
      .orderBy(desc(recommendationsTable.generatedAt)).limit(300)
    : [];
  const weatherWrites: NotificationWrite[] = [];
  for (const recommendation of recommendations) {
    const notification = weatherNotificationWrite(userId, recommendation);
    if (!notification) continue;
    const mapped = await mapRecommendation(recommendation);
    const task = recommendation.relatedTaskId === null ? null : taskById.get(recommendation.relatedTaskId);
    const actionable = recommendation.type === "WEATHER_RESCHEDULE"
      ? mapped.actionable
      : !mapped.staleReason && !!task && ["PLANNED", "POSTPONED"].includes(task.status);
    if (!actionable) continue;
    activeKeys.add(notification.dedupeKey);
    weatherWrites.push(notification);
  }

  await db.transaction(async tx => {
    for (const notification of [...taskWrites, ...weatherWrites]) await writeNotification(tx, notification);
    const existingEvents = await tx.select().from(notificationsTable)
      .where(and(
        eq(notificationsTable.userId, userId),
        inArray(notificationsTable.type, ["UPCOMING_TASK", "OVERDUE_TASK", "WEATHER_WARNING", "WEATHER_RESCHEDULE"]),
        isNull(notificationsTable.staleAt),
      ));
    for (const existing of existingEvents) {
      if (!activeKeys.has(existing.dedupeKey)) {
        await tx.update(notificationsTable).set({ staleAt: new Date() })
          .where(and(eq(notificationsTable.id, existing.id), eq(notificationsTable.userId, userId), isNull(notificationsTable.staleAt)));
      }
    }
  });

  const rows = await db.select().from(notificationsTable)
    .where(eq(notificationsTable.userId, userId))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(50);
  const [{ value: unreadCount }] = await db.select({ value: count() }).from(notificationsTable)
    .where(and(eq(notificationsTable.userId, userId), isNull(notificationsTable.readAt), isNull(notificationsTable.staleAt)));
  return {
    notifications: rows.map(notification => ({
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      createdAt: notification.createdAt.toISOString(),
      readAt: notification.readAt?.toISOString() ?? null,
      staleAt: notification.staleAt?.toISOString() ?? null,
      isRead: notification.readAt !== null || notification.staleAt !== null,
      href: notification.staleAt ? null : notification.href,
      plantId: notification.plantId,
      plantName: notification.plantId === null ? null : plantById.get(notification.plantId)?.name ?? null,
      taskId: notification.taskId,
      reminderId: notification.reminderId,
      recommendationId: notification.recommendationId,
      actionLabel: notification.staleAt ? null : ["WEATHER_WARNING", "WEATHER_RESCHEDULE"].includes(notification.type) ? "Переглянути рекомендацію" : "Відкрити календар",
    })),
    unreadCount,
  };
}

router.get("/me", async (req, res): Promise<void> => {
  const user = await currentUser(req);
  if (!user) {
    res.status(401).json({ error: "Необхідно увійти" });
    return;
  }
  res.json(mapUser(user));
});

router.patch("/me", async (req, res): Promise<void> => {
  const user = await currentUser(req);
  const parsed = profileWeatherLocationInput.safeParse(req.body);
  if (!user) { res.status(401).json({ error: "Необхідно увійти" }); return; }
  if (!parsed.success) { res.status(400).json({ error: "Перевірте назву та координати погодної локації" }); return; }
  const [updated] = await db.update(usersTable).set({
    weatherLocationName: parsed.data.weatherLocationName,
    weatherLatitude: dbCoordinate(parsed.data.weatherLatitude),
    weatherLongitude: dbCoordinate(parsed.data.weatherLongitude),
  }).where(eq(usersTable.id, user.id)).returning();
  await db.transaction(async tx => {
    await tx.select().from(usersTable).where(eq(usersTable.id, user.id)).for("update");
    await tx.update(savedLocationsTable).set({ isDefault: false }).where(eq(savedLocationsTable.userId, user.id));
    if (parsed.data.weatherLatitude !== null && parsed.data.weatherLongitude !== null) {
      await tx.insert(savedLocationsTable).values({ userId: user.id, displayName: parsed.data.weatherLocationName, latitude: String(parsed.data.weatherLatitude), longitude: String(parsed.data.weatherLongitude), isDefault: true }).onConflictDoUpdate({ target: [savedLocationsTable.userId, savedLocationsTable.latitude, savedLocationsTable.longitude], set: { displayName: parsed.data.weatherLocationName, isDefault: true, lastUsedAt: new Date() } });
    }
  });
  res.json(mapUser(updated));
});

router.get("/species", async (req, res): Promise<void> => {
  const search = normalizeSearch(stringParam(req.query.search) ?? "");
  const rows = await db.select().from(speciesTable).orderBy(speciesTable.name);
  const result = await Promise.all(rows.filter((item) => !search || normalizeSearch(item.name).includes(search)).map(mapSpecies));
  res.json(result.filter(item => !req.query.category || item.category === req.query.category));
});

router.post("/species", async (req, res): Promise<void> => {
  const parsed = speciesInput.extend({ knowledge: knowledgeInput.optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Перевірте параметри виду рослини" }); return; }
  const user = await currentUser(req);
  if (!user || user.role !== "ADMIN") { res.status(403).json({ error: "Недостатньо прав" }); return; }
  if (parsed.data.optimalTempMin != null && parsed.data.optimalTempMax != null && parsed.data.optimalTempMin > parsed.data.optimalTempMax || parsed.data.humidityMin != null && parsed.data.humidityMax != null && parsed.data.humidityMin > parsed.data.humidityMax) { res.status(400).json({ error: "Мінімальне значення не може перевищувати максимальне" }); return; }
  const error = applicabilityError(parsed.data);
  if (error) { res.status(400).json({ error }); return; }
  const { knowledge, ...data } = parsed.data;
  const created = await db.transaction(async tx => {
    if (knowledge) for (const rule of knowledge.careRules) {
      const error = eligibilityError(data, rule.careType);
      if (error) throw new CareEligibilityError(error);
    }
    const [created] = await tx.insert(speciesTable).values({
      ...data,
      optimalTempMin: dbCoordinate(data.optimalTempMin),
      optimalTempMax: dbCoordinate(data.optimalTempMax),
      optimalHumidity: data.optimalHumidity,
      wateringFrequencyDays: data.wateringFrequencyDays,
      targetWaterMmWeekMin: dbCoordinate(data.targetWaterMmWeekMin),
      targetWaterMmWeekMax: dbCoordinate(data.targetWaterMmWeekMax),
    }).returning();
    if (knowledge) await writeSpeciesKnowledge(tx, created.id, knowledge);
    return created;
  });
  res.status(201).json(await mapSpecies(created));
});

router.patch("/species/:id", async (req, res): Promise<void> => {
  const user = await currentUser(req);
  if (!user || user.role !== "ADMIN") { res.status(403).json({ error: "Недостатньо прав" }); return; }
  const parsed = speciesInput.partial().extend({ knowledge: knowledgeInput.optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Некоректні дані виду" }); return; }
  const [existing] = await db.select().from(speciesTable).where(eq(speciesTable.id, idFrom(req)));
  if (!existing) { res.status(404).json({ error: "Вид не знайдено" }); return; }
  const merged = { ...existing, ...parsed.data };
  if (merged.optimalTempMin != null && merged.optimalTempMax != null && Number(merged.optimalTempMin) > Number(merged.optimalTempMax) || merged.humidityMin != null && merged.humidityMax != null && merged.humidityMin > merged.humidityMax) { res.status(400).json({ error: "Мінімальне значення не може перевищувати максимальне" }); return; }
  const { knowledge, ...data } = parsed.data;
  const values = {
    ...data,
    ...(parsed.data.optimalTempMin === undefined ? {} : { optimalTempMin: dbCoordinate(parsed.data.optimalTempMin) }),
    ...(parsed.data.optimalTempMax === undefined ? {} : { optimalTempMax: dbCoordinate(parsed.data.optimalTempMax) }),
    ...(parsed.data.targetWaterMmWeekMin === undefined ? {} : { targetWaterMmWeekMin: dbCoordinate(parsed.data.targetWaterMmWeekMin) }),
    ...(parsed.data.targetWaterMmWeekMax === undefined ? {} : { targetWaterMmWeekMax: dbCoordinate(parsed.data.targetWaterMmWeekMax) }),
  } as Partial<typeof speciesTable.$inferInsert>;
  const updated = await db.transaction(async tx => {
    const [current] = await tx.select().from(speciesTable).where(eq(speciesTable.id, idFrom(req))).for("update");
    if (!current) throw new CareEligibilityError("Вид більше не існує. Оновіть довідник");
    const merged = { ...current, ...parsed.data };
    if (Number(merged.optimalTempMin) > Number(merged.optimalTempMax) || (merged.humidityMin != null && merged.humidityMax != null && merged.humidityMin > merged.humidityMax)) {
      throw new CareEligibilityError("Мінімальне значення не може перевищувати максимальне");
    }
    const error = applicabilityError({ ...current, ...parsed.data });
    if (error) throw new CareEligibilityError(error);
    const rules = knowledge?.careRules ?? await tx.select().from(speciesCareRulesTable).where(eq(speciesCareRulesTable.speciesId, current.id));
    if (rules.some(rule => eligibilityError({ ...current, ...parsed.data }, rule.careType))) throw new CareEligibilityError("Спершу приберіть погодні правила для виключених видів догляду");
    const [species] = await tx.update(speciesTable).set({ ...values, careRevision: current.careRevision + 1 }).where(eq(speciesTable.id, idFrom(req))).returning();
    if (knowledge) await writeSpeciesKnowledge(tx, species.id, knowledge);
    if (species && parsed.data.name !== undefined) {
      await tx.update(plantsTable).set({ name: species.name }).where(and(eq(plantsTable.speciesId, species.id), isNull(plantsTable.personalName)));
    }
    return species;
  });
  if (!updated) { res.status(404).json({ error: "Вид не знайдено" }); return; }
  res.json(await mapSpecies(updated));
});

router.delete("/species/:id", async (req, res): Promise<void> => {
  const user = await currentUser(req);
  if (!user || user.role !== "ADMIN") { res.status(403).json({ error: "Недостатньо прав" }); return; }
  const used = await db.select({ id: plantsTable.id }).from(plantsTable).where(eq(plantsTable.speciesId, idFrom(req))).limit(1);
  if (used.length) { res.status(409).json({ error: "Вид використовується рослинами і не може бути видалений" }); return; }
  await db.delete(speciesTable).where(eq(speciesTable.id, idFrom(req)));
  res.sendStatus(204);
});

async function validatedPlantLocation(userId: number, data: Partial<z.infer<typeof plantInput>>, existing?: typeof plantsTable.$inferSelect) {
  const values: Partial<typeof plantsTable.$inferInsert> = {};
  if (data.placeId !== undefined) {
    const [place] = await db.select().from(plantPlacesTable).where(and(eq(plantPlacesTable.id, data.placeId), eq(plantPlacesTable.userId, userId)));
    if (!place) throw new Error("Оберіть власне збережене місце");
    Object.assign(values, { placeId: place.id, location: place.name, environmentType: place.environmentType });
  } else if (data.location !== undefined || data.environmentType !== undefined || !existing) {
    const name = data.location ?? existing?.location ?? "";
    const environmentType = data.environmentType ?? existing?.environmentType ?? "INDOOR";
    await db.insert(plantPlacesTable).values({ userId, name, environmentType }).onConflictDoNothing();
    const [place] = await db.select().from(plantPlacesTable).where(and(eq(plantPlacesTable.userId, userId), eq(plantPlacesTable.name, name), eq(plantPlacesTable.environmentType, environmentType)));
    Object.assign(values, { placeId: place.id, location: place.name, environmentType: place.environmentType });
  }
  if (data.weatherLocationId !== undefined) {
    if (data.weatherLocationId === null) Object.assign(values, { weatherLocationId: null, weatherLocationName: null, weatherLatitude: null, weatherLongitude: null });
    else {
      const [location] = await db.select().from(savedLocationsTable).where(and(eq(savedLocationsTable.id, data.weatherLocationId), eq(savedLocationsTable.userId, userId)));
      if (!location) throw new Error("Оберіть власну збережену погодну локацію");
      Object.assign(values, { weatherLocationId: location.id, weatherLocationName: location.displayName, weatherLatitude: location.latitude, weatherLongitude: location.longitude });
      await db.update(savedLocationsTable).set({ lastUsedAt: new Date() }).where(eq(savedLocationsTable.id, location.id));
    }
  } else if (data.weatherLocationName && data.weatherLatitude !== null && data.weatherLatitude !== undefined && data.weatherLongitude !== null && data.weatherLongitude !== undefined) {
    await db.insert(savedLocationsTable).values({ userId, displayName: data.weatherLocationName, latitude: String(data.weatherLatitude), longitude: String(data.weatherLongitude) }).onConflictDoNothing();
    const [location] = await db.select().from(savedLocationsTable).where(and(eq(savedLocationsTable.userId, userId), eq(savedLocationsTable.latitude, String(data.weatherLatitude)), eq(savedLocationsTable.longitude, String(data.weatherLongitude))));
    values.weatherLocationId = location.id;
  } else if (data.weatherLocationName === null) values.weatherLocationId = null;
  return values;
}

async function validatedPlantIdentity(data: Partial<z.infer<typeof plantInput>>, existing?: typeof plantsTable.$inferSelect) {
  const identity = resolveIdentityFields(data, existing);
  if (identity.speciesId === null) return identity;
  const speciesId = identity.speciesId;
  const [species] = await db.select().from(speciesTable).where(eq(speciesTable.id, speciesId));
  if (!species) throw new Error("Оберіть рослину з довідника");
  return { speciesId: species.id, category: null, ...resolvePlantName(data, species.name, existing?.speciesId === null ? undefined : existing) };
}

async function linkedSpecies(plant: typeof plantsTable.$inferSelect, source: typeof db | FloraTransaction = db) {
  if (plant.speciesId === null) return null;
  const [species] = await source.select().from(speciesTable).where(eq(speciesTable.id, plant.speciesId)).for("share");
  if (!species) throw new CareEligibilityError("Вид рослини більше не існує. Оновіть дані");
  return species;
}
async function effectiveCare(plant: typeof plantsTable.$inferSelect, source: typeof db | FloraTransaction = db): Promise<CareContext> {
  return await linkedSpecies(plant, source) ?? customCareContext(plant);
}

/** Snapshot actual context as well as monotonic identity revisions. No alias or photo inputs. */
async function careSnapshot(plant: typeof plantsTable.$inferSelect, context: CareContext, source: typeof db | FloraTransaction = db) {
  const [user] = await source.select().from(usersTable).where(eq(usersTable.id, plant.userId));
  const weather = await resolveSavedWeatherLocation(user, plant);
  const environment = await plantEnvironment(plant);
  const tasks = await source.select().from(tasksTable).where(eq(tasksTable.plantId, plant.id)).orderBy(tasksTable.id);
  const logs = tasks.length ? await source.select().from(careLogsTable).where(inArray(careLogsTable.taskId, tasks.map(task => task.id))).orderBy(careLogsTable.id) : [];
  return createHash("sha256").update(JSON.stringify([
    eligibilityVersion(context, plant.eligibilityRevision), environment, weather,
    tasks.map(task => [task.id, task.type, task.scheduledDate, task.status, task.priority, task.postponementCount]),
    logs.map(log => [log.taskId, log.completedAt]),
  ])).digest("hex");
}

async function prepareRecommendationSet(
  user: typeof usersTable.$inferSelect,
  plant: typeof plantsTable.$inferSelect,
  useDevScenario: boolean,
) {
  const species = await effectiveCare(plant);
  const snapshot = await careSnapshot(plant, species);
  const location = await resolveSavedWeatherLocation(user, plant);
  const forecast = useDevScenario
    ? createRainTomorrowScenario(location)
    : await weatherService.getForecast(location);
  if (!useDevScenario && forecast.isMock) throw new WeatherUnavailableError("Демонстраційні погодні дані не можна використовувати для рекомендацій.");

  const tasks = await db.select().from(tasksTable).where(and(
    eq(tasksTable.plantId, plant.id),
    inArray(tasksTable.status, ["PLANNED", "POSTPONED"]),
  ));
  const completedCare = await db.select({ type: tasksTable.type, completedAt: max(careLogsTable.completedAt) })
    .from(careLogsTable)
    .innerJoin(tasksTable, eq(careLogsTable.taskId, tasksTable.id))
    .where(and(eq(tasksTable.plantId, plant.id), eq(tasksTable.status, "COMPLETED")))
    .groupBy(tasksTable.type);
  const lastCompletedByType: Record<string, string> = {};
  for (const action of completedCare) {
    if (action.completedAt) lastCompletedByType[action.type] = todayInKyiv(action.completedAt);
  }
  const lastWatering = lastCompletedByType.WATERING ?? null;
  const rules = species.id === null
    ? []
    : await db.select().from(speciesCareRulesTable).where(eq(speciesCareRulesTable.speciesId, species.id));
  const drafts = generateRules(
    species,
    tasks,
    forecast.forecast,
    location.name,
    await plantEnvironment(plant),
    lastWatering,
    rules,
    lastCompletedByType,
  );
  const [latestPlant] = await db.select().from(plantsTable).where(eq(plantsTable.id, plant.id));
  if (!latestPlant || snapshot !== await careSnapshot(latestPlant, await effectiveCare(latestPlant))) {
    throw new CareEligibilityError("Умови або план змінилися під час підготовки. Оновіть рекомендацію.");
  }
  return { species, snapshot, location, forecast, tasks, rules, drafts };
}

async function saveRecommendationDraft(
  source: typeof db | FloraTransaction,
  plant: typeof plantsTable.$inferSelect,
  snapshot: string,
  tasks: CareTask[],
  draft: RecommendationDraft,
  forecast: Awaited<ReturnType<typeof weatherService.getForecast>>,
  useDevScenario: boolean,
  excludeId?: number,
) {
  const relatedTaskId = draft.relatedTaskId ?? null;
  const originalDate = draft.originalDate ?? null;
  const suggestedDate = draft.suggestedDate ?? null;
  const duplicateConditions = [
    eq(recommendationsTable.plantId, plant.id),
    eq(recommendationsTable.type, draft.type),
    eq(recommendationsTable.eligibilityVersion, snapshot),
    eq(recommendationsTable.applied, 0),
    isNull(recommendationsTable.supersededAt),
    relatedTaskId === null ? isNull(recommendationsTable.relatedTaskId) : eq(recommendationsTable.relatedTaskId, relatedTaskId),
    originalDate === null ? isNull(recommendationsTable.originalDate) : eq(recommendationsTable.originalDate, originalDate),
    suggestedDate === null ? isNull(recommendationsTable.suggestedDate) : eq(recommendationsTable.suggestedDate, suggestedDate),
  ];
  if (excludeId !== undefined) duplicateConditions.push(ne(recommendationsTable.id, excludeId));
  const [existing] = await source.select().from(recommendationsTable)
    .where(and(...duplicateConditions))
    .orderBy(desc(recommendationsTable.generatedAt))
    .limit(1);
  const weatherData = useDevScenario
    ? { ...draft.weather, [devScenarioKey]: DEV_WEATHER_SCENARIO, [devScenarioStartKey]: forecast.forecast[0]?.date ?? today() }
    : draft.weather;
  const values = {
    generatedAt: new Date(),
    type: draft.type,
    text: draft.text,
    priority: draft.priority,
    relatedTaskId,
    explanation: `${draft.explanation} Джерело погодних даних: ${forecast.isMock ? "демонстраційні погодні дані" : "актуальні погодні дані"}.`,
    originalDate,
    suggestedDate,
    weatherJson: JSON.stringify(weatherData),
    eligibilityVersion: snapshot,
    careType: tasks.find(task => task.id === relatedTaskId)?.type ?? null,
  };
  if (relatedTaskId !== null) {
    const supersedeConditions = [
      eq(recommendationsTable.plantId, plant.id),
      eq(recommendationsTable.relatedTaskId, relatedTaskId),
      eq(recommendationsTable.applied, 0),
      isNull(recommendationsTable.supersededAt),
      ne(recommendationsTable.id, existing?.id ?? -1),
    ];
    await source.update(recommendationsTable).set({ supersededAt: new Date() })
      .where(and(...supersedeConditions));
  }
  if (existing && existing.id !== excludeId) {
    const [updated] = await source.update(recommendationsTable).set(values)
      .where(eq(recommendationsTable.id, existing.id)).returning();
    return updated;
  }
  const [created] = await source.insert(recommendationsTable).values({
    plantId: plant.id,
    ...values,
    applied: 0,
    appliedAt: null,
    supersededAt: null,
  }).returning();
  return created;
}

async function supersedeMissingTaskRecommendations(
  source: typeof db | FloraTransaction,
  plantId: number,
  tasks: CareTask[],
  drafts: RecommendationDraft[],
) {
  const draftTaskIds = new Set(drafts.flatMap(draft => draft.relatedTaskId === null ? [] : [draft.relatedTaskId]));
  const analyzedTaskIds = [...new Set(tasks
    .filter(task => ["PLANNED", "POSTPONED"].includes(task.status))
    .map(task => task.id))];
  for (const taskId of analyzedTaskIds) {
    if (draftTaskIds.has(taskId)) continue;
    await source.update(recommendationsTable).set({ supersededAt: new Date() })
      .where(and(
        eq(recommendationsTable.plantId, plantId),
        eq(recommendationsTable.relatedTaskId, taskId),
        eq(recommendationsTable.applied, 0),
        isNull(recommendationsTable.supersededAt),
      ));
  }
}

const knowledgeInput = z.object({
  careRules: z.array(z.object({
    careType: z.enum(CARE_TYPES),
    ruleCode: z.string().nullable().optional(),
    triggerDescription: z.string().nullable().optional(),
    recommendedAction: z.string().nullable().optional(),
    intervalDaysMin: z.number().int().positive().nullable().optional(),
    intervalDaysMax: z.number().int().positive().nullable().optional(),
    targetWaterMmWeekMin: z.number().min(0).nullable().optional(),
    targetWaterMmWeekMax: z.number().min(0).nullable().optional(),
    sourceCodes: z.array(z.string().min(1)).default([]),
    rainThresholdMm: z.number().min(0).nullable(),
    maxWindSpeedMps: z.number().min(0).nullable(),
    minTemperature: z.number().nullable(),
    maxTemperature: z.number().nullable(),
    notes: z.string().nullable(),
  }).refine(rule => rule.minTemperature === null || rule.maxTemperature === null || rule.minTemperature <= rule.maxTemperature)
    .refine(rule => rule.intervalDaysMin == null || rule.intervalDaysMax == null || rule.intervalDaysMin <= rule.intervalDaysMax)
    .refine(rule => rule.targetWaterMmWeekMin == null || rule.targetWaterMmWeekMax == null || rule.targetWaterMmWeekMin <= rule.targetWaterMmWeekMax)).max(8),
  sources: z.array(z.object({
    sourceCode: z.string().nullable().optional(),
    sourceName: z.string().trim().min(1), sourceUrl: z.string().url().refine(url => /^https?:\/\//.test(url)).nullable(),
    organization: z.string().nullable().optional(), subject: z.string().nullable().optional(), citation: z.string().nullable().optional(),
    retrievedAt: z.union([z.iso.datetime({ offset: true }), dates.refine(date => !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date)]).nullable(), notes: z.string().nullable(),
  }).refine(value => value.sourceCode == null || value.sourceCode.length > 0)).max(100),
}).refine(value => new Set(value.careRules.map(rule => rule.careType)).size === value.careRules.length)
  .refine(value => {
    const codes = value.sources.flatMap(source => source.sourceCode ? [source.sourceCode] : []);
    return new Set(codes).size === codes.length;
  });

async function writeSpeciesKnowledge(tx: FloraTransaction, speciesId: number, data: z.infer<typeof knowledgeInput>) {
  await tx.delete(speciesCareRulesTable).where(eq(speciesCareRulesTable.speciesId, speciesId));
  await tx.delete(speciesKnowledgeSourcesTable).where(eq(speciesKnowledgeSourcesTable.speciesId, speciesId));
  const savedSources = [];
  for (const source of data.sources) {
    const sourceValues = {
      ...source, speciesId: null, retrievedAt: source.retrievedAt ? new Date(source.retrievedAt) : null,
    };
    const [savedSource] = source.sourceCode
      ? await tx.insert(knowledgeSourcesTable).values(sourceValues).onConflictDoUpdate({
        target: knowledgeSourcesTable.sourceCode,
        set: {
          sourceName: source.sourceName,
          organization: source.organization ?? null,
          subject: source.subject ?? null,
          sourceUrl: source.sourceUrl,
          retrievedAt: sourceValues.retrievedAt,
          notes: source.notes,
          citation: source.citation ?? null,
        },
      }).returning({ id: knowledgeSourcesTable.id, sourceCode: knowledgeSourcesTable.sourceCode })
      : await tx.insert(knowledgeSourcesTable).values(sourceValues).returning({ id: knowledgeSourcesTable.id, sourceCode: knowledgeSourcesTable.sourceCode });
    savedSources.push(savedSource);
  }
  if (savedSources.length) await tx.insert(speciesKnowledgeSourcesTable).values(savedSources.map(source => ({ speciesId, sourceId: source.id })));
  const sourcesByCode = new Map(savedSources.flatMap(source => source.sourceCode ? [[source.sourceCode, source.id] as const] : []));
  for (const rule of data.careRules) {
    const [savedRule] = await tx.insert(speciesCareRulesTable).values({
      ...rule, speciesId,
      rainThresholdMm: dbCoordinate(rule.rainThresholdMm),
      maxWindSpeedMps: dbCoordinate(rule.maxWindSpeedMps),
      minTemperature: dbCoordinate(rule.minTemperature),
      maxTemperature: dbCoordinate(rule.maxTemperature),
      targetWaterMmWeekMin: dbCoordinate(rule.targetWaterMmWeekMin),
      targetWaterMmWeekMax: dbCoordinate(rule.targetWaterMmWeekMax),
    }).returning({ id: speciesCareRulesTable.id });
    const sourceIds = rule.sourceCodes.flatMap(code => {
      const id = sourcesByCode.get(code);
      if (id === undefined) throw new Error(`Джерело ${code} не прив'язане до виду ${speciesId}`);
      return [id];
    });
    if (sourceIds.length) await tx.insert(speciesCareRuleSourcesTable).values(sourceIds.map(sourceId => ({ careRuleId: savedRule.id, sourceId })));
  }
}

async function speciesKnowledge(speciesId: number) {
  const rules = await db.select().from(speciesCareRulesTable).where(eq(speciesCareRulesTable.speciesId, speciesId)).orderBy(speciesCareRulesTable.careType);
  const sources = await db.select({
    id: knowledgeSourcesTable.id,
    sourceCode: knowledgeSourcesTable.sourceCode,
    sourceName: knowledgeSourcesTable.sourceName,
    organization: knowledgeSourcesTable.organization,
    subject: knowledgeSourcesTable.subject,
    sourceUrl: knowledgeSourcesTable.sourceUrl,
    retrievedAt: knowledgeSourcesTable.retrievedAt,
    notes: knowledgeSourcesTable.notes,
    citation: knowledgeSourcesTable.citation,
  }).from(speciesKnowledgeSourcesTable)
    .innerJoin(knowledgeSourcesTable, eq(knowledgeSourcesTable.id, speciesKnowledgeSourcesTable.sourceId))
    .where(eq(speciesKnowledgeSourcesTable.speciesId, speciesId))
    .orderBy(knowledgeSourcesTable.id);
  const ruleSources = rules.length ? await db.select({
    careRuleId: speciesCareRuleSourcesTable.careRuleId,
    sourceCode: knowledgeSourcesTable.sourceCode,
  }).from(speciesCareRuleSourcesTable)
    .innerJoin(knowledgeSourcesTable, eq(knowledgeSourcesTable.id, speciesCareRuleSourcesTable.sourceId))
    .where(inArray(speciesCareRuleSourcesTable.careRuleId, rules.map(rule => rule.id))) : [];
  const sourceCodesByRule = new Map<number, string[]>();
  for (const link of ruleSources) if (link.sourceCode) sourceCodesByRule.set(link.careRuleId, [...(sourceCodesByRule.get(link.careRuleId) ?? []), link.sourceCode]);
  return {
    careRules: rules.map(rule => ({
      ...rule,
      rainThresholdMm: rule.rainThresholdMm === null ? null : Number(rule.rainThresholdMm),
      maxWindSpeedMps: rule.maxWindSpeedMps === null ? null : Number(rule.maxWindSpeedMps),
      minTemperature: rule.minTemperature === null ? null : Number(rule.minTemperature),
      maxTemperature: rule.maxTemperature === null ? null : Number(rule.maxTemperature),
      targetWaterMmWeekMin: rule.targetWaterMmWeekMin === null ? null : Number(rule.targetWaterMmWeekMin),
      targetWaterMmWeekMax: rule.targetWaterMmWeekMax === null ? null : Number(rule.targetWaterMmWeekMax),
      sourceCodes: sourceCodesByRule.get(rule.id) ?? [],
    })),
    sources: sources.map(source => ({ ...source, retrievedAt: source.retrievedAt?.toISOString() ?? null })),
  };
}
router.get("/species/:id/knowledge", async (req, res) => {
  const [species] = await db.select().from(speciesTable).where(eq(speciesTable.id, idFrom(req)));
  if (!species) { res.status(404).json({ error: "Вид не знайдено" }); return; }
  res.json(await speciesKnowledge(species.id));
});
router.put("/species/:id/knowledge", async (req, res) => {
  const user = await currentUser(req);
  if (!user || user.role !== "ADMIN") { res.status(403).json({ error: "Недостатньо прав" }); return; }
  const parsed = knowledgeInput.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Перевірте пороги, унікальність типів догляду та джерела знань" }); return; }
  const [species] = await db.select().from(speciesTable).where(eq(speciesTable.id, idFrom(req)));
  if (!species) { res.status(404).json({ error: "Вид не знайдено" }); return; }
  await db.transaction(async tx => {
    const [current] = await tx.select().from(speciesTable).where(eq(speciesTable.id, species.id)).for("update");
    for (const rule of parsed.data.careRules) assertEligible(current, rule.careType);
    await tx.update(speciesTable).set({ careRevision: current.careRevision + 1 }).where(eq(speciesTable.id, species.id));
    await writeSpeciesKnowledge(tx, species.id, parsed.data);
  });
  res.json(await speciesKnowledge(species.id));
});

router.get("/plants", async (req, res): Promise<void> => {
  const user = await currentUser(req);
  if (!user) { res.status(401).json({ error: "Необхідно увійти" }); return; }
  const search = stringParam(req.query.search)?.toLowerCase();
  const location = stringParam(req.query.location)?.toLowerCase();
  const speciesId = Number(req.query.speciesId);
  const rows = await db.select().from(plantsTable).where(eq(plantsTable.userId, user.id));
  const mapped = await Promise.all(rows.map(mapPlant));
  res.json(mapped.filter((plant) => {
    const matchesSearch = !search || plant.name.toLowerCase().includes(search) || plant.speciesName?.toLowerCase().includes(search) || plant.location.toLowerCase().includes(search);
    const matchesLocation = !location || plant.location.toLowerCase().includes(location);
    const matchesSpecies = !Number.isFinite(speciesId) || plant.speciesId === speciesId;
    const matchesOverdue = req.query.overdue !== "true" || plant.careStatus === "OVERDUE";
    const matchesPriority = req.query.highPriority !== "true" || plant.hasHighPriorityTasks;
    return matchesSearch && matchesLocation && matchesSpecies && matchesOverdue && matchesPriority && (!req.query.category || plant.category === req.query.category);
  }));
});

router.post("/plants", async (req, res): Promise<void> => {
  const user = await currentUser(req);
  const parsed = plantInput.safeParse(req.body);
  if (!user) { res.status(401).json({ error: "Необхідно увійти" }); return; }
  if (!parsed.success || !hasValidWeatherOverride(parsed.data)) { res.status(400).json({ error: "Перевірте назву, вид, фізичне місце та погодну локацію рослини" }); return; }
  if (!await canAttachPhoto(parsed.data.photoObjectPath, getAuth(req).userId)) { res.status(400).json({ error: "Фото не завантажене або належить іншому користувачу." }); return; }
  let locations: Partial<typeof plantsTable.$inferInsert>;
  let identity: Awaited<ReturnType<typeof validatedPlantIdentity>>;
  try {
    identity = await validatedPlantIdentity(parsed.data);
    locations = await validatedPlantLocation(user.id, parsed.data);
  }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Некоректна локація" }); return; }
  const [created] = await db.insert(plantsTable).values({
    ...parsed.data,
    ...identity,
    environmentType: parsed.data.environmentType ?? "INDOOR",
    weatherLocationName: parsed.data.weatherLocationName ?? null,
    weatherLatitude: dbCoordinate(parsed.data.weatherLatitude) ?? null,
    weatherLongitude: dbCoordinate(parsed.data.weatherLongitude) ?? null,
    userId: user.id,
    ...locations,
  }).returning();
  res.status(201).json(await mapPlant(created));
});

router.get("/plants/:id", async (req, res): Promise<void> => {
  const { plant } = await getPlantForUser(req, idFrom(req));
  if (!plant) { res.status(404).json({ error: "Рослину не знайдено" }); return; }
  const species = await linkedSpecies(plant);
  const tasks = await db.select().from(tasksTable).where(eq(tasksTable.plantId, plant.id)).orderBy(desc(tasksTable.scheduledDate));
  const recommendations = await db.select().from(recommendationsTable).where(eq(recommendationsTable.plantId, plant.id)).orderBy(desc(recommendationsTable.generatedAt)).limit(5);
  const plantLogs = tasks.length ? await db.select().from(careLogsTable).where(inArray(careLogsTable.taskId, tasks.map(task => task.id))).orderBy(desc(careLogsTable.completedAt)) : [];
  const history = await Promise.all(plantLogs.map(async (log) => {
    const task = tasks.find((item) => item.id === log.taskId);
    return { id: log.id, taskId: log.taskId, plantId: plant.id, plantName: plant.name, type: task?.type ?? "OTHER", plannedDate: task?.scheduledDate ?? "", completedAt: log.completedAt.toISOString(), comment: log.comment };
  }));
  const mapped = await mapPlant(plant);
  res.json({ ...mapped, species: species ? await mapSpecies(species) : null, upcomingTasks: await mapTasks(tasks.filter((task) => task.status !== "COMPLETED" && task.status !== "CANCELLED"), [plant]), history, recommendations: await Promise.all(recommendations.map(mapRecommendation)), stats: { totalTasks: tasks.length, completedTasks: tasks.filter((task) => task.status === "COMPLETED").length, completionRate: tasks.length ? Math.round((tasks.filter((task) => task.status === "COMPLETED").length / tasks.length) * 100) : 0, lastWatered: history.find((item) => item.type === "WATERING")?.completedAt ?? null } });
});

router.patch("/plants/:id", async (req, res): Promise<void> => {
  const { plant, user } = await getPlantForUser(req, idFrom(req));
  const parsed = plantInput.partial().safeParse(req.body);
  if (!plant || !user) { res.status(404).json({ error: "Рослину не знайдено" }); return; }
  if (!parsed.success || !hasValidWeatherOverride(parsed.data)) { res.status(400).json({ error: "Некоректні дані рослини або погодної локації" }); return; }
  if (!await canAttachPhoto(parsed.data.photoObjectPath, getAuth(req).userId)) { res.status(400).json({ error: "Фото не завантажене або належить іншому користувачу." }); return; }
  const { weatherLatitude, weatherLongitude, ...plantValues } = parsed.data;
  let locations: Partial<typeof plantsTable.$inferInsert>;
  let identity: Awaited<ReturnType<typeof validatedPlantIdentity>>;
  try {
    identity = await validatedPlantIdentity(parsed.data, plant);
    locations = await validatedPlantLocation(user.id, parsed.data, plant);
  }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Некоректна локація" }); return; }
  const updated = await db.transaction(async tx => {
    const [current] = await tx.select().from(plantsTable).where(eq(plantsTable.id, plant.id)).for("update");
    const identity = await validatedPlantIdentity(parsed.data, current);
    const [updated] = await tx.update(plantsTable).set({
    ...plantValues,
    ...identity,
    eligibilityRevision: current.eligibilityRevision + (identity.speciesId !== current.speciesId || identity.category !== current.category ||
      Object.entries(locations).some(([key, value]) => current[key as keyof typeof current] !== value) ||
      parsed.data.weatherLocationName !== undefined && parsed.data.weatherLocationName !== current.weatherLocationName ? 1 : 0),
    ...(weatherLatitude === undefined ? {} : { weatherLatitude: dbCoordinate(weatherLatitude) }),
    ...(weatherLongitude === undefined ? {} : { weatherLongitude: dbCoordinate(weatherLongitude) }),
    ...locations,
    }).where(eq(plantsTable.id, plant.id)).returning();
    return updated;
  });
  res.json(await mapPlant(updated));
});

router.get("/plants/:id/care-plan", async (req, res) => {
  const { plant } = await getPlantForUser(req, idFrom(req));
  if (!plant) { res.status(404).json({ error: "Рослину не знайдено" }); return; }
  const species = await effectiveCare(plant);
  const rules = species.id === null ? [] : await db.select().from(speciesCareRulesTable).where(eq(speciesCareRulesTable.speciesId, species.id));
  const active = await db.select().from(tasksTable).where(and(eq(tasksTable.plantId, plant.id), inArray(tasksTable.status, ["PLANNED", "POSTPONED"])));
  const snapshot = await careSnapshot(plant, species);
  res.json(carePlan(species, new Date(), plant.eligibilityRevision, rules).filter(item => !active.some(task => task.type === item.type)).map(item => ({ ...item, eligibilityVersion: snapshot })));
});
router.post("/plants/:id/care-plan", async (req, res) => {
  const { plant } = await getPlantForUser(req, idFrom(req));
  if (!plant) { res.status(404).json({ error: "Рослину не знайдено" }); return; }
  const parsed = z.object({ items: z.array(z.object({ type: z.enum(CARE_TYPES), eligibilityVersion: z.string(), scheduledDate: dates, reason: z.string().max(5000) })).min(1).max(10) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Оберіть завдання та перевірте дати плану" }); return; }
  const created = await db.transaction(async tx => {
    const [currentPlant] = await tx.select().from(plantsTable).where(eq(plantsTable.id, plant.id)).for("update");
    const species = await effectiveCare(currentPlant, tx);
    const rules = species.id === null ? [] : await tx.select().from(speciesCareRulesTable).where(eq(speciesCareRulesTable.speciesId, species.id));
    const candidates = carePlan(species, new Date(), currentPlant.eligibilityRevision, rules);
    for (const item of parsed.data.items) {
      assertEligible(species, item.type);
      if (item.eligibilityVersion !== await careSnapshot(currentPlant, species, tx)) throw new CareEligibilityError("Умови, план або застосовність змінилися. Оновіть попередній перегляд плану");
      if (!candidates.some(candidate => candidate.type === item.type)) throw new CareEligibilityError("Для цього виду догляду немає підтвердженого інтервалу планування");
    }
    const existing = await tx.select().from(tasksTable).where(and(eq(tasksTable.plantId, plant.id), inArray(tasksTable.status, ["PLANNED", "POSTPONED"])));
    const keys = new Set(existing.map(task => `${task.type}:${task.scheduledDate}`));
    const types = new Set(existing.map(task => task.type));
    const items = parsed.data.items.filter(item => { const key = `${item.type}:${item.scheduledDate}`; if (keys.has(key) || types.has(item.type)) return false; keys.add(key); types.add(item.type); return true; });
    if (!items.length) return [];
    const tasks = await tx.insert(tasksTable).values(items.map(item => ({ plantId: plant.id, type: item.type, scheduledDate: item.scheduledDate, priority: "MEDIUM", notes: candidates.find(candidate => candidate.type === item.type)!.reason }))).returning();
    await tx.insert(remindersTable).values(tasks.map(task => ({ taskId: task.id, reminderDate: task.scheduledDate, status: "PENDING" })));
    return tasks;
  });
  res.status(201).json(await mapTasks(created, [plant]));
});

router.delete("/plants/:id", async (req, res): Promise<void> => {
  const { plant } = await getPlantForUser(req, idFrom(req));
  if (!plant) { res.status(404).json({ error: "Рослину не знайдено" }); return; }
  await db.delete(plantsTable).where(eq(plantsTable.id, plant.id));
  res.sendStatus(204);
});

router.get("/tasks", async (req, res): Promise<void> => {
  const user = await currentUser(req);
  if (!user) { res.status(401).json({ error: "Необхідно увійти" }); return; }
  const plants = await db.select({ id: plantsTable.id }).from(plantsTable).where(eq(plantsTable.userId, user.id));
  const plantIds = new Set(plants.map((item) => item.id));
  const rows = await db.select().from(tasksTable).orderBy(tasksTable.scheduledDate);
  const from = stringParam(req.query.from);
  const to = stringParam(req.query.to);
  const status = stringParam(req.query.status);
  const plantId = Number(req.query.plantId);
  const result = await mapTasks(rows.filter((task) => plantIds.has(task.plantId) && (!req.query.type || task.type === req.query.type) && (!from || task.scheduledDate >= from) && (!to || task.scheduledDate <= to) && (!status || task.status === status) && (!Number.isFinite(plantId) || task.plantId === plantId)));
  res.json(result);
});

router.post("/tasks", async (req, res): Promise<void> => {
  if (!isCareType(req.body?.type)) { res.status(400).json({ error: "Невідомий тип догляду. Оберіть доступну дію для рослини" }); return; }
  const parsed = taskInput.safeParse(req.body);
  const { plant } = await getPlantForUser(req, Number(req.body?.plantId));
  if (!parsed.success || !plant) { res.status(400).json({ error: "Перевірте дату, тип і рослину" }); return; }
  const created = await db.transaction(async tx => {
    const [currentPlant] = await tx.select().from(plantsTable).where(eq(plantsTable.id, plant.id)).for("share");
    const species = await effectiveCare(currentPlant, tx);
    assertEligible(species, parsed.data.type);
    const [created] = await tx.insert(tasksTable).values(parsed.data).returning();
    await tx.insert(remindersTable).values({ taskId: created.id, reminderDate: created.scheduledDate, status: "PENDING" });
    return created;
  });
  res.status(201).json(await mapTask(created));
});

router.patch("/tasks/:id", async (req, res): Promise<void> => {
  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, idFrom(req)));
  const { plant } = await getPlantForUser(req, task?.plantId ?? -1);
  if (!task || !plant) { res.status(404).json({ error: "Завдання не знайдено" }); return; }
  const parsed = taskInput.partial().extend({ type: z.string().optional(), status: z.enum(["PLANNED", "POSTPONED", "COMPLETED", "CANCELLED"]).optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Некоректні дані завдання" }); return; }
  if (parsed.data.plantId !== undefined && !(await getPlantForUser(req, parsed.data.plantId)).plant) { res.status(400).json({ error: "Оберіть власну рослину" }); return; }
  const updated = await db.transaction(async tx => {
    const [current] = await tx.select().from(tasksTable).where(eq(tasksTable.id, task.id)).for("update");
    const merged = { ...current, ...parsed.data };
    const [target] = await tx.select().from(plantsTable).where(eq(plantsTable.id, merged.plantId)).for("share");
    if (!target || target.userId !== plant.userId) throw new CareEligibilityError("Оберіть власну рослину");
    const species = await effectiveCare(target, tx);
    assertTaskUpdate(current, merged, species);
    const [updated] = await tx.update(tasksTable).set(parsed.data).where(eq(tasksTable.id, task.id)).returning();
    if (merged.status === "COMPLETED" && current.status !== "COMPLETED") await tx.insert(careLogsTable).values({ taskId: task.id, comment: "" });
    if (["COMPLETED", "CANCELLED"].includes(merged.status)) await tx.update(remindersTable).set({ status: "DISMISSED" }).where(eq(remindersTable.taskId, task.id));
    else if (parsed.data.scheduledDate) await tx.update(remindersTable).set({ reminderDate: parsed.data.scheduledDate }).where(eq(remindersTable.taskId, task.id));
    if (parsed.data.scheduledDate && parsed.data.scheduledDate !== current.scheduledDate &&
      ["PLANNED", "POSTPONED"].includes(merged.status)) {
      const [reminder] = await tx.select().from(remindersTable).where(eq(remindersTable.taskId, task.id)).limit(1);
      const careName = careLabels[merged.type] ?? "Догляд";
      await writeNotification(tx, {
        userId: plant.userId,
        type: "MANUAL_RESCHEDULED",
        title: "Завдання перенесено вручну",
        message: `${careName} рослини «${target.name}» перенесено вручну з ${notificationDateLabel(current.scheduledDate)} на ${notificationDateLabel(parsed.data.scheduledDate)}.`,
        dedupeKey: `manual-rescheduled:${task.id}:${current.scheduledDate}:${parsed.data.scheduledDate}`,
        href: `/calendar?taskId=${task.id}`,
        plantId: target.id,
        taskId: task.id,
        reminderId: reminder?.id ?? null,
        recommendationId: null,
      });
    }
    return updated;
  });
  res.json(await mapTask(updated));
});

router.delete("/tasks/:id", async (req, res): Promise<void> => {
  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, idFrom(req)));
  const { plant } = await getPlantForUser(req, task?.plantId ?? -1);
  if (!task || !plant) { res.status(404).json({ error: "Завдання не знайдено" }); return; }
  await db.update(tasksTable).set({ status: "CANCELLED" }).where(eq(tasksTable.id, task.id));
  await db.update(remindersTable).set({ status: "DISMISSED" }).where(eq(remindersTable.taskId, task.id));
  res.sendStatus(204);
});

router.post("/tasks/:id/complete", async (req, res): Promise<void> => {
  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, idFrom(req)));
  const { plant } = await getPlantForUser(req, task?.plantId ?? -1);
  if (!task || !plant) { res.status(404).json({ error: "Завдання не знайдено" }); return; }
  const updated = await db.transaction(async tx => {
    const [current] = await tx.select().from(tasksTable).where(eq(tasksTable.id, task.id)).for("update");
    if (current.status === "COMPLETED") return current;
    if (current.status === "CANCELLED") return null;
    const [completed] = await tx.update(tasksTable).set({ status: "COMPLETED" }).where(eq(tasksTable.id, task.id)).returning();
    await tx.insert(careLogsTable).values({ taskId: task.id, comment: typeof req.body?.comment === "string" ? req.body.comment : "" });
    await tx.update(remindersTable).set({ status: "DISMISSED" }).where(eq(remindersTable.taskId, task.id));
    return completed;
  });
  if (!updated) { res.status(409).json({ error: "Скасоване завдання не можна виконати" }); return; }
  res.json(await mapTask(updated));
});

router.get("/reminders", async (req, res): Promise<void> => {
  const user = await currentUser(req);
  if (!user) { res.status(401).json({ error: "Необхідно увійти" }); return; }
  const plants = await db.select({ id: plantsTable.id, name: plantsTable.name }).from(plantsTable).where(eq(plantsTable.userId, user.id));
  const plantMap = new Map(plants.map((item) => [item.id, item]));
  const tasks = await db.select().from(tasksTable);
  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  const reminders = await db.select().from(remindersTable).where(eq(remindersTable.status, "PENDING")).orderBy(remindersTable.reminderDate);
  res.json(reminders.filter((item) => plantMap.has(taskMap.get(item.taskId)?.plantId ?? -1) && ["PLANNED", "POSTPONED"].includes(taskMap.get(item.taskId)?.status ?? "")).map((item) => ({ id: item.id, taskId: item.taskId, plantName: plantMap.get(taskMap.get(item.taskId)?.plantId ?? -1)?.name ?? "Рослина", taskType: taskMap.get(item.taskId)?.type ?? "OTHER", reminderDate: item.reminderDate, status: item.status, message: `Заплановано: ${careLabels[taskMap.get(item.taskId)?.type ?? "OTHER"] ?? "Догляд"} ${item.reminderDate}` })));
});

router.patch("/reminders/:id", async (req, res): Promise<void> => {
  const user = await currentUser(req);
  const [existing] = await db.select().from(remindersTable).where(eq(remindersTable.id, idFrom(req))).limit(1);
  const [task] = existing ? await db.select().from(tasksTable).where(eq(tasksTable.id, existing.taskId)).limit(1) : [];
  const { plant } = await getPlantForUser(req, task?.plantId ?? -1);
  if (!user || !existing || !task || !plant) { res.status(404).json({ error: "Нагадування не знайдено" }); return; }
  const status = z.enum(["PENDING", "READ", "DISMISSED"]).safeParse(req.body?.status);
  if (!status.success) { res.status(400).json({ error: "Некоректний статус нагадування" }); return; }
  const [reminder] = await db.update(remindersTable).set({ status: status.data }).where(eq(remindersTable.id, existing.id)).returning();
  res.json({ id: reminder.id, taskId: reminder.taskId, plantName: plant.name, taskType: task.type, reminderDate: reminder.reminderDate, status: reminder.status, message: "Оновлено" });
});

router.get("/notifications", async (req, res): Promise<void> => {
  const user = await currentUser(req);
  if (!user) { res.status(401).json({ error: "Необхідно увійти" }); return; }
  res.json(await syncUserNotifications(user.id));
});

router.patch("/notifications/:id", async (req, res): Promise<void> => {
  const user = await currentUser(req);
  if (!user) { res.status(401).json({ error: "Необхідно увійти" }); return; }
  const parsed = z.object({ read: z.literal(true) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Некоректна дія зі сповіщенням" }); return; }
  const [notification] = await db.update(notificationsTable)
    .set({ readAt: new Date() })
    .where(and(eq(notificationsTable.id, idFrom(req)), eq(notificationsTable.userId, user.id), isNull(notificationsTable.readAt)))
    .returning();
  const existing = notification ?? (await db.select().from(notificationsTable)
    .where(and(eq(notificationsTable.id, idFrom(req)), eq(notificationsTable.userId, user.id))).limit(1))[0];
  if (!existing) { res.status(404).json({ error: "Сповіщення не знайдено" }); return; }
  const [plant] = existing.plantId ? await db.select({ name: plantsTable.name }).from(plantsTable).where(and(eq(plantsTable.id, existing.plantId), eq(plantsTable.userId, user.id))).limit(1) : [];
  res.json({
    id: existing.id, type: existing.type, title: existing.title, message: existing.message,
    createdAt: existing.createdAt.toISOString(), readAt: existing.readAt?.toISOString() ?? null,
    staleAt: existing.staleAt?.toISOString() ?? null, isRead: existing.readAt !== null || existing.staleAt !== null,
    href: existing.staleAt ? null : existing.href, plantId: existing.plantId, plantName: plant?.name ?? null,
    taskId: existing.taskId, reminderId: existing.reminderId, recommendationId: existing.recommendationId,
    actionLabel: existing.staleAt ? null : ["WEATHER_WARNING", "WEATHER_RESCHEDULE"].includes(existing.type) ? "Переглянути рекомендацію" : "Відкрити календар",
  });
});

router.post("/notifications/read-all", async (req, res): Promise<void> => {
  const user = await currentUser(req);
  if (!user) { res.status(401).json({ error: "Необхідно увійти" }); return; }
  const updated = await db.update(notificationsTable).set({ readAt: new Date() })
    .where(and(eq(notificationsTable.userId, user.id), isNull(notificationsTable.readAt), isNull(notificationsTable.staleAt)))
    .returning({ id: notificationsTable.id });
  res.json({ updated: updated.length });
});

router.get("/weather", async (req, res): Promise<void> => {
  const user = await currentUser(req);
  if (!user) { res.status(401).json({ error: "Необхідно увійти" }); return; }
  const useDevScenario = requestedDevScenario(req.query.weatherScenario, res);
  if (useDevScenario === null) return;
  try {
    const location = await resolveSavedWeatherLocation(user);
    const forecast = useDevScenario ? createRainTomorrowScenario(location) : await weatherService.getForecast(location);
    if (!useDevScenario && forecast.isMock) throw new WeatherUnavailableError();
    res.json(forecast);
  } catch (error) {
    req.log.warn({ error }, "Актуальний прогноз погоди недоступний");
    res.status(503).json({ error: "Актуальні погодні дані тимчасово недоступні." });
  }
});

router.get("/recommendations", async (req, res): Promise<void> => {
  const user = await currentUser(req);
  if (!user) { res.status(401).json({ error: "Необхідно увійти" }); return; }
  const plants = await db.select({ id: plantsTable.id }).from(plantsTable).where(eq(plantsTable.userId, user.id));
  const plantIds = new Set(plants.map((item) => item.id));
  const rows = await db.select().from(recommendationsTable).orderBy(desc(recommendationsTable.generatedAt));
  const result = await Promise.all(rows.filter((row) => plantIds.has(row.plantId) && (!req.query.plantId || row.plantId === Number(req.query.plantId)) && (!req.query.priority || row.priority === req.query.priority)).map(mapRecommendation));
  res.json(result);
});

router.post("/recommendations", async (req, res): Promise<void> => {
  const useDevScenario = requestedDevScenario(req.body?.weatherScenario, res);
  if (useDevScenario === null) return;
  const { user, plant } = await getPlantForUser(req, Number(req.body?.plantId));
  if (!user || !plant) { res.status(404).json({ error: "Рослину не знайдено" }); return; }
  let prepared: Awaited<ReturnType<typeof prepareRecommendationSet>>;
  try {
    prepared = await prepareRecommendationSet(user, plant, useDevScenario);
  } catch (error) {
    if (error instanceof CareEligibilityError) {
      res.status(409).json({ error: error.message });
      return;
    }
    req.log.warn({ error, plantId: plant.id }, "Не вдалося підготувати погодну рекомендацію");
    res.status(503).json({ error: "Актуальний прогноз недоступний. Рекомендацію не створено." });
    return;
  }
  const savedRows = await db.transaction(async tx => {
    const [lockedPlant] = await tx.select().from(plantsTable).where(eq(plantsTable.id, plant.id)).for("update");
    if (!lockedPlant || prepared.snapshot !== await careSnapshot(lockedPlant, await effectiveCare(lockedPlant, tx), tx)) {
      return null;
    }
    const rows = [];
    for (const draft of prepared.drafts) {
      const saved = await saveRecommendationDraft(tx, lockedPlant, prepared.snapshot, prepared.tasks, draft, prepared.forecast, useDevScenario);
      rows.push(saved);
      if (!useDevScenario && !prepared.forecast.isMock) {
        const notification = weatherNotificationWrite(user.id, saved);
        if (notification) await writeNotification(tx, notification);
      }
    }
    await supersedeMissingTaskRecommendations(tx, plant.id, prepared.tasks, prepared.drafts);
    return rows;
  });
  if (!savedRows) { res.status(409).json({ error: "Умови або завдання змінилися під час перевірки. Спробуйте ще раз." }); return; }
  res.status(201).json({
    recommendations: await Promise.all(savedRows.map(mapRecommendation)),
    weather: prepared.forecast,
    warning: prepared.forecast.isMock ? "Демонстраційні погодні дані" : null,
  });
});

router.post("/recommendations/:id/refresh", async (req, res): Promise<void> => {
  const useDevScenario = requestedDevScenario(req.body?.weatherScenario, res);
  if (useDevScenario === null) return;
  const [rec] = await db.select().from(recommendationsTable).where(eq(recommendationsTable.id, idFrom(req)));
  const { user, plant } = await getPlantForUser(req, rec?.plantId ?? -1);
  if (!rec || !plant || !user) { res.status(404).json({ error: "Рекомендацію не знайдено" }); return; }
  if (!["WEATHER_RESCHEDULE", "WEATHER_WARNING"].includes(rec.type) || rec.relatedTaskId === null) {
    res.status(400).json({ error: "Оновлювати можна лише погодну рекомендацію для завдання." });
    return;
  }
  if (rec.applied || rec.supersededAt) {
    res.status(409).json({ error: rec.applied ? "Рекомендацію вже застосовано." : "Цю рекомендацію вже оновлено." });
    return;
  }
  const [task] = await db.select().from(tasksTable)
    .where(and(eq(tasksTable.id, rec.relatedTaskId), eq(tasksTable.plantId, plant.id)));
  if (!task) { res.status(409).json({ error: "Пов’язане завдання більше не існує. Оновити рекомендацію неможливо." }); return; }
  if (task.status === "COMPLETED") { res.status(409).json({ error: "Завдання вже виконано; рекомендацію оновити неможливо." }); return; }
  if (task.status === "CANCELLED") { res.status(409).json({ error: "Завдання скасовано; рекомендацію оновити неможливо." }); return; }
  if (!["PLANNED", "POSTPONED"].includes(task.status)) {
    res.status(409).json({ error: "Статус завдання змінився. Оновити рекомендацію неможливо." }); return;
  }
  if (rec.careType !== null && task.type !== rec.careType) {
    res.status(409).json({ error: "Тип догляду в завданні змінився. Ця рекомендація більше не застосовна." }); return;
  }
  const currentCare = await effectiveCare(plant);
  if (eligibilityError(currentCare, task.type)) {
    res.status(409).json({ error: "Застосовність цього виду догляду змінилася." }); return;
  }
  if (!isWeatherRelevant(await plantEnvironment(plant))) {
    res.status(409).json({ error: "Зовнішній прогноз не застосовується до догляду в приміщенні чи теплиці." }); return;
  }

  let prepared: Awaited<ReturnType<typeof prepareRecommendationSet>>;
  try {
    prepared = await prepareRecommendationSet(user, plant, useDevScenario);
  } catch (error) {
    if (error instanceof CareEligibilityError) {
      res.status(409).json({ error: error.message });
      return;
    }
    req.log.warn({ error, plantId: plant.id }, "Не вдалося оновити погодну рекомендацію");
    res.status(503).json({ error: "Актуальний прогноз недоступний. Стару рекомендацію не змінено." });
    return;
  }
  const taskForecast = prepared.forecast.forecast.find(day => day.date === (task.scheduledDate < today() ? today() : task.scheduledDate));
  const replacementDraft = taskForecast
    ? prepared.drafts.find(draft => draft.relatedTaskId === task.id && draft.type === "WEATHER_RESCHEDULE")
      ?? prepared.drafts.find(draft => draft.relatedTaskId === task.id)
    : undefined;
  const warning = !taskForecast
    ? "Дата завдання не входить до доступного прогнозу. Рекомендацію про перенесення не створено."
    : replacementDraft
      ? null
      : "Актуальний прогноз не підтверджує потребу в перенесенні. Нову пораду не створено.";

  const result = await db.transaction(async tx => {
    const [lockedPlant] = await tx.select().from(plantsTable).where(eq(plantsTable.id, plant.id)).for("update");
    const [lockedRec] = await tx.select().from(recommendationsTable).where(eq(recommendationsTable.id, rec.id)).for("update");
    const [lockedTask] = await tx.select().from(tasksTable)
      .where(and(eq(tasksTable.id, task.id), eq(tasksTable.plantId, plant.id))).for("update");
    if (!lockedPlant || !lockedRec || !lockedTask || lockedRec.applied || lockedRec.supersededAt ||
      !["PLANNED", "POSTPONED"].includes(lockedTask.status) ||
      (lockedRec.careType !== null && lockedTask.type !== lockedRec.careType)) {
      return { conflict: "Рекомендація або завдання змінилися. Оновіть список і спробуйте ще раз." };
    }
    const lockedCare = await effectiveCare(lockedPlant, tx);
    if (eligibilityError(lockedCare, lockedTask.type)) {
      return { conflict: "Застосовність цього виду догляду змінилася." };
    }
    if (prepared.snapshot !== await careSnapshot(lockedPlant, lockedCare, tx)) {
      return { conflict: "Умови або план змінилися під час оновлення. Спробуйте ще раз." };
    }
    const refreshed = replacementDraft
      ? await saveRecommendationDraft(tx, lockedPlant, prepared.snapshot, prepared.tasks, replacementDraft, prepared.forecast, useDevScenario, lockedRec.id)
      : null;
    if (refreshed && !useDevScenario && !prepared.forecast.isMock) {
      const notification = weatherNotificationWrite(user.id, refreshed);
      if (notification) await writeNotification(tx, notification);
    }
    await tx.update(recommendationsTable).set({ supersededAt: new Date() })
      .where(eq(recommendationsTable.id, lockedRec.id));
    return { recommendation: refreshed };
  });
  if ("conflict" in result) { res.status(409).json({ error: result.conflict }); return; }
  res.json({
    recommendations: result.recommendation ? [await mapRecommendation(result.recommendation)] : [],
    weather: prepared.forecast,
    warning,
  });
});

router.post("/recommendations/:id/apply", async (req, res): Promise<void> => {
  const [rec] = await db.select().from(recommendationsTable).where(eq(recommendationsTable.id, idFrom(req)));
  const { user, plant } = await getPlantForUser(req, rec?.plantId ?? -1);
  if (!rec || !plant || !user || !rec.suggestedDate || !rec.relatedTaskId) { res.status(400).json({ error: "Для цієї рекомендації немає зміни дати" }); return; }
  if (rec.type !== "WEATHER_RESCHEDULE") { res.status(400).json({ error: "Перенести завдання можна лише за погодною рекомендацією." }); return; }
  if (rec.applied || rec.supersededAt) {
    res.status(409).json({ error: rec.applied ? "Рекомендацію вже застосовано." : "Цю рекомендацію оновлено. Застосуйте актуальну пораду." });
    return;
  }
  if (rec.generatedAt.getTime() < Date.now() - MAX_WEATHER_RECOMMENDATION_AGE_MS) {
    res.status(409).json({ error: "Погодні дані застаріли. Оновіть рекомендацію перед перенесенням." });
    return;
  }
  const [validationPlant] = await db.select().from(plantsTable).where(eq(plantsTable.id, plant.id));
  const [validationTask] = await db.select().from(tasksTable)
    .where(and(eq(tasksTable.id, rec.relatedTaskId), eq(tasksTable.plantId, plant.id)));
  if (!validationPlant || !validationTask || !["PLANNED", "POSTPONED"].includes(validationTask.status)) {
    res.status(409).json({ error: "Завдання більше не можна перенести. Оновіть рекомендацію." });
    return;
  }
  const validationCare = await effectiveCare(validationPlant);
  if (validationTask.type !== rec.careType || eligibilityError(validationCare, validationTask.type) ||
    validationTask.scheduledDate !== rec.originalDate ||
    rec.eligibilityVersion !== await careSnapshot(validationPlant, validationCare)) {
    res.status(409).json({ error: "Умови, завдання або застосовність змінилися. Оновіть рекомендацію." });
    return;
  }
  if (!isWeatherExposed(await plantEnvironment(validationPlant))) {
    res.status(409).json({ error: "Зовнішній прогноз не застосовується до догляду в приміщенні чи теплиці." });
    return;
  }
  const taskId = rec.relatedTaskId;
  const suggestedDate = rec.suggestedDate;
  const storedWeather = parseStoredRecommendationWeather(rec.weatherJson);
  const useDevScenario = process.env.NODE_ENV === "development" && storedWeather.scenario === DEV_WEATHER_SCENARIO;
  const scenarioStart = storedWeather.scenarioStart && /^\d{4}-\d{2}-\d{2}$/.test(storedWeather.scenarioStart)
    ? storedWeather.scenarioStart
    : undefined;
  let forecast: Awaited<ReturnType<typeof weatherService.getForecast>>;
  try {
    const location = await resolveSavedWeatherLocation(user, plant);
    forecast = useDevScenario
      ? createRainTomorrowScenario(location, scenarioStart)
      : await weatherService.getForecast(location);
    if (!useDevScenario && forecast.isMock) throw new WeatherUnavailableError();
  } catch (error) {
    req.log.warn({ error, plantId: plant.id }, "Не вдалося перевірити погодну рекомендацію");
    res.status(503).json({ error: "Актуальний прогноз недоступний. Завдання не змінено." });
    return;
  }
  let task: CareTask | null;
  try {
    task = await db.transaction(async tx => {
    const [currentPlant] = await tx.select().from(plantsTable).where(eq(plantsTable.id, plant.id)).for("share");
    const [currentRec] = await tx.select().from(recommendationsTable).where(eq(recommendationsTable.id, rec.id)).for("update");
    const [current] = await tx.select().from(tasksTable).where(and(eq(tasksTable.id, taskId), eq(tasksTable.plantId, plant.id))).for("update");
    if (!currentPlant || !currentRec || !current) return null;
    const species = await effectiveCare(currentPlant, tx);
    if (currentRec.applied || currentRec.supersededAt || !["PLANNED", "POSTPONED"].includes(current.status) ||
      current.scheduledDate !== currentRec.originalDate || suggestedDate < today() || suggestedDate === current.scheduledDate) return null;
    if (currentRec.eligibilityVersion !== await careSnapshot(currentPlant, species, tx) ||
      (currentRec.careType !== null && current.type !== currentRec.careType) || eligibilityError(species, current.type)) {
      throw new RecommendationConflictError("Умови, план або застосовність змінилися. Оновіть рекомендацію.");
    }
    const rules = species.id === null ? [] : await tx.select().from(speciesCareRulesTable).where(eq(speciesCareRulesTable.speciesId, species.id));
    const environment = await plantEnvironment(currentPlant);
    const suggestedWeather = forecast.forecast.find(day => day.date === suggestedDate);
    const currentDraft = generateRules(species, [current], forecast.forecast, forecast.location, environment, null, rules)
      .find(draft => draft.type === "WEATHER_RESCHEDULE" && draft.relatedTaskId === current.id &&
        draft.originalDate === current.scheduledDate && draft.suggestedDate === suggestedDate);
    if (!currentDraft) {
      throw new RecommendationConflictError("Поточний прогноз більше не підтверджує саме цю зміну дати. Оновіть рекомендацію.");
    }
    if (!suggestedWeather || !isWeatherSuitable(current.type, species, suggestedWeather, environment, rules, current.notes ?? "")) {
      throw new RecommendationConflictError("Запропонована дата більше не відповідає погодним правилам. Оновіть рекомендацію.");
    }
    const postponing = suggestedDate > current.scheduledDate;
    const [updated] = await tx.update(tasksTable).set({
      scheduledDate: suggestedDate,
      status: postponing ? "POSTPONED" : current.status,
      postponementCount: current.postponementCount + (postponing ? 1 : 0),
    }).where(eq(tasksTable.id, taskId)).returning();
    await tx.update(remindersTable).set({ reminderDate: suggestedDate, status: "PENDING" }).where(eq(remindersTable.taskId, taskId));
    await tx.update(recommendationsTable).set({ applied: 1, appliedAt: new Date() }).where(eq(recommendationsTable.id, currentRec.id));
    const [reminder] = await tx.select().from(remindersTable).where(eq(remindersTable.taskId, taskId)).limit(1);
    const careName = careLabels[current.type] ?? "Догляд";
    const dateChange = suggestedDate < current.scheduledDate ? "заплановано раніше" : "перенесено";
    await writeNotification(tx, {
      userId: user.id,
      type: "WEATHER_RESCHEDULED",
      title: "Погоджену зміну дати збережено",
      message: `${careName} рослини «${currentPlant.name}» ${dateChange} з ${notificationDateLabel(current.scheduledDate)} на ${notificationDateLabel(suggestedDate)}.`,
      dedupeKey: `weather-rescheduled:${currentRec.id}`,
      href: `/calendar?taskId=${taskId}`,
      plantId: currentPlant.id,
      taskId,
      reminderId: reminder?.id ?? null,
      recommendationId: currentRec.id,
    });
    return updated;
    });
  } catch (error) {
    if (error instanceof RecommendationConflictError) { res.status(409).json({ error: error.message }); return; }
    if (error instanceof CareEligibilityError) { res.status(409).json({ error: error.message }); return; }
    throw error;
  }
  if (!task) { res.status(409).json({ error: "Рекомендація вже застосована або завдання змінилося. Створіть нову пораду" }); return; }
  res.json(await mapTask(task));
});

router.get("/history", async (req, res): Promise<void> => {
  const user = await currentUser(req);
  if (!user) { res.status(401).json({ error: "Необхідно увійти" }); return; }
  const plants = await db.select().from(plantsTable).where(eq(plantsTable.userId, user.id));
  const plantMap = new Map(plants.map((plant) => [plant.id, plant]));
  const tasks = await db.select().from(tasksTable);
  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  const logs = await db.select().from(careLogsTable).orderBy(desc(careLogsTable.completedAt));
  res.json(logs.filter((log) => plantMap.has(taskMap.get(log.taskId)?.plantId ?? -1)).map((log) => ({ id: log.id, taskId: log.taskId, plantId: taskMap.get(log.taskId)?.plantId ?? 0, plantName: plantMap.get(taskMap.get(log.taskId)?.plantId ?? -1)?.name ?? "Рослина", type: taskMap.get(log.taskId)?.type ?? "OTHER", plannedDate: taskMap.get(log.taskId)?.scheduledDate ?? "", completedAt: log.completedAt.toISOString(), comment: log.comment })));
});

async function statisticsForUser(req: Request) {
  const user = await currentUser(req);
  if (!user) return null;
  const plants = await db.select({ id: plantsTable.id }).from(plantsTable).where(eq(plantsTable.userId, user.id));
  const plantIds = new Set(plants.map((item) => item.id));
  const tasks = (await db.select().from(tasksTable)).filter((task) => plantIds.has(task.plantId));
  const countedTasks = tasks.filter((task) => task.status !== "CANCELLED");
  const byType = new Map<string, number>();
  const byPlant = new Map<number, number>();
  const overTime = new Map<string, number>();
  countedTasks.forEach((task) => { byType.set(task.type, (byType.get(task.type) ?? 0) + 1); byPlant.set(task.plantId, (byPlant.get(task.plantId) ?? 0) + 1); overTime.set(task.scheduledDate, (overTime.get(task.scheduledDate) ?? 0) + 1); });
  const completed = countedTasks.filter((task) => task.status === "COMPLETED").length;
  return { tasks, countedTasks, completed, overdue: tasks.filter((task) => ["PLANNED", "POSTPONED"].includes(task.status) && task.scheduledDate < today()).length, postponed: countedTasks.filter((task) => task.status === "POSTPONED").length, cancelled: tasks.filter((task) => task.status === "CANCELLED").length, byType: [...byType].map(([label, value]) => ({ label, value })), byPlant: await Promise.all([...byPlant].map(async ([plantId, value]) => { const [plant] = await db.select().from(plantsTable).where(eq(plantsTable.id, plantId)); return { label: plant?.name ?? "Рослина", value }; })), overTime: [...overTime].sort(([a], [b]) => a.localeCompare(b)).map(([label, value]) => ({ label, value })) };
}

router.get("/statistics", async (req, res): Promise<void> => {
  const stats = await statisticsForUser(req);
  if (!stats) { res.status(401).json({ error: "Необхідно увійти" }); return; }
  res.json({ totalPlanned: stats.countedTasks.length, completed: stats.completed, overdue: stats.overdue, postponed: stats.postponed, cancelled: stats.cancelled, completionRate: stats.countedTasks.length ? Math.round((stats.completed / stats.countedTasks.length) * 100) : 0, byType: stats.byType, byPlant: stats.byPlant, overTime: stats.overTime });
});

async function reportRecordsForUser(userId: number) {
  const plants = await db.select().from(plantsTable).where(eq(plantsTable.userId, userId));
  const plantIds = plants.map(plant => plant.id);
  const tasks = plantIds.length
    ? await db.select().from(tasksTable).where(inArray(tasksTable.plantId, plantIds))
    : [];
  const recommendations = plantIds.length
    ? await db.select().from(recommendationsTable).where(inArray(recommendationsTable.plantId, plantIds))
    : [];
  return { plants, tasks, recommendations };
}

router.get("/reports", async (req, res): Promise<void> => {
  const user = await currentUser(req);
  if (!user) { res.status(401).json({ error: "Необхідно увійти" }); return; }
  const [savedReports, records] = await Promise.all([
    db.select().from(reportsTable).where(eq(reportsTable.userId, user.id)).orderBy(desc(reportsTable.createdAt)),
    reportRecordsForUser(user.id),
  ]);
  const reports = savedReports.map(saved => {
    const calculation = saved.reportDetails
      ? null
      : calculateCareReport({
          ...records,
          periodStart: saved.periodStart,
          periodEnd: saved.periodEnd,
          createdAt: saved.createdAt,
        });
    const reportDetails = saved.reportDetails ?? calculation!.reportDetails;
    const metrics = calculation?.metrics ?? {
      taskCount: saved.taskCount,
      completed: saved.completed,
      overdue: saved.overdue,
      postponed: saved.postponed,
      cancelled: reportDetails.cancelled,
      completionRate: Number(saved.completionRate),
      frequentCategory: saved.frequentCategory,
      mostActivePlant: saved.mostActivePlant,
      recommendationSummary: saved.recommendationSummary,
    };
    return { ...saved, ...metrics, reportDetails, createdAt: saved.createdAt.toISOString() };
  });
  res.json(ListReportsResponse.parse(reports));
});

router.post("/reports", async (req, res): Promise<void> => {
  const periodStart = dates.safeParse(req.body?.periodStart);
  const periodEnd = dates.safeParse(req.body?.periodEnd);
  const user = await currentUser(req);
  if (!user || !periodStart.success || !periodEnd.success || periodStart.data > periodEnd.data) { res.status(400).json({ error: "Некоректний період звіту" }); return; }
  const records = await reportRecordsForUser(user.id);
  const createdAt = new Date();
  const { reportDetails, metrics } = calculateCareReport({
    ...records,
    periodStart: periodStart.data,
    periodEnd: periodEnd.data,
    createdAt,
  });
  const [report] = await db.insert(reportsTable).values({
    userId: user.id,
    periodStart: periodStart.data,
    periodEnd: periodEnd.data,
    taskCount: metrics.taskCount,
    completed: metrics.completed,
    overdue: metrics.overdue,
    postponed: metrics.postponed,
    completionRate: String(metrics.completionRate),
    frequentCategory: metrics.frequentCategory,
    mostActivePlant: metrics.mostActivePlant,
    recommendationSummary: metrics.recommendationSummary,
    reportDetails,
    createdAt,
  }).onConflictDoUpdate({
    target: [reportsTable.userId, reportsTable.periodStart, reportsTable.periodEnd],
    set: {
      taskCount: metrics.taskCount,
      completed: metrics.completed,
      overdue: metrics.overdue,
      postponed: metrics.postponed,
      completionRate: String(metrics.completionRate),
      frequentCategory: metrics.frequentCategory,
      mostActivePlant: metrics.mostActivePlant,
      recommendationSummary: metrics.recommendationSummary,
      reportDetails,
      createdAt,
    },
  }).returning();
  res.status(201).json(CreateReportResponse.parse({
    ...report,
    cancelled: metrics.cancelled,
    completionRate: metrics.completionRate,
    createdAt: report.createdAt.toISOString(),
  }));
});

router.get("/dashboard", async (req, res): Promise<void> => {
  const user = await currentUser(req);
  if (!user) { res.status(401).json({ error: "Необхідно увійти" }); return; }
  const useDevScenario = requestedDevScenario(req.query.weatherScenario, res);
  if (useDevScenario === null) return;
  const plants = await db.select().from(plantsTable).where(eq(plantsTable.userId, user.id));
  const plantIds = new Set(plants.map((plant) => plant.id));
  const tasks = (await db.select().from(tasksTable)).filter((task) => plantIds.has(task.plantId));
  const activeTasks = tasks.filter(task => ["PLANNED", "POSTPONED"].includes(task.status));
  const mappedActiveTasks = await mapTasks(activeTasks.sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate)), plants);
  const mappedTasks = mappedActiveTasks.slice(0, 8);
  const recommendationRows = (await db.select().from(recommendationsTable).orderBy(desc(recommendationsTable.generatedAt)))
    .filter((item) => plantIds.has(item.plantId));
  const mappedRecommendations = await Promise.all(recommendationRows.map(mapRecommendation));
  const currentRecommendations = mappedRecommendations.filter((item) => !item.staleReason && !item.applied && !item.supersededAt);
  const weatherProtectedTaskIds = new Set(currentRecommendations
    .filter((item) => ["WEATHER_RESCHEDULE", "WEATHER_WARNING"].includes(item.type) && item.relatedTaskId !== null)
    .map((item) => item.relatedTaskId as number));
  const dashboardRecommendations = currentRecommendations
    .filter((item) => ["WEATHER_RESCHEDULE", "WEATHER_WARNING"].includes(item.type) || item.relatedTaskId === null || !weatherProtectedTaskIds.has(item.relatedTaskId))
    .slice(0, 3);
  const reminders = await db.select().from(remindersTable).where(eq(remindersTable.status, "PENDING"));
  let weather: Awaited<ReturnType<typeof weatherService.getForecast>> | null = null;
  try {
    const location = await resolveSavedWeatherLocation(user);
    const forecast = useDevScenario ? createRainTomorrowScenario(location) : await weatherService.getForecast(location);
    if (useDevScenario || !forecast.isMock) weather = forecast;
    else req.log.warn({ location: location.name }, "Демонстраційний прогноз проігноровано для звичайного запиту");
  } catch (error) {
    req.log.warn({ error, userId: user.id }, "Актуальний прогноз погоди тимчасово недоступний");
  }
  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  res.json({ plantsCount: plants.length, todayTasks: activeTasks.filter((task) => task.scheduledDate === today()).length, overdueTasks: activeTasks.filter((task) => task.scheduledDate < today()).length, completedTasks: tasks.filter((task) => task.status === "COMPLETED").length, highPriorityTasks: mappedActiveTasks.filter((task) => ["HIGH", "URGENT"].includes(task.priority)).length, weather, upcomingTasks: mappedTasks, latestRecommendations: dashboardRecommendations, reminders: reminders.filter((item) => plantIds.has(taskMap.get(item.taskId)?.plantId ?? -1) && ["PLANNED", "POSTPONED"].includes(taskMap.get(item.taskId)?.status ?? "")).slice(0, 5).map((item) => ({ id: item.id, taskId: item.taskId, plantName: plants.find((plant) => plant.id === taskMap.get(item.taskId)?.plantId)?.name ?? "Рослина", taskType: taskMap.get(item.taskId)?.type ?? "OTHER", reminderDate: item.reminderDate, status: item.status, message: `Нагадування на ${item.reminderDate}` })) });
});

router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (error instanceof CareEligibilityError) { res.status(400).json({ error: error.message }); return; }
  if (error instanceof RecommendationConflictError) { res.status(409).json({ error: error.message }); return; }
  next(error);
});

export default router;