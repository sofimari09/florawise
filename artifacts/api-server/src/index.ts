import app from "./app";
import { logger } from "./lib/logger";
import { seedData } from "./lib/seed";
import { pool } from "@workspace/db";
import { migratePlantNames } from "./lib/plant-name-migration";
import { migrateCategories } from "./lib/category-migration";
import { migrateCustomPlants } from "./lib/custom-plant-migration";
import { migrateRecommendationAppliedAt } from "./lib/recommendation-applied-at-migration";
import { migrateRecommendationSupersededAt } from "./lib/recommendation-superseded-migration";
import { migrateDemoTomatoEnvironment } from "./lib/demo-tomato-environment-migration";
import { migrateNotifications } from "./lib/notification-migration";
import { seedKnowledgeBase } from "./lib/seed-knowledge-base";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const migrationClient = await pool.connect();
try { await migratePlantNames(migrationClient); await migrateCategories(migrationClient); await migrateCustomPlants(migrationClient); await migrateRecommendationAppliedAt(migrationClient); await migrateRecommendationSupersededAt(migrationClient); await migrateDemoTomatoEnvironment(migrationClient); await migrateNotifications(migrationClient); }
finally { migrationClient.release(); }
await seedData();
await seedKnowledgeBase();
app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
