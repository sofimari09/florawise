import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import pg from "pg";

async function unusedPort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function startup(schema) {
  const port = await unusedPort();
  const child = spawn(process.execPath, ["dist/index.mjs"], {
    env: { ...process.env, NODE_ENV: "development", PORT: String(port), PGOPTIONS: `-c search_path=${schema}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stopped = once(child, "exit");
  const ready = new Promise((resolve, reject) => {
    let output = "";
    child.stdout.on("data", data => {
      output += data.toString();
      if (output.includes("Server listening")) resolve();
    });
    child.on("error", reject);
    child.on("exit", code => reject(new Error(`Isolated API startup exited before ready (code ${code})`)));
    // Consume error output without logging credentials or full environment values.
    child.stderr.on("data", () => {});
  });
  let timer;
  try {
    await Promise.race([ready, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Isolated API startup timed out")), 20_000);
    })]);
    const response = await fetch(`http://127.0.0.1:${port}/api/plants`);
    assert.equal(response.status, 200);
    const plants = await response.json();
    assert.ok(plants.length > 0, "Existing demo initialization works after schema setup");
    return plants;
  } finally {
    clearTimeout(timer);
    child.kill("SIGTERM");
    const forced = setTimeout(() => child.kill("SIGKILL"), 2000);
    await stopped;
    clearTimeout(forced);
  }
}

test("API startup provisions fresh schema, safely upgrades legacy data, and preserves deliberate alias clears on rerun", async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  const schema = `startup_test_${randomUUID().replaceAll("-", "")}`;
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await startup(schema); // Empty-schema provisioning, migration, seed, listen, and API read.
    const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname=$1", [schema])).rows;
    assert.equal(tables.length, 14); // 13 current model tables plus the migration ledger.
    assert.equal((await client.query("SELECT count(*)::int AS n FROM flora_schema_migrations")).rows[0].n, 1);
    const before = (await client.query("SELECT to_jsonb(p) - 'personal_name' AS row FROM flora_plants p ORDER BY id")).rows;
    const tasksBefore = (await client.query("SELECT * FROM flora_tasks ORDER BY id")).rows;
    // Simulate the pre-alias schema ONLY inside this disposable test schema.
    await client.query("ALTER TABLE flora_plants DROP COLUMN personal_name");
    await client.query("DROP TABLE flora_schema_migrations");
    const upgraded = await startup(schema);
    assert.deepEqual((await client.query("SELECT to_jsonb(p) - 'personal_name' AS row FROM flora_plants p ORDER BY id")).rows, before);
    assert.deepEqual((await client.query("SELECT * FROM flora_tasks ORDER BY id")).rows, tasksBefore);
    assert.ok(upgraded.every(plant => plant.personalName === plant.name));
    const id = upgraded[0].id;
    await client.query(`UPDATE flora_plants p SET personal_name=NULL, name=s.name
      FROM flora_species s WHERE p.species_id=s.id AND p.id=$1`, [id]);
    const rerun = await startup(schema);
    const cleared = rerun.find(plant => plant.id === id);
    assert.equal(cleared.personalName, null);
    assert.equal(cleared.name, cleared.speciesName);
    assert.deepEqual((await client.query("SELECT * FROM flora_tasks ORDER BY id")).rows, tasksBefore);
  } finally {
    await client.query("SET search_path TO public");
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    client.release();
    await pool.end();
  }
});
