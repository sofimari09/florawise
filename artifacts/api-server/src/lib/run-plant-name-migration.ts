import { pool } from "@workspace/db";
import { migratePlantNames } from "./plant-name-migration";

const client = await pool.connect();
try { await migratePlantNames(client); }
finally { client.release(); await pool.end(); }
