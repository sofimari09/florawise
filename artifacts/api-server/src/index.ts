import app from "./app";
import { logger } from "./lib/logger";
import { seedData } from "./lib/seed";
import { pool } from "@workspace/db";
import { migratePlantNames } from "./lib/plant-name-migration";

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
try { await migratePlantNames(migrationClient); }
finally { migrationClient.release(); }
await seedData();
app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
