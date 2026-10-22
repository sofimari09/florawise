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
    const defaultLocation = await request("/locations", "POST", { displayName: "Забужжя", latitude: 50.48, longitude: 24.17, isDefault: true }, 201);
    const dashboardWeather = (await request("/dashboard?weatherScenario=RAIN_TOMORROW")).weather;
    assert.equal(dashboardWeather.location, "Забужжя");
    assert.equal(dashboardWeather.latitude, 50.48);
    assert.equal(dashboardWeather.longitude, 24.17);
    const defaultWeatherPlant = await request("/plants", "POST", { ...base, name: "Рослина без власної погодної локації" }, 201);
    assert.equal(defaultWeatherPlant.weatherLocationId, null);
    const defaultWeatherAdvice = await request("/recommendations", "POST", { plantId: defaultWeatherPlant.id, weatherScenario: "RAIN_TOMORROW" }, 201);
    assert.equal(defaultWeatherAdvice.weather.location, "Забужжя");
    assert.equal(defaultWeatherAdvice.weather.latitude, 50.48);
    assert.equal(defaultWeatherAdvice.weather.longitude, 24.17);
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
    const generic = await request("/recommendations", "POST", { plantId, weatherScenario: "RAIN_TOMORROW" }, 201);
    assert.equal(generic.warning, "Демонстраційні погодні дані");
    assert.match(generic.recommendations[0].explanation, /Видових даних немає/);
    assert.equal(generic.recommendations[0].actionable, false);
    assert.deepEqual(await counts(), beforeAdvice);
    await request(`/plants/${plantId}/care-plan`, "POST", { items: [{ type: "WATERING", scheduledDate: "2026-12-01", reason: "Вигаданий інтервал", eligibilityVersion: "fake" }] }, 400);
    const todayParts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map(part => [part.type, part.value]));
    const date = `${todayParts.year}-${todayParts.month}-${todayParts.day}`;
    const tomorrow = new Date(Date.parse(`${date}T00:00:00.000Z`) + 86400000).toISOString().slice(0, 10);
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
    const historyAdvice = await request("/recommendations", "POST", { plantId, weatherScenario: "RAIN_TOMORROW" }, 201);
    assert.match(historyAdvice.recommendations[0].explanation, /Останній виконаний полив/);
    assert.doesNotMatch(historyAdvice.recommendations[0].explanation, /інтервал виду —/);
    // Exposed custom plants use generic weather rules; confirming applies only a current context.
    const outside = await request("/plants", "POST", { ...base, name: "Невідома надворі", environmentType: "OUTDOOR", weatherLocationId: location.id }, 201);
    const weatherInfo = await request("/recommendations", "POST", { plantId: outside.id, weatherScenario: "RAIN_TOMORROW" }, 201);
    assert.equal(weatherInfo.weather.location, "Львів тест");
    assert.equal(weatherInfo.weather.latitude, 49.84);
    assert.equal(weatherInfo.weather.longitude, 24.03);
    assert.equal(weatherInfo.warning, "Демонстраційні погодні дані");
    // Deterministic development-only scenario: an outdoor watering task tomorrow sees 10.3 mm,
    // then the next day is dry. Generation must not mutate the task; confirmation applies it.
    const afterTomorrow = new Date(Date.parse(`${tomorrow}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    const outdoorTask = await request("/tasks", "POST", { ...input("WATERING"), plantId: outside.id, scheduledDate: tomorrow }, 201);
    const beforeAdviceCounts = await counts();
    const scenario = "RAIN_TOMORROW";
    const outdoorAdvice = await request("/recommendations", "POST", { plantId: outside.id, weatherScenario: scenario }, 201);
    assert.equal(outdoorAdvice.weather.isMock, true);
    assert.equal(outdoorAdvice.warning, "Демонстраційні погодні дані");
    assert.equal(outdoorAdvice.weather.location, "Львів тест");
    assert.equal(outdoorAdvice.weather.latitude, 49.84);
    assert.equal(outdoorAdvice.weather.longitude, 24.03);
    assert.equal(outdoorAdvice.weather.forecast.find(day => day.date === tomorrow).precipitation, 10.3);
    const move = outdoorAdvice.recommendations.find(rec => rec.relatedTaskId === outdoorTask.id && rec.type === "WEATHER_RESCHEDULE");
    assert.ok(move?.actionable);
    assert.equal(move.originalDate, tomorrow);
    assert.equal(move.suggestedDate, afterTomorrow);
    assert.equal(move.careType, "WATERING");
    assert.equal(move.weather.precipitation, 10.3);
    assert.match(move.explanation, /опади 10.3 мм > порогу 8 мм/);
    assert.match(move.explanation, /демонстраційні погодні дані/);
    assert.deepEqual(await counts(), beforeAdviceCounts);
    assert.equal((await request(`/tasks?plantId=${outside.id}`)).find(task => task.id === outdoorTask.id).scheduledDate, tomorrow);
    assert.equal((await request("/reminders")).find(reminder => reminder.taskId === outdoorTask.id).reminderDate, tomorrow);
    const taskCountBeforeApply = (await request(`/tasks?plantId=${outside.id}`)).length;
    const reminderBeforeApply = (await request("/reminders")).find(reminder => reminder.taskId === outdoorTask.id);
    assert.ok(reminderBeforeApply);
    const applied = await request(`/recommendations/${move.id}/apply`, "POST", {});
    assert.equal(applied.scheduledDate, afterTomorrow);
    assert.equal(applied.status, "POSTPONED");
    assert.equal(applied.postponementCount, 1);
    const tasksAfterApply = await request(`/tasks?plantId=${outside.id}`);
    assert.equal(tasksAfterApply.length, taskCountBeforeApply);
    assert.equal(tasksAfterApply.filter(task => task.id === outdoorTask.id).length, 1);
    assert.equal(tasksAfterApply.find(task => task.id === outdoorTask.id).scheduledDate, afterTomorrow);
    const reminderAfterApply = (await request("/reminders")).find(reminder => reminder.taskId === outdoorTask.id);
    assert.equal(reminderAfterApply.id, reminderBeforeApply.id);
    assert.equal(reminderAfterApply.reminderDate, afterTomorrow);
    const appliedRecommendation = (await request(`/recommendations?plantId=${outside.id}`)).find(rec => rec.id === move.id);
    assert.equal(appliedRecommendation.applied, true);
    assert.equal(appliedRecommendation.originalDate, tomorrow);
    assert.equal(appliedRecommendation.suggestedDate, afterTomorrow);
    assert.ok(Number.isFinite(Date.parse(appliedRecommendation.appliedAt)));
    await stop();
    await start();
    assert.equal((await request(`/tasks?plantId=${outside.id}`)).find(task => task.id === outdoorTask.id).scheduledDate, afterTomorrow);
    assert.equal((await request("/reminders")).find(reminder => reminder.taskId === outdoorTask.id).reminderDate, afterTomorrow);
    const persistedRecommendation = (await request(`/recommendations?plantId=${outside.id}`)).find(rec => rec.id === move.id);
    assert.equal(persistedRecommendation.applied, true);
    assert.equal(persistedRecommendation.originalDate, tomorrow);
    assert.equal(persistedRecommendation.suggestedDate, afterTomorrow);
    assert.equal(persistedRecommendation.appliedAt, appliedRecommendation.appliedAt);
    // Reversed custom-category edits invalidate saved advice even when activity sets coincide.
    await request(`/tasks/${outdoorTask.id}`, "PATCH", { scheduledDate: tomorrow });
    const staleMove = (await request("/recommendations", "POST", { plantId: outside.id, weatherScenario: scenario }, 201)).recommendations.find(rec => rec.relatedTaskId === outdoorTask.id && rec.type === "WEATHER_RESCHEDULE");
    assert.ok(staleMove?.actionable);
    await request(`/tasks/${outdoorTask.id}`, "PATCH", { scheduledDate: afterTomorrow });
    const staleMoveView = (await request(`/recommendations?plantId=${outside.id}`)).find(rec => rec.id === staleMove.id);
    assert.equal(staleMoveView.actionable, false);
    assert.equal(staleMoveView.refreshable, true);
    assert.match(staleMoveView.staleReason, /Завдання вже перенесено/);
    const refreshed = await request(`/recommendations/${staleMove.id}/refresh`, "POST", {}, 200);
    assert.ok(refreshed.recommendations.every(rec => rec.type !== "WEATHER_RESCHEDULE"));
    assert.equal((await request(`/tasks?plantId=${outside.id}`)).find(item => item.id === outdoorTask.id).scheduledDate, afterTomorrow);
    assert.equal((await request("/reminders")).find(item => item.taskId === outdoorTask.id).reminderDate, afterTomorrow);
    const superseded = (await request(`/recommendations?plantId=${outside.id}`)).find(rec => rec.id === staleMove.id);
    assert.ok(superseded.supersededAt);
    assert.equal(superseded.refreshable, false);
    await request(`/recommendations/${staleMove.id}/refresh`, "POST", {}, 409);
    await request(`/tasks/${outdoorTask.id}`, "PATCH", { scheduledDate: tomorrow });
    const beforeCategory = (await request("/recommendations", "POST", { plantId: outside.id, weatherScenario: scenario }, 201)).recommendations.find(rec => rec.relatedTaskId === outdoorTask.id && rec.suggestedDate);
    const legacySeed = (await client.query(`INSERT INTO flora_recommendations(plant_id,generated_at,type,text,priority,related_task_id,explanation,original_date,suggested_date,weather_json)
      VALUES($1,NOW(),'WEATHER_RESCHEDULE','стара порада','HIGH',$2,'застарілий демонстраційний запис',$3,$4,'{}') RETURNING id`,
      [outside.id, outdoorTask.id, tomorrow, afterTomorrow])).rows[0];
    const legacyView = (await request(`/recommendations?plantId=${outside.id}`)).find(rec => rec.id === legacySeed.id);
    assert.equal(legacyView.actionable, false);
    assert.equal(legacyView.refreshable, true);
    assert.match(legacyView.staleReason, /без повного знімка плану/);
    const legacyRefresh = await request(`/recommendations/${legacySeed.id}/refresh`, "POST", { weatherScenario: scenario }, 200);
    assert.equal(legacyRefresh.recommendations[0].id, beforeCategory.id);
    assert.equal((await request(`/recommendations?plantId=${outside.id}`)).find(rec => rec.id === legacySeed.id).refreshable, false);
    await request(`/plants/${outside.id}`, "PATCH", { category: "VEGETABLE" });
    await request(`/plants/${outside.id}`, "PATCH", { category: "HERB" });
    await request(`/recommendations/${beforeCategory.id}/apply`, "POST", {}, 409);
    // The same rain does not move indoor care.
    const inside = await request("/plants", "POST", { ...base, name: "Невідома кімнатна", environmentType: "INDOOR" }, 201);
    const indoorTask = await request("/tasks", "POST", { ...input("WATERING"), plantId: inside.id, scheduledDate: tomorrow }, 201);
    const indoorAdvice = await request("/recommendations", "POST", { plantId: inside.id, weatherScenario: scenario }, 201);
    assert.ok(indoorAdvice.recommendations.every(rec => rec.type !== "WEATHER_RESCHEDULE"));
    assert.equal((await request(`/tasks?plantId=${inside.id}`)).find(task => task.id === indoorTask.id).scheduledDate, tomorrow);
    // The resolver follows the updated default immediately; the UI invalidates this same dashboard query on change.
    await request(`/locations/${location.id}`, "PATCH", { isDefault: true });
    const changedDefaultWeather = (await request("/dashboard?weatherScenario=RAIN_TOMORROW")).weather;
    assert.equal(changedDefaultWeather.location, "Львів тест");
    assert.equal(changedDefaultWeather.latitude, 49.84);
    assert.equal(changedDefaultWeather.longitude, 24.03);
    const changedDefaultAdvice = await request("/recommendations", "POST", { plantId: defaultWeatherPlant.id, weatherScenario: "RAIN_TOMORROW" }, 201);
    assert.equal(changedDefaultAdvice.weather.location, "Львів тест");
    assert.equal(changedDefaultAdvice.weather.latitude, 49.84);
    assert.equal(changedDefaultAdvice.weather.longitude, 24.03);
    assert.equal(defaultLocation.isDefault, true);
    // Indoor/greenhouse recommendations never reschedule on outside rain.
    await request(`/plants/${outside.id}`, "PATCH", { environmentType: "GREENHOUSE" });
    assert.ok((await request("/recommendations", "POST", { plantId: outside.id, weatherScenario: "RAIN_TOMORROW" }, 201)).recommendations.every(rec => rec.type !== "WEATHER_RESCHEDULE"));
    // A failed live provider never falls back to mock data or changes the existing task.
    const unavailablePlant = await request("/plants", "POST", { ...base, name: "Без прогнозу", environmentType: "OUTDOOR", weatherLocationId: location.id }, 201);
    const unavailableTask = await request("/tasks", "POST", { ...input("WATERING"), plantId: unavailablePlant.id, scheduledDate: tomorrow }, 201);
    await client.query("UPDATE flora_saved_locations SET latitude = 999 WHERE id = $1", [location.id]);
    const unavailableAdvice = await request("/recommendations", "POST", { plantId: unavailablePlant.id, weatherScenario: scenario }, 201);
    const unavailableMove = unavailableAdvice.recommendations.find(rec => rec.relatedTaskId === unavailableTask.id && rec.type === "WEATHER_RESCHEDULE");
    assert.ok(unavailableMove?.actionable);
    await client.query("UPDATE flora_recommendations SET weather_json = '{}' WHERE id = $1", [unavailableMove.id]);
    const recommendationsBeforeFailure = (await client.query("SELECT count(*)::int AS n FROM flora_recommendations")).rows[0].n;
    const noForecast = await request("/recommendations", "POST", { plantId: unavailablePlant.id }, 503);
    assert.doesNotMatch(noForecast.error, /Демонстраційні погодні дані/);
    assert.equal((await client.query("SELECT count(*)::int AS n FROM flora_recommendations")).rows[0].n, recommendationsBeforeFailure);
    const failedApply = await request(`/recommendations/${unavailableMove.id}/apply`, "POST", {}, 503);
    assert.match(failedApply.error, /Завдання не змінено/);
    assert.equal((await request(`/tasks?plantId=${unavailablePlant.id}`)).find(item => item.id === unavailableTask.id).scheduledDate, tomorrow);
    assert.equal((await request("/reminders")).find(item => item.taskId === unavailableTask.id).reminderDate, tomorrow);
    assert.equal((await request("/dashboard")).weather, null);
    await client.query("UPDATE flora_saved_locations SET latitude = $1 WHERE id = $2", [location.latitude, location.id]);
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
