import { pool } from "@workspace/db";
import { migratePlantNames } from "./plant-name-migration";
import { migrateCategories } from "./category-migration";
import { migrateCustomPlants } from "./custom-plant-migration";

const client = await pool.connect();
try { await migratePlantNames(client); await migrateCategories(client); await migrateCustomPlants(client); }
finally { client.release(); await pool.end(); }
