import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { plantsTable, plantPlacesTable, speciesTable, tasksTable, usersTable, careLogsTable, remindersTable } from "@workspace/db";
import { logger } from "./logger";
import { dateInKyivOffset, todayInKyiv } from "./date";
import { migrateLegacyLocations } from "./legacy-location-migration";
import { SEED_CATEGORIES } from "./category-migration";

const speciesSeed = [
  ["Монстера", "Велика тропічна рослина з характерними прорізами на листі.", 18, 28, 65, 7, "Яскраве розсіяне світло", "Легкий поживний субстрат із дренажем", "Поливайте після підсихання верхніх 3 см ґрунту.", "Раз на місяць у період росту.", "Видаляйте сухе листя та слабкі пагони.", "Пересаджуйте раз на 2–3 роки."],
  ["Фікус", "Надійна декоративна рослина для світлих кімнат.", 16, 27, 55, 8, "Яскраве розсіяне світло", "Повітропроникний ґрунт для кімнатних рослин", "Не допускайте застою води.", "Раз на 4–6 тижнів навесні та влітку.", "Формувальна обрізка навесні.", "Пересаджуйте, коли корені заповнять горщик."],
  ["Спатифілум", "Тіньовитривала рослина з білими покривалами суцвіть.", 18, 26, 70, 5, "Розсіяне світло або легка напівтінь", "Вологий, але дренований субстрат", "Підтримуйте рівномірну вологість ґрунту.", "Раз на місяць у період цвітіння.", "Видаляйте відцвілі суцвіття.", "Пересаджуйте навесні раз на 2 роки."],
  ["Орхідея", "Елегантна рослина з тривалим цвітінням.", 18, 30, 60, 10, "Яскраве розсіяне світло", "Кора для орхідей із хорошою вентиляцією", "Поливайте зануренням після просихання кори.", "Спеціальне добриво кожні 2–3 поливи.", "Обрізайте квітконос після цвітіння за станом.", "Пересаджуйте раз на 2–3 роки."],
  ["Томат", "Світлолюбна овочева культура для саду або теплиці.", 18, 30, 60, 3, "Пряме сонце від 6 годин", "Родючий ґрунт із компостом", "Поливайте під корінь без змочування листя.", "Раз на 2 тижні під час плодоношення.", "Пасинкуйте та підв'язуйте стебла.", "Пересаджуйте розсаду після стабільного тепла."],
  ["Троянда", "Класична квітуча рослина для сонячної ділянки.", 15, 27, 55, 5, "Пряме сонце", "Суглинок із компостом і дренажем", "Поливайте рясно, коли верхній шар просох.", "Раз на 3–4 тижні у сезон.", "Обрізайте після цвітіння та навесні.", "Пересаджуйте у стані спокою."],
  ["Лаванда", "Ароматна посухостійка рослина для сонячних місць.", 12, 28, 45, 10, "Повне сонце", "Сухий легкий ґрунт із піском", "Поливайте рідко, уникаючи перезволоження.", "Легке добриво на початку сезону.", "Підстригайте після цвітіння.", "Пересаджуйте навесні з грудкою землі."],
  ["Полуниця", "Солодка ягідна культура для грядок і контейнерів.", 14, 26, 60, 4, "Сонце від 6 годин", "Родючий слабокислий ґрунт", "Поливайте регулярно вранці.", "Підживлюйте до і після плодоношення.", "Видаляйте старе листя після збору.", "Оновлюйте посадки кожні 3 роки."],
  ["Базилік", "Теплолюбна ароматна зелень для кухні та саду.", 18, 30, 55, 3, "Яскраве сонце", "Легкий поживний ґрунт", "Поливайте, коли верхній шар просох.", "Раз на 3 тижні в період росту.", "Прищипуйте верхівки для кущіння.", "Пересаджуйте при появі 2–3 пар листків."],
  ["Гортензія", "Пишноквітучий кущ із великими суцвіттями.", 14, 25, 70, 4, "Світла напівтінь", "Кислий вологий ґрунт", "Підтримуйте рівномірну вологість.", "Добриво для гортензій навесні та влітку.", "Обрізайте за типом цвітіння.", "Пересаджуйте навесні або восени."],
].map((item, index) => ({
  name: item[0] as string,
  category: SEED_CATEGORIES[item[0] as string],
  description: item[1] as string,
  optimalTempMin: String(item[2]),
  optimalTempMax: String(item[3]),
  optimalHumidity: item[4] as number,
  wateringFrequencyDays: item[5] as number,
  lightRequirements: item[6] as string,
  soilRecommendations: item[7] as string,
  wateringRecommendations: item[8] as string,
  fertilizingRecommendations: item[9] as string,
  pruningRecommendations: item[10] as string,
  transplantingRecommendations: item[11] as string,
  careRecommendations: `${item[8]} ${item[9]}`,
  imageUrl: [
    "https://images.unsplash.com/photo-1614594975525-e45190c55d0b",
    "https://images.unsplash.com/photo-1509423350716-97f9360b4e09",
    "https://images.unsplash.com/photo-1593691509543-c55fb32e5cee",
    "https://images.unsplash.com/photo-1485955900006-10f4d324d411",
    "https://images.unsplash.com/photo-1592841200221-a6898f307baa",
    "https://images.unsplash.com/photo-1559563362-c667ba5f5480",
    "https://images.unsplash.com/photo-1591857177580-dc82b9ac4e1e",
    "https://images.unsplash.com/photo-1587393855524-087f83d95bc9",
    "https://images.unsplash.com/photo-1618377382944-8b2ecae4b5a6",
    "https://images.unsplash.com/photo-1597305877032-0668b3c0d4c4",
  ][index],
}));

const date = (offset: number, fromDate = todayInKyiv()) => dateInKyivOffset(offset, fromDate);

export const demoActiveTaskSpecs = [
  { plantName: "Монстера біля вікна", type: "WATERING", dateOffset: 1, priority: "HIGH", notes: "Перевірити верхній шар ґрунту" },
  { plantName: "Монстера біля вікна", type: "PRUNING", dateOffset: 2, priority: "MEDIUM", notes: "Прибрати сухе листя" },
  { plantName: "Біла орхідея", type: "WATERING", dateOffset: 1, priority: "URGENT", notes: "Полив після просихання кори" },
  { plantName: "Томати на грядці", type: "WATERING", dateOffset: 1, priority: "MEDIUM", notes: "Полив під корінь" },
  { plantName: "Томати на грядці", type: "TREATMENT", dateOffset: 3, priority: "HIGH", notes: "Профілактична обробка" },
] as const;

const completedDemoTaskSpec = {
  plantName: "Базилік для кухні",
  type: "FERTILIZING",
  dateOffset: -5,
  priority: "LOW",
  notes: "Рідке добриво",
} as const;

export async function seedData(): Promise<void> {
  const existing = await db.select({ id: speciesTable.id }).from(speciesTable).limit(1);
  if (existing.length > 0) {
    await migrateLegacyLocations();
    return;
  }
  const insertedSpecies = await db.insert(speciesTable).values(speciesSeed).returning();
  const [user] = await db.insert(usersTable).values({
    clerkUserId: "preview-demo-user",
    username: "Демо-користувач",
    email: "demo@florawise.app",
    role: "USER",
  }).returning();
  await db.insert(usersTable).values({
    clerkUserId: "preview-demo-admin",
    username: "Адміністратор",
    email: "admin@florawise.app",
    role: "ADMIN",
  });
  const plants = await db.insert(plantsTable).values([
    { userId: user.id, speciesId: insertedSpecies[0].id, name: "Монстера біля вікна", personalName: "Монстера біля вікна", location: "Балкон", photoUrl: insertedSpecies[0].imageUrl ?? "" },
    { userId: user.id, speciesId: insertedSpecies[3].id, name: "Біла орхідея", personalName: "Біла орхідея", location: "Вітальня", photoUrl: insertedSpecies[3].imageUrl ?? "" },
    { userId: user.id, speciesId: insertedSpecies[4].id, name: "Томати на грядці", personalName: "Томати на грядці", location: "Сад", environmentType: "OUTDOOR", photoUrl: insertedSpecies[4].imageUrl ?? "" },
    { userId: user.id, speciesId: insertedSpecies[8].id, name: "Базилік для кухні", personalName: "Базилік для кухні", location: "Підвіконня", photoUrl: insertedSpecies[8].imageUrl ?? "" },
  ]).returning();
  const plantByName = new Map(plants.map((plant) => [plant.name, plant]));
  const tasks = await db.insert(tasksTable).values([
    ...demoActiveTaskSpecs.map((spec) => ({
      plantId: plantByName.get(spec.plantName)!.id,
      type: spec.type,
      scheduledDate: date(spec.dateOffset),
      priority: spec.priority,
      notes: spec.notes,
    })),
    {
      plantId: plantByName.get(completedDemoTaskSpec.plantName)!.id,
      type: completedDemoTaskSpec.type,
      scheduledDate: date(completedDemoTaskSpec.dateOffset),
      priority: completedDemoTaskSpec.priority,
      notes: completedDemoTaskSpec.notes,
    },
  ]).returning();
  await db.update(tasksTable).set({ status: "COMPLETED" }).where(eq(tasksTable.id, tasks[5].id));
  await db.insert(careLogsTable).values({ taskId: tasks[5].id, comment: "Листя стало насиченішим після підживлення." });
  await db.insert(remindersTable).values(tasks.slice(0, 5).map((task) => ({ taskId: task.id, reminderDate: task.scheduledDate, status: "PENDING" })));
  logger.info("FloraWise demo data seeded");
  await migrateLegacyLocations();
}

export async function refreshDemoData() {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("Демо-дані можна оновлювати лише в середовищі розробки.");
  }

  const [demoUser] = await db.select().from(usersTable).where(eq(usersTable.clerkUserId, "preview-demo-user"));
  if (!demoUser) throw new Error("Обліковий запис preview-demo-user не знайдено.");

  const today = todayInKyiv();
  return db.transaction(async (tx) => {
    const plants = await tx.select().from(plantsTable).where(eq(plantsTable.userId, demoUser.id));
    const plans = [];

    for (const spec of demoActiveTaskSpecs) {
      const plant = plants.find((candidate) => candidate.name === spec.plantName);
      if (!plant) throw new Error(`Не знайдено demo-рослину «${spec.plantName}».`);

      if (spec.plantName === "Томати на грядці" && spec.type === "WATERING") {
        const [place] = plant.placeId
          ? await tx.select().from(plantPlacesTable).where(eq(plantPlacesTable.id, plant.placeId))
          : [];
        if ((place?.environmentType ?? plant.environmentType) !== "OUTDOOR") {
          throw new Error("Полив томатів не можна підготувати для погодної демонстрації: умови мають бути «надворі».");
        }
      }

      const matches = await tx.select().from(tasksTable).where(and(
        eq(tasksTable.plantId, plant.id),
        eq(tasksTable.type, spec.type),
        eq(tasksTable.notes, spec.notes),
      ));
      const active = matches.filter((task) => ["PLANNED", "POSTPONED", "OVERDUE"].includes(task.status));
      if (active.length > 1) {
        throw new Error(`Знайдено кілька активних demo-завдань «${spec.notes}»; оновлення скасовано без змін.`);
      }
      plans.push({ spec, plant, task: active[0] });
    }

    const refreshedTasks: Array<{ id: number; plantName: string; type: string; scheduledDate: string; state: "updated" | "created" }> = [];
    const refreshedReminders: Array<{ id: number; taskId: number; reminderDate: string; state: "updated" | "created" }> = [];

    for (const { spec, plant, task } of plans) {
      const scheduledDate = date(spec.dateOffset, today);
      const [savedTask] = task
        ? await tx.update(tasksTable)
          .set({ scheduledDate, status: "PLANNED", priority: spec.priority })
          .where(eq(tasksTable.id, task.id))
          .returning()
        : await tx.insert(tasksTable).values({
          plantId: plant.id,
          type: spec.type,
          scheduledDate,
          status: "PLANNED",
          priority: spec.priority,
          notes: spec.notes,
        }).returning();
      if (!savedTask) throw new Error(`Не вдалося зберегти demo-завдання «${spec.notes}».`);
      refreshedTasks.push({
        id: savedTask.id,
        plantName: plant.name,
        type: savedTask.type,
        scheduledDate: savedTask.scheduledDate,
        state: task ? "updated" : "created",
      });

      const reminders = await tx.select().from(remindersTable)
        .where(eq(remindersTable.taskId, savedTask.id))
        .orderBy(remindersTable.id);
      if (reminders.length === 0) {
        const [created] = await tx.insert(remindersTable).values({
          taskId: savedTask.id,
          reminderDate: scheduledDate,
          status: "PENDING",
        }).returning();
        if (!created) throw new Error(`Не вдалося створити нагадування для завдання ${savedTask.id}.`);
        refreshedReminders.push({ id: created.id, taskId: savedTask.id, reminderDate: created.reminderDate, state: "created" });
      } else {
        const [primary] = await tx.update(remindersTable)
          .set({ reminderDate: scheduledDate, status: "PENDING" })
          .where(eq(remindersTable.id, reminders[0].id))
          .returning();
        if (!primary) throw new Error(`Не вдалося оновити нагадування для завдання ${savedTask.id}.`);
        refreshedReminders.push({ id: primary.id, taskId: savedTask.id, reminderDate: primary.reminderDate, state: "updated" });
        for (const duplicate of reminders.slice(1)) {
          await tx.update(remindersTable).set({ reminderDate: scheduledDate, status: "READ" })
            .where(eq(remindersTable.id, duplicate.id));
        }
      }
    }

    return { asOf: today, tasks: refreshedTasks, reminders: refreshedReminders };
  });
}