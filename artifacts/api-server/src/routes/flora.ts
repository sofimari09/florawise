import { Router, type IRouter, type Request } from "express";
import { and, desc, eq, gte, lte } from "drizzle-orm";
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
  type PlantSpecies,
  type CareTask,
} from "@workspace/db";
import { weatherService } from "../lib/weather";
import { generateRules } from "../lib/recommendation-engine";

const router: IRouter = Router();
const today = () => new Date().toISOString().slice(0, 10);
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
const plantInput = z.object({
  name: z.string().trim().min(1, "Назва рослини обов'язкова"),
  speciesId: z.coerce.number().int().positive(),
  location: z.string().trim().min(1, "Локація обов'язкова"),
  photoUrl: z.string().url().or(z.literal("")),
});
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
});

async function currentUser(req: Request) {
  const auth = getAuth(req);
  const clerkUserId = auth.userId ?? (process.env.NODE_ENV === "development" ? "preview-demo-user" : null);
  if (!clerkUserId) return null;
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.clerkUserId, clerkUserId)).limit(1);
  if (existing) return existing;
  if (clerkUserId === "preview-demo-user") {
    const [created] = await db.insert(usersTable).values({ clerkUserId, username: "Марія", email: "demo@florawise.app", role: "USER" }).returning();
    return created;
  }
  const [created] = await db.insert(usersTable).values({ clerkUserId, username: "Користувач", email: `${clerkUserId}@florawise.app`, role: "USER" }).returning();
  return created;
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
  const tasks = await db.select().from(tasksTable).where(and(eq(tasksTable.plantId, plant.id), eq(tasksTable.status, "PLANNED"))).orderBy(tasksTable.scheduledDate);
  const next = tasks[0];
  return {
    ...plant,
    speciesName: species?.name ?? "Невідомий вид",
    nextTask: next?.scheduledDate ?? null,
    nextTaskType: next?.type ?? null,
    careStatus: next?.scheduledDate && next.scheduledDate < today() ? "Прострочено" : next ? "Заплановано" : "Немає плану",
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
  res.json({ id: user.id, username: user.username, email: user.email, role: user.role });
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
  const [created] = await db.insert(speciesTable).values({ ...parsed.data, optimalTempMin: String(parsed.data.optimalTempMin), optimalTempMax: String(parsed.data.optimalTempMax) }).returning();
  res.status(201).json(await mapSpecies(created));
});

router.patch("/species/:id", async (req, res): Promise<void> => {
  const user = await currentUser(req);
  if (!user || user.role !== "ADMIN") { res.status(403).json({ error: "Недостатньо прав" }); return; }
  const parsed = speciesInput.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Некоректні дані виду" }); return; }
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
    const matchesOverdue = req.query.overdue !== "true" || plant.careStatus === "Прострочено";
    const matchesPriority = req.query.highPriority !== "true";
    return matchesSearch && matchesLocation && matchesSpecies && matchesOverdue && matchesPriority;
  }));
});

router.post("/plants", async (req, res): Promise<void> => {
  const user = await currentUser(req);
  const parsed = plantInput.safeParse(req.body);
  if (!user) { res.status(401).json({ error: "Необхідно увійти" }); return; }
  if (!parsed.success) { res.status(400).json({ error: "Назва, вид і локація рослини обов'язкові" }); return; }
  const [created] = await db.insert(plantsTable).values({ ...parsed.data, userId: user.id }).returning();
  res.status(201).json(await mapPlant(created));
});

router.get("/plants/:id", async (req, res): Promise<void> => {
  const { plant } = await getPlantForUser(req, idFrom(req));
  if (!plant) { res.status(404).json({ error: "Рослину не знайдено" }); return; }
  const [species] = await db.select().from(speciesTable).where(eq(speciesTable.id, plant.speciesId));
  const tasks = await db.select().from(tasksTable).where(eq(tasksTable.plantId, plant.id)).orderBy(desc(tasksTable.scheduledDate));
  const logs = await db.select().from(careLogsTable).where(eq(careLogsTable.taskId, tasks[0]?.id ?? -1));
  const recommendations = await db.select().from(recommendationsTable).where(eq(recommendationsTable.plantId, plant.id)).orderBy(desc(recommendationsTable.generatedAt)).limit(5);
  const allLogs = await db.select().from(careLogsTable);
  const plantTaskIds = new Set(tasks.map((task) => task.id));
  const plantLogs = allLogs.filter((log) => plantTaskIds.has(log.taskId));
  const history = await Promise.all(plantLogs.map(async (log) => {
    const task = tasks.find((item) => item.id === log.taskId);
    return { id: log.id, taskId: log.taskId, plantId: plant.id, plantName: plant.name, type: task?.type ?? "OTHER", plannedDate: task?.scheduledDate ?? "", completedAt: log.completedAt.toISOString(), comment: log.comment };
  }));
  const mapped = await mapPlant(plant);
  res.json({ ...mapped, species: species ? await mapSpecies(species) : null, upcomingTasks: await Promise.all(tasks.filter((task) => task.status !== "COMPLETED" && task.status !== "CANCELLED").map(mapTask)), history, recommendations: await Promise.all(recommendations.map(mapRecommendation)), stats: { totalTasks: tasks.length, completedTasks: tasks.filter((task) => task.status === "COMPLETED").length, completionRate: tasks.length ? Math.round((tasks.filter((task) => task.status === "COMPLETED").length / tasks.length) * 100) : 0, lastWatered: history.find((item) => item.type === "WATERING")?.completedAt ?? null } });
});

router.patch("/plants/:id", async (req, res): Promise<void> => {
  const { plant } = await getPlantForUser(req, idFrom(req));
  const parsed = plantInput.partial().safeParse(req.body);
  if (!plant) { res.status(404).json({ error: "Рослину не знайдено" }); return; }
  if (!parsed.success) { res.status(400).json({ error: "Некоректні дані рослини" }); return; }
  const [updated] = await db.update(plantsTable).set(parsed.data).where(eq(plantsTable.id, plant.id)).returning();
  res.json(await mapPlant(updated));
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
  await db.update(tasksTable).set({ status: "COMPLETED" }).where(eq(tasksTable.id, task.id));
  await db.insert(careLogsTable).values({ taskId: task.id, comment: typeof req.body?.comment === "string" ? req.body.comment : "" });
  await db.update(remindersTable).set({ status: "DISMISSED" }).where(eq(remindersTable.taskId, task.id));
  const [updated] = await db.select().from(tasksTable).where(eq(tasksTable.id, task.id));
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
  res.json(reminders.filter((item) => plantMap.has(taskMap.get(item.taskId)?.plantId ?? -1)).map((item) => ({ id: item.id, taskId: item.taskId, plantName: plantMap.get(taskMap.get(item.taskId)?.plantId ?? -1)?.name ?? "Рослина", taskType: taskMap.get(item.taskId)?.type ?? "OTHER", reminderDate: item.reminderDate, status: item.status, message: `Заплановано: ${taskMap.get(item.taskId)?.type ?? "догляд"} ${item.reminderDate}` })));
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
  res.json(await weatherService.getForecast(stringParam(req.query.location) ?? "Київ"));
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
  const { plant } = await getPlantForUser(req, Number(req.body?.plantId));
  if (!plant) { res.status(404).json({ error: "Рослину не знайдено" }); return; }
  const [species] = await db.select().from(speciesTable).where(eq(speciesTable.id, plant.speciesId));
  if (!species) { res.status(400).json({ error: "Для рослини не знайдено характеристики виду" }); return; }
  const forecast = await weatherService.getForecast(plant.location);
  const tasks = await db.select().from(tasksTable).where(and(eq(tasksTable.plantId, plant.id), eq(tasksTable.status, "PLANNED")));
  const watering = tasks.filter((task) => task.type === "WATERING").map((task) => task.id);
  const logs = watering.length ? await db.select().from(careLogsTable).where(eq(careLogsTable.taskId, watering[0])) : [];
  const drafts = generateRules(species, tasks, forecast.forecast, plant.location, logs[0]?.completedAt.toISOString().slice(0, 10) ?? null);
  const saved = await Promise.all(drafts.map(async (draft) => {
    const [created] = await db.insert(recommendationsTable).values({ plantId: plant.id, generatedAt: new Date(), type: draft.type, text: draft.text, priority: draft.priority, relatedTaskId: draft.relatedTaskId, explanation: draft.explanation, originalDate: draft.originalDate, suggestedDate: draft.suggestedDate, weatherJson: JSON.stringify(draft.weather), applied: 0 }).returning();
    return mapRecommendation(created);
  }));
  res.status(201).json({ recommendations: await Promise.all(saved), weather: forecast, warning: null });
});

router.post("/recommendations/:id/apply", async (req, res): Promise<void> => {
  const [rec] = await db.select().from(recommendationsTable).where(eq(recommendationsTable.id, idFrom(req)));
  const { plant } = await getPlantForUser(req, rec?.plantId ?? -1);
  if (!rec || !plant || !rec.suggestedDate || !rec.relatedTaskId) { res.status(400).json({ error: "Для цієї рекомендації немає зміни дати" }); return; }
  await db.update(tasksTable).set({ scheduledDate: rec.suggestedDate, status: "POSTPONED", postponementCount: (await db.select().from(tasksTable).where(eq(tasksTable.id, rec.relatedTaskId)))[0]?.postponementCount + 1 || 1 }).where(eq(tasksTable.id, rec.relatedTaskId));
  await db.update(remindersTable).set({ reminderDate: rec.suggestedDate, status: "PENDING" }).where(eq(remindersTable.taskId, rec.relatedTaskId));
  await db.update(recommendationsTable).set({ applied: 1 }).where(eq(recommendationsTable.id, rec.id));
  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, rec.relatedTaskId));
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
  const mappedTasks = await Promise.all(tasks.sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate)).slice(0, 8).map(mapTask));
  const recommendations = (await db.select().from(recommendationsTable).orderBy(desc(recommendationsTable.generatedAt))).filter((item) => plantIds.has(item.plantId)).slice(0, 3);
  const reminders = await db.select().from(remindersTable).where(eq(remindersTable.status, "PENDING"));
  const weather = await weatherService.getForecast(plants[0]?.location ?? "Київ");
  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  res.json({ plantsCount: plants.length, todayTasks: tasks.filter((task) => task.scheduledDate === today() && task.status === "PLANNED").length, overdueTasks: tasks.filter((task) => ["PLANNED", "POSTPONED"].includes(task.status) && task.scheduledDate < today()).length, completedTasks: tasks.filter((task) => task.status === "COMPLETED").length, highPriorityTasks: tasks.filter((task) => ["HIGH", "URGENT"].includes(task.priority) && task.status === "PLANNED").length, weather, upcomingTasks: mappedTasks, latestRecommendations: await Promise.all(recommendations.map(mapRecommendation)), reminders: reminders.filter((item) => plantIds.has(taskMap.get(item.taskId)?.plantId ?? -1)).slice(0, 5).map((item) => ({ id: item.id, taskId: item.taskId, plantName: plants.find((plant) => plant.id === taskMap.get(item.taskId)?.plantId)?.name ?? "Рослина", taskType: taskMap.get(item.taskId)?.type ?? "ДОГЛЯД", reminderDate: item.reminderDate, status: item.status, message: `Нагадування на ${item.reminderDate}` })) });
});

export default router;