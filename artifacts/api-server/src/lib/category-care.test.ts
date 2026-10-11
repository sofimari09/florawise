import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { CARE_TYPES, CATEGORY_DEFAULTS, CATEGORY_LABELS, CARE_LABELS, allowedCareTypes, applicabilityError, eligibilityError, eligibilityVersion, PLANT_CATEGORIES } from "@workspace/plant-care";
import type { PlantSpecies, CareTask, SpeciesCareRule } from "@workspace/db";
import { assertTaskUpdate, carePlan } from "./care-eligibility";
import { generateRules } from "./recommendation-engine";
import { migrateCategories, type ReviewedClassification } from "./category-migration";

const species = { id: 1, category: "INDOOR_DECORATIVE", applicableCareTypes: null, careRevision: 0,
  name: "Монстера", wateringFrequencyDays: 7, wateringRecommendations: "Перевірте ґрунт",
  fertilizingFrequencyDays: 30, transplantingFrequencyMonths: 24, optimalTempMin: "18", optimalTempMax: "28" } as PlantSpecies;
const task = { id: 1, plantId: 1, type: "HARVEST", scheduledDate: "2026-10-01", status: "PLANNED", priority: "MEDIUM", postponementCount: 0 } as CareTask;
const matrices = {
  INDOOR_DECORATIVE: ["WATERING", "FERTILIZING", "PRUNING", "TRANSPLANTING", "TREATMENT"],
  OUTDOOR_DECORATIVE: ["WATERING", "FERTILIZING", "PRUNING", "TRANSPLANTING", "TREATMENT"],
  FRUIT_TREE: ["WATERING", "FERTILIZING", "PRUNING", "TREATMENT", "HARVEST"],
  BERRY_SHRUB: ["WATERING", "FERTILIZING", "PRUNING", "TREATMENT", "HARVEST", "PLANTING"],
  VEGETABLE: ["SOWING", "PLANTING", "WATERING", "FERTILIZING", "TREATMENT", "HARVEST"],
  HERB: ["SOWING", "PLANTING", "WATERING", "FERTILIZING", "HARVEST"],
};
for (const category of PLANT_CATEGORIES) test(`${category}: exact matrix, inheritance, explicit-empty and subset semantics`, () => {
  assert.deepEqual(CATEGORY_DEFAULTS[category], matrices[category]);
  assert.deepEqual(allowedCareTypes({ category }), matrices[category]);
  assert.deepEqual(allowedCareTypes({ category, applicableCareTypes: null }), matrices[category]);
  assert.deepEqual(allowedCareTypes({ category, applicableCareTypes: [] }), []);
  assert.deepEqual(allowedCareTypes({ category, applicableCareTypes: ["WATERING"] }), ["WATERING"]);
  for (const type of CARE_TYPES) {
    assert.equal(eligibilityError({ category }, type) === null, matrices[category].includes(type));
    assert.equal(applicabilityError({ category, applicableCareTypes: [type] }) === null, matrices[category].includes(type));
  }
  assert.equal(applicabilityError({ category, applicableCareTypes: ["WATERING", "WATERING"] }) === null, false);
  assert.match(CATEGORY_LABELS[category], /[А-Яа-яІіЇїЄє]/);
});
test("invalid types and categories fail closed, Ukrainian labels cover all eight actions", () => {
  assert.deepEqual(allowedCareTypes({ category: "unknown" }), []);
  assert.ok(eligibilityError(species, "OTHER"));
  assert.equal(CARE_LABELS.SOWING, "Посів");
  assert.equal(CARE_LABELS.PLANTING, "Висаджування");
  assert.equal(Object.keys(CARE_LABELS).length, 8);
});
test("plans require supported intervals and applicability, never invent sowing/planting/harvest dates", () => {
  assert.deepEqual(carePlan(species).map(item => item.type), ["WATERING", "FERTILIZING", "TRANSPLANTING"]);
  assert.deepEqual(carePlan({ ...species, category: "VEGETABLE" }).map(item => item.type), ["WATERING", "FERTILIZING"]);
  assert.deepEqual(carePlan({ ...species, applicableCareTypes: [] }), []);
  assert.deepEqual(carePlan({ ...species, applicableCareTypes: ["PRUNING", "TREATMENT"] }), []);
  assert.notEqual(eligibilityVersion(species), eligibilityVersion({ ...species, careRevision: 1 }));
  assert.notEqual(eligibilityVersion(species), eligibilityVersion(species, 1));
  assert.notEqual(eligibilityVersion(species), eligibilityVersion({ ...species, applicableCareTypes: [...CATEGORY_DEFAULTS.INDOOR_DECORATIVE] }));
});
test("full legacy task payload can be retained or closed, never rescheduled or reopened", () => {
  assert.doesNotThrow(() => assertTaskUpdate(task, { ...task, notes: "Залишити історію" }, species));
  for (const status of ["COMPLETED", "CANCELLED"]) assert.doesNotThrow(() => assertTaskUpdate(task, { ...task, status }, species));
  for (const change of [{ scheduledDate: "2026-10-02" }, { plantId: 2 }, { type: "SOWING" }, { status: "POSTPONED" }]) {
    assert.throws(() => assertTaskUpdate(task, { ...task, ...change }, species));
  }
  assert.throws(() => assertTaskUpdate({ ...task, status: "CANCELLED" }, task, species));
});
test("inapplicable tasks and rules contribute neither risk nor active counts", () => {
  const day = new Date().toISOString().slice(0, 10);
  const rule = { careType: "HARVEST", maxWindSpeedMps: "0", rainThresholdMm: "0", minTemperature: null, maxTemperature: null } as SpeciesCareRule;
  const result = generateRules(species, [task], [{ date: day, windSpeed: 20, precipitation: 20, temperature: 20, humidity: 60, condition: "Дощ" }], "Сад", "OUTDOOR", null, [rule]);
  assert.equal(result.length, 1);
  assert.equal(result[0].type, "GENERAL");
  assert.equal(result[0].priority, "LOW");
  assert.match(result[0].explanation, /0 активних/);
  assert.match(result[0].explanation, /Кімнатна декоративна/);
  assert.doesNotMatch(result[0].explanation, /поріг опадів/);
});
test("classification migration preserves records, reruns safely and reports unknown classifications", async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  const schema = `category_test_${randomUUID().replaceAll("-", "")}`;
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(`CREATE TABLE flora_species(id int PRIMARY KEY, name text NOT NULL, category text, knowledge text);
      CREATE TABLE flora_plants(id int PRIMARY KEY, alias text, photo text);
      CREATE TABLE flora_recommendations(id int PRIMARY KEY, explanation text);
      CREATE TABLE flora_tasks(id int PRIMARY KEY, type text, status text);`);
    const names = ["Монстера", "Троянда", "Яблуня", "Малина", "Томат", "Базилік", "Полуниця"];
    const reviewed: ReviewedClassification[] = names.map((name, index) => ({
      id: index + 1, name, category: index < 6 ? PLANT_CATEGORIES[index] : "BERRY_SHRUB",
    }));
    for (const [i, name] of names.entries()) await client.query("INSERT INTO flora_species VALUES($1,$2,NULL,'не змінювати')", [i + 1, name]);
    await client.query("INSERT INTO flora_plants VALUES(1,'довільне ім’я','legacy-photo'); INSERT INTO flora_tasks VALUES(1,'HARVEST','COMPLETED'); INSERT INTO flora_recommendations VALUES(1,'історична порада')");
    await migrateCategories(client, reviewed);
    const before = (await client.query("SELECT * FROM flora_species ORDER BY id")).rows;
    assert.deepEqual(before.map(row => row.category), [...PLANT_CATEGORIES, "BERRY_SHRUB"]);
    await migrateCategories(client, reviewed);
    assert.deepEqual((await client.query("SELECT * FROM flora_species ORDER BY id")).rows, before);
    assert.equal((await client.query("SELECT alias FROM flora_plants")).rows[0].alias, "довільне ім’я");
    assert.equal((await client.query("SELECT status FROM flora_tasks")).rows[0].status, "COMPLETED");
    await assert.rejects(client.query("INSERT INTO flora_species(id,name,category,knowledge) VALUES(20,'невідомий','не категорія','')"), /flora_species_category_valid/);
    await client.query("ALTER TABLE flora_species DROP CONSTRAINT flora_species_category_valid; ALTER TABLE flora_species ALTER COLUMN category DROP NOT NULL");
    await client.query("INSERT INTO flora_species(id,name) VALUES(20,'невідомий'),(50,'Томат')");
    await assert.rejects(migrateCategories(client, reviewed), /Потрібна перевірена класифікація/);
    assert.equal((await client.query("SELECT category FROM flora_species WHERE id=20")).rows[0].category, null);
    assert.equal((await client.query("SELECT category FROM flora_species WHERE id=50")).rows[0].category, null, "custom namesake is never classified by its name");
    assert.equal((await client.query("SELECT category FROM flora_species WHERE id=5")).rows[0].category, "VEGETABLE", "audited catalog identity stays classified");
    await assert.rejects(migrateCategories(client, reviewed), /Потрібна перевірена класифікація/);
    assert.equal((await client.query("SELECT category FROM flora_species WHERE id=50")).rows[0].category, null, "reruns preserve unresolved namesakes");
    await client.query("UPDATE flora_species SET category='INDOOR_DECORATIVE' WHERE id IN (20,50)");
    await migrateCategories(client, reviewed);
    assert.equal((await client.query("SELECT category FROM flora_species WHERE id=50")).rows[0].category, "INDOOR_DECORATIVE", "reviewed custom choice is preserved");
  } finally {
    await client.query("SET search_path TO public");
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    client.release(); await pool.end();
  }
});
