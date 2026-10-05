import { Router, type IRouter, type Request } from "express";
import { and, desc, eq, gte, lte, inArray, or } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { z } from "zod/v4";
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
  knowledgeSourcesTable,
  type PlantSpecies,
  type CareTask,
} from "@workspace/db";
import { weatherService } from "../lib/weather";
import { generateRules } from "../lib/recommendation-engine";
import { resolveSavedWeatherLocation, plantEnvironment } from "../lib/weather-location";
import { canAttachPhoto } from "../lib/plant-photos";

const router: IRouter = Router();
const today = () => new Date().toISOString().slice(0, 10);
const careLabels: Record<string, string> = { WATERING: "Полив", FERTILIZING: "Підживлення", PRUNING: "Обрізка", TRANSPLANTING: "Пересадка", TREATMENT: "Обробка", HARVEST: "Збір урожаю", OTHER: "Інший догляд" };
const idFrom = (req: Request) => Number(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
const stringParam = (value: unknown) => typeof value === "string" ? value : undefined;
const dates = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const taskInput = z.object({
  plantId: z.coerce.number().int().positive(),
  type: z.string().min(1),
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
  name: z.string().trim().min(1, "Назва рослини обов'язкова"),
  speciesId: z.coerce.number().int().positive(),
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
const speciesInput = z.object({
  name: z.string().trim().min(1),
  description: z.string(),
  careRecommendations: z.string(),
  optimalTempMin: z.coerce.number(),
  optimalTempMax: z.coerce.number(),
  optimalHumidity: z.coerce.number().min(0).max(100),
  wateringFrequencyDays: z.coerce.number().int().positive(),
  lightRequirements: z.string(),
  soilRecommendations: z.string(),
  wateringRecommendations: z.string(),
  fertilizingRecommendations: z.string(),
  pruningRecommendations: z.string(),
  transplantingRecommendations: z.string(),
  imageUrl: z.string().url().or(z.literal("")),
  scientificName: z.string().trim().nullable().optional(),
  category: z.string().trim().nullable().optional(),
  suitableEnvironmentTypes: z.array(z.enum(environmentTypes)).nullable().optional(),
  humidityMin: z.number().int().min(0).max(100).nullable().optional(),
  humidityMax: z.number().int().min(0).max(100).nullable().optional(),
  fertilizingFrequencyDays: z.number().int().positive().nullable().optional(),
  pruningSeason: z.string().nullable().optional(),
  transplantingFrequencyMonths: z.number().int().positive().nullable().optional(),
  harvestingRecommendations: z.string().nullable().optional(),
  generalCareRecommendations: z.string().nullable().optional(),
});

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
    optimalTempMin: Number(species.optimalTempMin),
    optimalTempMax: Number(species.optimalTempMax),
  };
}

async function mapPlant(plant: typeof plantsTable.$inferSelect) {
  const [species] = await db.select().from(speciesTable).where(eq(speciesTable.id, plant.speciesId));
  const tasks = await db.select().from(tasksTable).where(and(eq(tasksTable.plantId, plant.id), inArray(tasksTable.status, ["PLANNED", "POSTPONED"]))).orderBy(tasksTable.scheduledDate);
  const [place] = plant.placeId ? await db.select().from(plantPlacesTable).where(and(eq(plantPlacesTable.id, plant.placeId), eq(plantPlacesTable.userId, plant.userId))) : [];
  const [location] = plant.weatherLocationId ? await db.select().from(savedLocationsTable).where(and(eq(savedLocationsTable.id, plant.weatherLocationId), eq(savedLocationsTable.userId, plant.userId))) : [];
  const next = tasks[0];
  return {
    ...plant,
    photoUrl: plant.photoObjectPath ? `/api/storage${plant.photoObjectPath}` : plant.photoUrl,
    location: place?.name ?? plant.location,
    environmentType: place?.environmentType ?? plant.environmentType,
    weatherLocationName: location?.displayName ?? plant.weatherLocationName,
    weatherLatitude: location ? Number(location.latitude) : plant.weatherLatitude === null ? null : Number(plant.weatherLatitude),
    weatherLongitude: location ? Number(location.longitude) : plant.weatherLongitude === null ? null : Number(plant.weatherLongitude),
    speciesName: species?.name ?? "Невідомий вид",
    nextTask: next?.scheduledDate ?? null,
    nextTaskType: next?.type ?? null,
    careStatus: next?.scheduledDate && next.scheduledDate < today() ? "OVERDUE" : next ? "PLANNED" : "NO_PLAN",
    hasHighPriorityTasks: tasks.some(task => ["HIGH", "URGENT"].includes(task.priority)),
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

async function mapTask(task: CareTask) {
  const [plant] = await db.select().from(plantsTable).where(eq(plantsTable.id, task.plantId));
  return {
    ...task,
    plantName: plant?.name ?? "Рослина",
    isOverdue: ["PLANNED", "POSTPONED"].includes(task.status) && task.scheduledDate < today(),
  };
}

async function mapRecommendation(rec: typeof recommendationsTable.$inferSelect) {
  const [plant] = await db.select().from(plantsTable).where(eq(plantsTable.id, rec.plantId));
  return {
    ...rec,
    plantName: plant?.name ?? "Рослина",
    applied: Boolean(rec.applied),
    weather: JSON.parse(rec.weatherJson || "{}"),
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
  const search = stringParam(req.query.search)?.toLowerCase();
  const rows = await db.select().from(speciesTable).orderBy(speciesTable.name);
  const result = await Promise.all(rows.filter((item) => !search || item.name.toLowerCase().includes(search)).map(mapSpecies));
  res.json(result);
});

router.post("/species", async (req, res): Promise<void> => {
  const parsed = speciesInput.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Перевірте параметри виду рослини" }); return; }
  const user = await currentUser(req);
  if (!user || user.role !== "ADMIN") { res.status(403).json({ error: "Недостатньо прав" }); return; }
  if (parsed.data.optimalTempMin > parsed.data.optimalTempMax || parsed.data.humidityMin != null && parsed.data.humidityMax != null && parsed.data.humidityMin > parsed.data.humidityMax) { res.status(400).json({ error: "Мінімальне значення не може перевищувати максимальне" }); return; }
  const [created] = await db.insert(speciesTable).values({ ...parsed.data, optimalTempMin: String(parsed.data.optimalTempMin), optimalTempMax: String(parsed.data.optimalTempMax) }).returning();
  res.status(201).json(await mapSpecies(created));
});

router.patch("/species/:id", async (req, res): Promise<void> => {
  const user = await currentUser(req);
  if (!user || user.role !== "ADMIN") { res.status(403).json({ error: "Недостатньо прав" }); return; }
  const parsed = speciesInput.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Некоректні дані виду" }); return; }
  const [existing] = await db.select().from(speciesTable).where(eq(speciesTable.id, idFrom(req)));
  if (!existing) { res.status(404).json({ error: "Вид не знайдено" }); return; }
  const merged = { ...existing, ...parsed.data };
  if (Number(merged.optimalTempMin) > Number(merged.optimalTempMax) || merged.humidityMin != null && merged.humidityMax != null && merged.humidityMin > merged.humidityMax) { res.status(400).json({ error: "Мінімальне значення не може перевищувати максимальне" }); return; }
  const values = { ...parsed.data, ...(parsed.data.optimalTempMin === undefined ? {} : { optimalTempMin: String(parsed.data.optimalTempMin) }), ...(parsed.data.optimalTempMax === undefined ? {} : { optimalTempMax: String(parsed.data.optimalTempMax) }) } as Partial<typeof speciesTable.$inferInsert>;
  const [updated] = await db.update(speciesTable).set(values).where(eq(speciesTable.id, idFrom(req))).returning();
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
  if (data.speciesId !== undefined) {
    const [species] = await db.select().from(speciesTable).where(eq(speciesTable.id, data.speciesId));
    if (!species) throw new Error("Оберіть вид із довідника");
  }
  return values;
}

const knowledgeInput = z.object({
  careRules: z.array(z.object({
    careType: z.enum(["WATERING", "FERTILIZING", "PRUNING", "TRANSPLANTING", "TREATMENT", "HARVEST"]),
    rainThresholdMm: z.number().min(0).nullable(),
    maxWindSpeedMps: z.number().min(0).nullable(),
    minTemperature: z.number().nullable(),
    maxTemperature: z.number().nullable(),
    notes: z.string().nullable(),
  }).refine(rule => rule.minTemperature === null || rule.maxTemperature === null || rule.minTemperature <= rule.maxTemperature)).max(6),
  sources: z.array(z.object({
    sourceName: z.string().trim().min(1), sourceUrl: z.string().url().refine(url => /^https?:\/\//.test(url)).nullable(),
    retrievedAt: z.union([z.iso.datetime({ offset: true }), dates.refine(date => !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date)]).nullable(), notes: z.string().nullable(),
  })).max(20),
}).refine(value => new Set(value.careRules.map(rule => rule.careType)).size === value.careRules.length);

async function speciesKnowledge(speciesId: number) {
  const rules = await db.select().from(speciesCareRulesTable).where(eq(speciesCareRulesTable.speciesId, speciesId)).orderBy(speciesCareRulesTable.careType);
  const sources = await db.select().from(knowledgeSourcesTable).where(eq(knowledgeSourcesTable.speciesId, speciesId)).orderBy(knowledgeSourcesTable.id);
  return {
    careRules: rules.map(rule => ({ ...rule, rainThresholdMm: rule.rainThresholdMm === null ? null : Number(rule.rainThresholdMm), maxWindSpeedMps: rule.maxWindSpeedMps === null ? null : Number(rule.maxWindSpeedMps), minTemperature: rule.minTemperature === null ? null : Number(rule.minTemperature), maxTemperature: rule.maxTemperature === null ? null : Number(rule.maxTemperature) })),
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
    await tx.delete(speciesCareRulesTable).where(eq(speciesCareRulesTable.speciesId, species.id));
    if (parsed.data.careRules.length) await tx.insert(speciesCareRulesTable).values(parsed.data.careRules.map(rule => ({ ...rule, speciesId: species.id, rainThresholdMm: dbCoordinate(rule.rainThresholdMm), maxWindSpeedMps: dbCoordinate(rule.maxWindSpeedMps), minTemperature: dbCoordinate(rule.minTemperature), maxTemperature: dbCoordinate(rule.maxTemperature) })));
    await tx.delete(knowledgeSourcesTable).where(eq(knowledgeSourcesTable.speciesId, species.id));
    if (parsed.data.sources.length) await tx.insert(knowledgeSourcesTable).values(parsed.data.sources.map(source => ({ ...source, speciesId: species.id, retrievedAt: source.retrievedAt ? new Date(source.retrievedAt) : null })));
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
    const matchesSearch = !search || plant.name.toLowerCase().includes(search) || plant.speciesName.toLowerCase().includes(search) || plant.location.toLowerCase().includes(search);
    const matchesLocation = !location || plant.location.toLowerCase().includes(location);
    const matchesSpecies = !Number.isFinite(speciesId) || plant.speciesId === speciesId;
    const matchesOverdue = req.query.overdue !== "true" || plant.careStatus === "OVERDUE";
    const matchesPriority = req.query.highPriority !== "true" || plant.hasHighPriorityTasks;
    return matchesSearch && matchesLocation && matchesSpecies && matchesOverdue && matchesPriority;
  }));
});

router.post("/plants", async (req, res): Promise<void> => {
  const user = await currentUser(req);
  const parsed = plantInput.safeParse(req.body);
  if (!user) { res.status(401).json({ error: "Необхідно увійти" }); return; }
  if (!parsed.success || !hasValidWeatherOverride(parsed.data)) { res.status(400).json({ error: "Перевірте назву, вид, фізичне місце та погодну локацію рослини" }); return; }
  if (!await canAttachPhoto(parsed.data.photoObjectPath, getAuth(req).userId)) { res.status(400).json({ error: "Фото не завантажене або належить іншому користувачу." }); return; }
  let locations: Partial<typeof plantsTable.$inferInsert>;
  try { locations = await validatedPlantLocation(user.id, parsed.data); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Некоректна локація" }); return; }
  const [created] = await db.insert(plantsTable).values({
    ...parsed.data,
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
  const [species] = await db.select().from(speciesTable).where(eq(speciesTable.id, plant.speciesId));
  const tasks = await db.select().from(tasksTable).where(eq(tasksTable.plantId, plant.id)).orderBy(desc(tasksTable.scheduledDate));
  const recommendations = await db.select().from(recommendationsTable).where(eq(recommendationsTable.plantId, plant.id)).orderBy(desc(recommendationsTable.generatedAt)).limit(5);
  const plantLogs = tasks.length ? await db.select().from(careLogsTable).where(inArray(careLogsTable.taskId, tasks.map(task => task.id))).orderBy(desc(careLogsTable.completedAt)) : [];
  const history = await Promise.all(plantLogs.map(async (log) => {
    const task = tasks.find((item) => item.id === log.taskId);
    return { id: log.id, taskId: log.taskId, plantId: plant.id, plantName: plant.name, type: task?.type ?? "OTHER", plannedDate: task?.scheduledDate ?? "", completedAt: log.completedAt.toISOString(), comment: log.comment };
  }));
  const mapped = await mapPlant(plant);
  res.json({ ...mapped, species: species ? await mapSpecies(species) : null, upcomingTasks: await Promise.all(tasks.filter((task) => task.status !== "COMPLETED" && task.status !== "CANCELLED").map(mapTask)), history, recommendations: await Promise.all(recommendations.map(mapRecommendation)), stats: { totalTasks: tasks.length, completedTasks: tasks.filter((task) => task.status === "COMPLETED").length, completionRate: tasks.length ? Math.round((tasks.filter((task) => task.status === "COMPLETED").length / tasks.length) * 100) : 0, lastWatered: history.find((item) => item.type === "WATERING")?.completedAt ?? null } });
});

router.patch("/plants/:id", async (req, res): Promise<void> => {
  const { plant, user } = await getPlantForUser(req, idFrom(req));
  const parsed = plantInput.partial().safeParse(req.body);
  if (!plant || !user) { res.status(404).json({ error: "Рослину не знайдено" }); return; }
  if (!parsed.success || !hasValidWeatherOverride(parsed.data)) { res.status(400).json({ error: "Некоректні дані рослини або погодної локації" }); return; }
  if (!await canAttachPhoto(parsed.data.photoObjectPath, getAuth(req).userId)) { res.status(400).json({ error: "Фото не завантажене або належить іншому користувачу." }); return; }
  const { weatherLatitude, weatherLongitude, ...plantValues } = parsed.data;
  let locations: Partial<typeof plantsTable.$inferInsert>;
  try { locations = await validatedPlantLocation(user.id, parsed.data, plant); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Некоректна локація" }); return; }
  const [updated] = await db.update(plantsTable).set({
    ...plantValues,
    ...(weatherLatitude === undefined ? {} : { weatherLatitude: dbCoordinate(weatherLatitude) }),
    ...(weatherLongitude === undefined ? {} : { weatherLongitude: dbCoordinate(weatherLongitude) }),
    ...locations,
  }).where(eq(plantsTable.id, plant.id)).returning();
  res.json(await mapPlant(updated));
});

router.get("/plants/:id/care-plan", async (req, res) => {
  const { plant } = await getPlantForUser(req, idFrom(req));
  if (!plant) { res.status(404).json({ error: "Рослину не знайдено" }); return; }
  const [species] = await db.select().from(speciesTable).where(eq(speciesTable.id, plant.speciesId));
  const firstDate = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const items = [{ type: "WATERING", scheduledDate: firstDate(species.wateringFrequencyDays), reason: `Орієнтовний інтервал для виду — ${species.wateringFrequencyDays} днів. ${species.wateringRecommendations}` }];
  if (species.fertilizingFrequencyDays) items.push({ type: "FERTILIZING", scheduledDate: firstDate(species.fertilizingFrequencyDays), reason: `Інтервал — ${species.fertilizingFrequencyDays} днів. ${species.fertilizingRecommendations}` });
  if (species.transplantingFrequencyMonths) items.push({ type: "TRANSPLANTING", scheduledDate: firstDate(species.transplantingFrequencyMonths * 30), reason: `Орієнтовний інтервал — ${species.transplantingFrequencyMonths} місяців. ${species.transplantingRecommendations}` });
  res.json(items);
});
router.post("/plants/:id/care-plan", async (req, res) => {
  const { plant } = await getPlantForUser(req, idFrom(req));
  if (!plant) { res.status(404).json({ error: "Рослину не знайдено" }); return; }
  const parsed = z.object({ items: z.array(z.object({ type: z.enum(["WATERING", "FERTILIZING", "TRANSPLANTING"]), scheduledDate: dates.refine(date => !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date), reason: z.string().max(5000) })).min(1).max(10) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Оберіть завдання та перевірте дати плану" }); return; }
  const created = await db.transaction(async tx => {
    await tx.select().from(plantsTable).where(eq(plantsTable.id, plant.id)).for("update");
    const existing = await tx.select().from(tasksTable).where(and(eq(tasksTable.plantId, plant.id), inArray(tasksTable.status, ["PLANNED", "POSTPONED"])));
    const keys = new Set(existing.map(task => `${task.type}:${task.scheduledDate}`));
    const items = parsed.data.items.filter(item => { const key = `${item.type}:${item.scheduledDate}`; if (keys.has(key)) return false; keys.add(key); return true; });
    if (!items.length) return [];
    const tasks = await tx.insert(tasksTable).values(items.map(item => ({ plantId: plant.id, type: item.type, scheduledDate: item.scheduledDate, priority: "MEDIUM", notes: item.reason }))).returning();
    await tx.insert(remindersTable).values(tasks.map(task => ({ taskId: task.id, reminderDate: task.scheduledDate, status: "PENDING" })));
    return tasks;
  });
  res.status(201).json(await Promise.all(created.map(mapTask)));
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
  const result = await Promise.all(rows.filter((task) => plantIds.has(task.plantId) && (!from || task.scheduledDate >= from) && (!to || task.scheduledDate <= to) && (!status || task.status === status) && (!Number.isFinite(plantId) || task.plantId === plantId)).map(mapTask));
  res.json(result);
});

router.post("/tasks", async (req, res): Promise<void> => {
  const parsed = taskInput.safeParse(req.body);
  const { plant } = await getPlantForUser(req, Number(req.body?.plantId));
  if (!parsed.success || !plant) { res.status(400).json({ error: "Перевірте дату, тип і рослину" }); return; }
  const [created] = await db.insert(tasksTable).values(parsed.data).returning();
  await db.insert(remindersTable).values({ taskId: created.id, reminderDate: created.scheduledDate, status: "PENDING" });
  res.status(201).json(await mapTask(created));
});

router.patch("/tasks/:id", async (req, res): Promise<void> => {
  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, idFrom(req)));
  const { plant } = await getPlantForUser(req, task?.plantId ?? -1);
  if (!task || !plant) { res.status(404).json({ error: "Завдання не знайдено" }); return; }
  const parsed = taskInput.partial().extend({ status: z.string().optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Некоректні дані завдання" }); return; }
  if (parsed.data.plantId !== undefined && !(await getPlantForUser(req, parsed.data.plantId)).plant) { res.status(400).json({ error: "Оберіть власну рослину" }); return; }
  const [updated] = await db.update(tasksTable).set(parsed.data).where(eq(tasksTable.id, task.id)).returning();
  if (parsed.data.scheduledDate) await db.update(remindersTable).set({ reminderDate: parsed.data.scheduledDate }).where(eq(remindersTable.taskId, task.id));
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

router.get("/weather", async (req, res): Promise<void> => {
  const user = await currentUser(req);
  if (!user) { res.status(401).json({ error: "Необхідно увійти" }); return; }
  res.json(await weatherService.getForecast(await resolveSavedWeatherLocation(user)));
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
  const { user, plant } = await getPlantForUser(req, Number(req.body?.plantId));
  if (!user || !plant) { res.status(404).json({ error: "Рослину не знайдено" }); return; }
  const [species] = await db.select().from(speciesTable).where(eq(speciesTable.id, plant.speciesId));
  if (!species) { res.status(400).json({ error: "Для рослини не знайдено характеристики виду" }); return; }
  const resolvedLocation = await resolveSavedWeatherLocation(user, plant);
  const forecast = await weatherService.getForecast(resolvedLocation);
  const tasks = await db.select().from(tasksTable).where(and(eq(tasksTable.plantId, plant.id), inArray(tasksTable.status, ["PLANNED", "POSTPONED"])));
  const [lastWatering] = await db.select({ completedAt: careLogsTable.completedAt }).from(careLogsTable).innerJoin(tasksTable, eq(careLogsTable.taskId, tasksTable.id)).where(and(eq(tasksTable.plantId, plant.id), eq(tasksTable.type, "WATERING"), eq(tasksTable.status, "COMPLETED"))).orderBy(desc(careLogsTable.completedAt)).limit(1);
  const rules = await db.select().from(speciesCareRulesTable).where(eq(speciesCareRulesTable.speciesId, species.id));
  const drafts = generateRules(species, tasks, forecast.forecast, resolvedLocation.name, await plantEnvironment(plant), lastWatering?.completedAt.toISOString().slice(0, 10) ?? null, rules);
  const saved = await Promise.all(drafts.map(async (draft) => {
    const [created] = await db.insert(recommendationsTable).values({ plantId: plant.id, generatedAt: new Date(), type: draft.type, text: draft.text, priority: draft.priority, relatedTaskId: draft.relatedTaskId, explanation: draft.explanation, originalDate: draft.originalDate, suggestedDate: draft.suggestedDate, weatherJson: JSON.stringify(draft.weather), applied: 0 }).returning();
    return mapRecommendation(created);
  }));
  res.status(201).json({ recommendations: await Promise.all(saved), weather: forecast, warning: forecast.isMock ? "Використано демонстраційний прогноз, а не поточні метеодані" : null });
});

router.post("/recommendations/:id/apply", async (req, res): Promise<void> => {
  const [rec] = await db.select().from(recommendationsTable).where(eq(recommendationsTable.id, idFrom(req)));
  const { plant } = await getPlantForUser(req, rec?.plantId ?? -1);
  if (!rec || !plant || !rec.suggestedDate || !rec.relatedTaskId) { res.status(400).json({ error: "Для цієї рекомендації немає зміни дати" }); return; }
  const taskId = rec.relatedTaskId;
  const suggestedDate = rec.suggestedDate;
  const task = await db.transaction(async tx => {
    const [currentRec] = await tx.select().from(recommendationsTable).where(eq(recommendationsTable.id, rec.id)).for("update");
    const [current] = await tx.select().from(tasksTable).where(and(eq(tasksTable.id, taskId), eq(tasksTable.plantId, plant.id))).for("update");
    if (currentRec.applied || !current || !["PLANNED", "POSTPONED"].includes(current.status) || current.scheduledDate !== rec.originalDate || suggestedDate < today()) return null;
    const [updated] = await tx.update(tasksTable).set({ scheduledDate: suggestedDate, status: "POSTPONED", postponementCount: current.postponementCount + 1 }).where(eq(tasksTable.id, taskId)).returning();
    await tx.update(remindersTable).set({ reminderDate: suggestedDate, status: "PENDING" }).where(eq(remindersTable.taskId, taskId));
    await tx.update(recommendationsTable).set({ applied: 1 }).where(eq(recommendationsTable.id, rec.id));
    return updated;
  });
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
  const byType = new Map<string, number>();
  const byPlant = new Map<number, number>();
  const overTime = new Map<string, number>();
  tasks.forEach((task) => { byType.set(task.type, (byType.get(task.type) ?? 0) + 1); byPlant.set(task.plantId, (byPlant.get(task.plantId) ?? 0) + 1); overTime.set(task.scheduledDate, (overTime.get(task.scheduledDate) ?? 0) + 1); });
  const completed = tasks.filter((task) => task.status === "COMPLETED").length;
  return { tasks, completed, overdue: tasks.filter((task) => ["PLANNED", "POSTPONED"].includes(task.status) && task.scheduledDate < today()).length, postponed: tasks.filter((task) => task.status === "POSTPONED").length, cancelled: tasks.filter((task) => task.status === "CANCELLED").length, byType: [...byType].map(([label, value]) => ({ label, value })), byPlant: await Promise.all([...byPlant].map(async ([plantId, value]) => { const [plant] = await db.select().from(plantsTable).where(eq(plantsTable.id, plantId)); return { label: plant?.name ?? "Рослина", value }; })), overTime: [...overTime].sort(([a], [b]) => a.localeCompare(b)).map(([label, value]) => ({ label, value })) };
}

router.get("/statistics", async (req, res): Promise<void> => {
  const stats = await statisticsForUser(req);
  if (!stats) { res.status(401).json({ error: "Необхідно увійти" }); return; }
  res.json({ totalPlanned: stats.tasks.filter((task) => task.status !== "CANCELLED").length, completed: stats.completed, overdue: stats.overdue, postponed: stats.postponed, cancelled: stats.cancelled, completionRate: stats.tasks.length ? Math.round((stats.completed / stats.tasks.filter((task) => task.status !== "CANCELLED").length) * 100) : 0, byType: stats.byType, byPlant: stats.byPlant, overTime: stats.overTime });
});

router.get("/reports", async (req, res): Promise<void> => {
  const user = await currentUser(req);
  if (!user) { res.status(401).json({ error: "Необхідно увійти" }); return; }
  res.json(await db.select().from(reportsTable).where(eq(reportsTable.userId, user.id)).orderBy(desc(reportsTable.createdAt)));
});

router.post("/reports", async (req, res): Promise<void> => {
  const periodStart = dates.safeParse(req.body?.periodStart);
  const periodEnd = dates.safeParse(req.body?.periodEnd);
  const user = await currentUser(req);
  if (!user || !periodStart.success || !periodEnd.success || periodStart.data > periodEnd.data) { res.status(400).json({ error: "Некоректний період звіту" }); return; }
  const stats = await statisticsForUser(req);
  if (!stats) { res.status(401).json({ error: "Необхідно увійти" }); return; }
  const inPeriod = stats.tasks.filter((task) => task.scheduledDate >= periodStart.data && task.scheduledDate <= periodEnd.data);
  const [report] = await db.insert(reportsTable).values({ userId: user.id, periodStart: periodStart.data, periodEnd: periodEnd.data, taskCount: inPeriod.length, completed: inPeriod.filter((task) => task.status === "COMPLETED").length, overdue: inPeriod.filter((task) => ["PLANNED", "POSTPONED"].includes(task.status) && task.scheduledDate < today()).length, postponed: inPeriod.filter((task) => task.status === "POSTPONED").length, completionRate: String(inPeriod.length ? Math.round((inPeriod.filter((task) => task.status === "COMPLETED").length / inPeriod.length) * 100) : 0), frequentCategory: "Догляд", mostActivePlant: "Ваші рослини", recommendationSummary: "Звіт сформовано на основі збережених рекомендацій і завдань." }).onConflictDoUpdate({ target: [reportsTable.userId, reportsTable.periodStart, reportsTable.periodEnd], set: { taskCount: inPeriod.length, completed: inPeriod.filter((task) => task.status === "COMPLETED").length } }).returning();
  res.status(201).json({ ...report, completionRate: Number(report.completionRate) });
});

router.get("/dashboard", async (req, res): Promise<void> => {
  const user = await currentUser(req);
  if (!user) { res.status(401).json({ error: "Необхідно увійти" }); return; }
  const plants = await db.select().from(plantsTable).where(eq(plantsTable.userId, user.id));
  const plantIds = new Set(plants.map((plant) => plant.id));
  const tasks = (await db.select().from(tasksTable)).filter((task) => plantIds.has(task.plantId));
  const activeTasks = tasks.filter(task => ["PLANNED", "POSTPONED"].includes(task.status));
  const mappedTasks = await Promise.all(activeTasks.sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate)).slice(0, 8).map(mapTask));
  const recommendations = (await db.select().from(recommendationsTable).orderBy(desc(recommendationsTable.generatedAt))).filter((item) => plantIds.has(item.plantId)).slice(0, 3);
  const reminders = await db.select().from(remindersTable).where(eq(remindersTable.status, "PENDING"));
  const weather = await weatherService.getForecast(await resolveSavedWeatherLocation(user));
  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  res.json({ plantsCount: plants.length, todayTasks: activeTasks.filter((task) => task.scheduledDate === today()).length, overdueTasks: activeTasks.filter((task) => task.scheduledDate < today()).length, completedTasks: tasks.filter((task) => task.status === "COMPLETED").length, highPriorityTasks: activeTasks.filter((task) => ["HIGH", "URGENT"].includes(task.priority)).length, weather, upcomingTasks: mappedTasks, latestRecommendations: await Promise.all(recommendations.map(mapRecommendation)), reminders: reminders.filter((item) => plantIds.has(taskMap.get(item.taskId)?.plantId ?? -1) && ["PLANNED", "POSTPONED"].includes(taskMap.get(item.taskId)?.status ?? "")).slice(0, 5).map((item) => ({ id: item.id, taskId: item.taskId, plantName: plants.find((plant) => plant.id === taskMap.get(item.taskId)?.plantId)?.name ?? "Рослина", taskType: taskMap.get(item.taskId)?.type ?? "OTHER", reminderDate: item.reminderDate, status: item.status, message: `Нагадування на ${item.reminderDate}` })) });
});

export default router;