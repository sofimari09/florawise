import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { plantsTable, speciesTable, tasksTable, usersTable, careLogsTable, remindersTable, recommendationsTable } from "@workspace/db";
import { logger } from "./logger";
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

const date = (offset: number) => {
  const value = new Date();
  value.setDate(value.getDate() + offset);
  return value.toISOString().slice(0, 10);
};

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
    { userId: user.id, speciesId: insertedSpecies[0].id, name: "Монстера біля вікна", personalName: "Монстера біля вікна", location: "Балкон", photoUrl: insertedSpecies[0].imageUrl },
    { userId: user.id, speciesId: insertedSpecies[3].id, name: "Біла орхідея", personalName: "Біла орхідея", location: "Вітальня", photoUrl: insertedSpecies[3].imageUrl },
    { userId: user.id, speciesId: insertedSpecies[4].id, name: "Томати на грядці", personalName: "Томати на грядці", location: "Сад", photoUrl: insertedSpecies[4].imageUrl },
    { userId: user.id, speciesId: insertedSpecies[8].id, name: "Базилік для кухні", personalName: "Базилік для кухні", location: "Підвіконня", photoUrl: insertedSpecies[8].imageUrl },
  ]).returning();
  const tasks = await db.insert(tasksTable).values([
    { plantId: plants[0].id, type: "WATERING", scheduledDate: date(1), priority: "HIGH", notes: "Перевірити верхній шар ґрунту" },
    { plantId: plants[0].id, type: "PRUNING", scheduledDate: date(0), priority: "MEDIUM", notes: "Прибрати сухе листя" },
    { plantId: plants[1].id, type: "WATERING", scheduledDate: date(-2), priority: "URGENT", notes: "Полив після просихання кори" },
    { plantId: plants[2].id, type: "WATERING", scheduledDate: date(1), priority: "MEDIUM", notes: "Полив під корінь" },
    { plantId: plants[2].id, type: "TREATMENT", scheduledDate: date(3), priority: "HIGH", notes: "Профілактична обробка" },
    { plantId: plants[3].id, type: "FERTILIZING", scheduledDate: date(-5), priority: "LOW", notes: "Рідке добриво" },
  ]).returning();
  await db.update(tasksTable).set({ status: "COMPLETED" }).where(eq(tasksTable.id, tasks[5].id));
  await db.insert(careLogsTable).values({ taskId: tasks[5].id, comment: "Листя стало насиченішим після підживлення." });
  await db.insert(remindersTable).values(tasks.slice(0, 5).map((task) => ({ taskId: task.id, reminderDate: task.scheduledDate, status: "PENDING" })));
  await db.insert(recommendationsTable).values({
    plantId: plants[2].id,
    generatedAt: new Date(),
    type: "WEATHER_RESCHEDULE",
    text: `Полив рекомендовано перенести з ${date(1)} через значні опади.`,
    priority: "HIGH",
    relatedTaskId: tasks[3].id,
    explanation: "Демонстраційний запис показує, як FloraWise пояснює перенесення для рослини в саду.",
    originalDate: date(1),
    suggestedDate: date(2),
    weatherJson: JSON.stringify({ date: date(1), temperature: 18, precipitation: 13, humidity: 86, windSpeed: 4, condition: "Значні опади" }),
  });
  logger.info("FloraWise demo data seeded");
  await migrateLegacyLocations();
}