import assert from "node:assert/strict";
import { test } from "node:test";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { z } from "zod/v4";
import { identityInput, normalizeSearch, resolvePlantName } from "./plant-identity";
import { migratePlantNames } from "./plant-name-migration";

test("optional aliases default, trim, clear, and never affect identity", () => {
  assert.deepEqual(resolvePlantName({}, "Малина"), { name: "Малина", personalName: null });
  assert.deepEqual(resolvePlantName({ personalName: "  Малина біля паркану  " }, "Полуниця"), { name: "Малина біля паркану", personalName: "Малина біля паркану" });
  for (const personalName of ["", " \t ", null]) {
    assert.deepEqual(resolvePlantName({ personalName }, "Малина", { personalName: "Стара назва" }), { name: "Малина", personalName: null });
  }
});

test("PATCH omission preserves alias; species-only changes refresh defaults", () => {
  assert.equal(resolvePlantName({}, "Томат", { personalName: "Мій сад" }).name, "Мій сад");
  assert.equal(resolvePlantName({}, "Томат", { personalName: null }).name, "Томат");
  assert.equal(resolvePlantName({ personalName: "Малина" }, "Малина").personalName, "Малина");
});

test("legacy name is an alias with explicit personalName precedence", () => {
  assert.equal(resolvePlantName({ name: "Стара назва" }, "Фікус").name, "Стара назва");
  assert.deepEqual(resolvePlantName({ name: "Стара назва", personalName: null }, "Фікус"), { name: "Фікус", personalName: null });
  assert.equal(resolvePlantName({ name: "  " }, "Фікус").name, "Фікус");
});

test("species IDs are mandatory, positive integer records, not name text", () => {
  const input = z.object(identityInput);
  for (const speciesId of [0, -1, 1.5, null, "1", "Малина"]) assert.equal(input.safeParse({ speciesId }).success, false);
  assert.equal(input.safeParse({ personalName: "Малина" }).success, false);
  assert.equal(input.safeParse({ speciesId: 1 }).success, true);
});

test("search normalizes Ukrainian case and repeated whitespace without substitutions", () => {
  assert.equal(normalizeSearch(" \t МАЛИНА  біля \n паркану "), "малина біля паркану");
  assert.equal(normalizeSearch("Полуниця").includes(normalizeSearch("малина")), false);
});

test("transactional migration preserves relationships and never rebacks cleared aliases", async () => {
  // An isolated disposable schema; no application rows or markers are modified.
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  const schema = `identity_test_${randomUUID().replaceAll("-", "")}`;
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query("CREATE TABLE flora_species(id integer PRIMARY KEY, name text NOT NULL)");
    await client.query(`CREATE TABLE flora_plants(
      id integer PRIMARY KEY, species_id integer REFERENCES flora_species(id),
      name text NOT NULL, photo text, place integer, weather integer, owner integer
    )`);
    await client.query("CREATE TABLE flora_tasks(id integer PRIMARY KEY, plant_id integer REFERENCES flora_plants(id), date text)");
    await client.query("INSERT INTO flora_species VALUES (1, 'Фікус'), (2, 'Малина')");
    await client.query(`INSERT INTO flora_plants VALUES
      (1, 1, 'Малина біля паркану', '/objects/photos/unchanged', 7, 9, 4),
      (2, 2, 'Малина', 'legacy-url', 8, 10, 5)`);
    await client.query("INSERT INTO flora_tasks VALUES (11, 1, '2026-10-08')");
    const before = (await client.query("SELECT * FROM flora_plants ORDER BY id")).rows;
    await migratePlantNames(client);
    let rows = (await client.query("SELECT * FROM flora_plants ORDER BY id")).rows;
    assert.equal(rows[0].personal_name, "Малина біля паркану");
    assert.equal(rows[1].personal_name, null);
    assert.deepEqual(rows.map(({ personal_name, ...row }) => row), before);
    await client.query("UPDATE flora_plants SET personal_name = NULL, name = 'Фікус' WHERE id = 1");
    await client.query("UPDATE flora_plants SET personal_name = 'Нова назва', name = 'Нова назва' WHERE id = 2");
    await migratePlantNames(client);
    rows = (await client.query("SELECT * FROM flora_plants ORDER BY id")).rows;
    assert.equal(rows[0].personal_name, null);
    assert.equal(rows[1].personal_name, "Нова назва");
    assert.deepEqual((await client.query("SELECT * FROM flora_tasks")).rows, [{ id: 11, plant_id: 1, date: "2026-10-08" }]);
    assert.equal((await client.query("SELECT COUNT(*)::int AS count FROM flora_schema_migrations")).rows[0].count, 1);
  } finally {
    await client.query("ROLLBACK");
    await client.query("SET search_path TO public");
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    client.release();
    await pool.end();
  }
});
