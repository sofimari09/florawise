import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import pg from "pg";

// Full isolated schema: never modifies application data, profile defaults, or catalog.
test("custom plants survive all collection/care flows, validate identities and ownership, and rerun startup safely", async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  const schema = `custom_api_${randomUUID().replaceAll("-", "")}`;
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  let child, stopped;
  const start = async () => {
    child = spawn(process.execPath, ["dist/index.mjs"], {
      env: { ...process.env, NODE_ENV: "development", PORT: String(port), PGOPTIONS: `-c search_path=${schema}` },
      stdio: ["ignore", "pipe", "pipe"],
    });
    stopped = once(child, "exit");
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Custom API startup timed out")), 20000);
      let output = "";
      child.stdout.on("data", data => { output += data; if (output.includes("Server listening")) { clearTimeout(timeout); resolve(); } });
      child.stderr.on("data", () => {});
      child.on("exit", () => { clearTimeout(timeout); reject(new Error("Custom API exited before ready")); });
    });
  };
  const stop = async () => { if (child) { child.kill("SIGTERM"); await stopped; child = null; } };
  const request = async (path, method = "GET", body, status = 200) => {
    const response = await fetch(`http://127.0.0.1:${port}/api${path}`, {
      method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = response.status === 204 ? null : await response.json();
    assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(data)}`);
    return data;
  };
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await start();
    const catalog = await request("/species");
    const base = { speciesId: null, name: "Моя невідома рослина", category: "HERB", location: "Мій дім", environmentType: "INDOOR", photoUrl: "https://example.com/legacy-photo.jpg" };
    for (const invalid of [
      { ...base, speciesId: undefined }, { ...base, category: undefined }, { ...base, category: null },
      { ...base, category: "Вигадана" }, { ...base, name: "" }, { ...base, name: " \t " },
      { ...base, personalName: "Псевдонім" }, { ...base, speciesId: catalog[0].id }, { ...base, speciesId: 999999, category: null },
    ]) await request("/plants", "POST", invalid, 400);
    const location = await request("/locations", "POST", { displayName: "Львів тест", latitude: 49.84, longitude: 24.03, isDefault: false }, 201);
    let plant = await request("/plants", "POST", { ...base, weatherLocationId: location.id }, 201);
    const plantId = plant.id;
    const placeId = plant.placeId;
    assert.equal(plant.identityKind, "CUSTOM");
    assert.equal(plant.speciesId, null);
    assert.equal(plant.speciesName, null);
    assert.equal(plant.categoryLabel, "Зелень / пряна культура");
    assert.deepEqual(plant.allowedCareTypes, ["SOWING", "PLANTING", "WATERING", "FERTILIZING", "HARVEST"]);
    assert.equal((await request(`/plants/${plantId}`)).species, null);
    assert.ok((await request(`/plants?category=HERB&search=${encodeURIComponent("невідома")}`)).some(p => p.id === plantId));
    assert.deepEqual(await request(`/plants/${plantId}/care-plan`), []);
    const counts = async () => (await client.query("SELECT (SELECT count(*) FROM flora_tasks)::int AS tasks, (SELECT count(*) FROM flora_reminders)::int AS reminders")).rows[0];
    const beforeAdvice = await counts();
    const generic = await request("/recommendations", "POST", { plantId }, 201);
    assert.match(generic.warning, /демонстраційний/);
    assert.match(generic.recommendations[0].explanation, /Видових даних немає/);
    assert.equal(generic.recommendations[0].actionable, false);
    assert.deepEqual(await counts(), beforeAdvice);
    await request(`/plants/${plantId}/care-plan`, "POST", { items: [{ type: "WATERING", scheduledDate: "2026-12-01", reason: "Вигаданий інтервал", eligibilityVersion: "fake" }] }, 400);
    const date = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const input = type => ({ plantId, type, scheduledDate: date, priority: "MEDIUM", notes: "Тест" });
    await request("/tasks", "POST", input("PRUNING"), 400);
    const watering = await request("/tasks", "POST", input("WATERING"), 201);
    await request(`/tasks/${watering.id}/complete`, "POST", { comment: "Фактичний догляд" });
    assert.ok((await request("/history")).some(log => log.plantId === plantId));
    const harvest = await request("/tasks", "POST", input("HARVEST"), 201);
    assert.ok((await request("/reminders")).some(r => r.taskId === harvest.id));
    assert.ok((await request("/tasks")).some(t => t.id === harvest.id));
    assert.ok((await request("/dashboard")).upcomingTasks.some(task => task.plantId === plantId));
    await request("/statistics");
    await request("/reports", "POST", { periodStart: date, periodEnd: tomorrow }, 201);
    const historyAdvice = await request("/recommendations", "POST", { plantId }, 201);
    assert.match(historyAdvice.recommendations[0].explanation, /Останній виконаний полив/);
    assert.doesNotMatch(historyAdvice.recommendations[0].explanation, /інтервал виду —/);
    // Exposed custom plants use generic weather rules; confirming applies only a current context.
    const outside = await request("/plants", "POST", { ...base, name: "Невідома надворі", environmentType: "OUTDOOR", weatherLocationId: location.id }, 201);
    const weatherInfo = await request("/recommendations", "POST", { plantId: outside.id }, 201);
    const rainy = weatherInfo.weather.forecast.find((day, index, days) => day.precipitation >= 8 && days.slice(index + 1).some(next => next.precipitation < 8));
    assert.ok(rainy, "Mock forecast provides a rainy day followed by a suitable general-rule day");
    const outdoorTask = await request("/tasks", "POST", { ...input("WATERING"), plantId: outside.id, scheduledDate: rainy.date }, 201);
    const outdoorAdvice = await request("/recommendations", "POST", { plantId: outside.id }, 201);
    const move = outdoorAdvice.recommendations.find(rec => rec.relatedTaskId === outdoorTask.id && rec.suggestedDate);
    assert.ok(move?.actionable);
    assert.match(move.explanation, /загальні погодні правила/);
    assert.equal((await request(`/tasks?plantId=${outside.id}`))[0].scheduledDate, rainy.date);
    await request(`/tasks/${outdoorTask.id}`, "PATCH", { priority: "HIGH" });
    assert.equal((await request(`/recommendations?plantId=${outside.id}`)).find(rec => rec.id === move.id).actionable, false);
    await request(`/recommendations/${move.id}/apply`, "POST", {}, 400);
    const freshMove = (await request("/recommendations", "POST", { plantId: outside.id }, 201)).recommendations.find(rec => rec.suggestedDate);
    const applied = await request(`/recommendations/${freshMove.id}/apply`, "POST", {});
    assert.equal(applied.scheduledDate, freshMove.suggestedDate);
    assert.equal((await request("/reminders")).find(rec => rec.taskId === outdoorTask.id).reminderDate, applied.scheduledDate);
    // Reversed custom-category edits invalidate advice even when activity sets coincide.
    await request(`/tasks/${outdoorTask.id}`, "PATCH", { scheduledDate: rainy.date });
    const beforeCategory = (await request("/recommendations", "POST", { plantId: outside.id }, 201)).recommendations.find(rec => rec.suggestedDate);
    await request(`/plants/${outside.id}`, "PATCH", { category: "VEGETABLE" });
    await request(`/plants/${outside.id}`, "PATCH", { category: "HERB" });
    await request(`/recommendations/${beforeCategory.id}/apply`, "POST", {}, 400);
    // Indoor/greenhouse use the same forecast without treating outside rain as exposure.
    await request(`/plants/${outside.id}`, "PATCH", { environmentType: "GREENHOUSE" });
    assert.ok((await request("/recommendations", "POST", { plantId: outside.id }, 201)).recommendations.every(rec => rec.type !== "WEATHER_RESCHEDULE"));
    const noSpeciesCount = (await request("/species")).length;
    plant = await request(`/plants/${plantId}`, "PATCH", { name: "  Нова назва  " });
    assert.equal(plant.name, "Нова назва");
    assert.equal(plant.speciesId, null);
    assert.equal(plant.placeId, placeId);
    assert.equal(plant.photoUrl, base.photoUrl);
    assert.equal(plant.weatherLocationId, location.id);
    for (const invalid of [{ name: " " }, { category: null }, { category: "invalid" }, { speciesId: catalog[0].id, category: "HERB" }]) {
      await request(`/plants/${plantId}`, "PATCH", invalid, 400);
    }
    plant = await request(`/plants/${plantId}`, "PATCH", { category: "INDOOR_DECORATIVE" });
    await request(`/tasks/${harvest.id}`, "PATCH", { scheduledDate: tomorrow }, 400);
    await request(`/tasks/${harvest.id}/complete`, "POST", {});
    assert.ok((await request(`/plants/${plantId}`)).history.some(log => log.taskId === harvest.id));
    assert.equal((await request(`/recommendations?plantId=${plantId}`))[0].actionable, false);
    // Category restoration must not reactivate saved advice.
    plant = await request(`/plants/${plantId}`, "PATCH", { category: "HERB" });
    assert.ok((await request(`/recommendations?plantId=${plantId}`)).every(rec => rec.staleReason));
    const linked = await request(`/plants/${plantId}`, "PATCH", { speciesId: catalog[0].id });
    assert.equal(linked.identityKind, "LINKED");
    assert.equal(linked.category, catalog[0].category);
    assert.equal(linked.name, catalog[0].name);
    await request(`/plants/${plantId}`, "PATCH", { speciesId: null }, 400);
    plant = await request(`/plants/${plantId}`, "PATCH", { speciesId: null, name: "Моя рослина", category: "HERB" });
    assert.equal((await request("/species")).length, noSpeciesCount);
    // Foreign places, locations, plants and uploaded photos are rejected even in custom mode.
    const owner = (await request("/me")).id;
    const other = (await client.query("INSERT INTO flora_users(clerk_user_id,username,email) VALUES ('other-custom-owner','Інший','other@test.invalid') RETURNING id")).rows[0].id;
    const foreignPlace = (await client.query("INSERT INTO flora_plant_places(user_id,name,environment_type) VALUES ($1,'Чуже місце','OUTDOOR') RETURNING id", [other])).rows[0].id;
    const foreignLoc = (await client.query("INSERT INTO flora_saved_locations(user_id,display_name,latitude,longitude) VALUES ($1,'Чужа локація',1,2) RETURNING id", [other])).rows[0].id;
    await request("/plants", "POST", { ...base, placeId: foreignPlace }, 400);
    await request(`/plants/${plantId}`, "PATCH", { weatherLocationId: foreignLoc }, 400);
    await request("/plants", "POST", { ...base, photoObjectPath: `/objects/photos/${randomUUID()}` }, 400);
    await client.query("UPDATE flora_plants SET user_id=$1 WHERE id=$2", [other, plantId]);
    await request(`/plants/${plantId}`, "GET", undefined, 404);
    await request(`/plants/${plantId}`, "PATCH", { name: "Не можна" }, 404);
    await request(`/plants/${plantId}`, "DELETE", undefined, 404);
    await client.query("UPDATE flora_plants SET user_id=$1 WHERE id=$2", [owner, plantId]);
    // Both migrated custom rows and every existing row/task remain identical after reruns.
    const before = (await client.query("SELECT * FROM flora_plants ORDER BY id")).rows;
    const tasksBefore = (await client.query("SELECT * FROM flora_tasks ORDER BY id")).rows;
    await stop(); await start(); await stop(); await start();
    assert.deepEqual((await client.query("SELECT * FROM flora_plants ORDER BY id")).rows, before);
    assert.deepEqual((await client.query("SELECT * FROM flora_tasks ORDER BY id")).rows, tasksBefore);
    assert.equal((await client.query("SELECT count(*)::int AS n FROM flora_schema_migrations WHERE version='custom-plant-identity'")).rows[0].n, 1);
    assert.equal((await request(`/plants/${plantId}`)).identityKind, "CUSTOM");
    await request(`/plants/${plantId}`, "DELETE", undefined, 204);
    await request(`/plants/${plantId}`, "GET", undefined, 404);
  } finally {
    await stop();
    await client.query("SET search_path TO public");
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    client.release(); await pool.end();
  }
});
