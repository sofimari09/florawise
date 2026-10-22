import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import pg from "pg";

test("category API enforces current eligibility, safe history, stale previews/advice, rules and combined filters", async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  const schema = `category_api_${randomUUID().replaceAll("-", "")}`;
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  let child, stopped;
  const request = async (path, method = "GET", body, status = 200) => {
    const response = await fetch(`http://127.0.0.1:${port}/api${path}`, {
      method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const responseText = response.status === 204 ? "" : await response.text();
    let data = null;
    if (responseText) {
      try {
        data = JSON.parse(responseText);
      } catch {
        throw new Error(`${method} ${path} returned non-JSON (${response.status}): ${responseText.slice(0, 240)}`);
      }
    }
    assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(data)}`);
    return data;
  };
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    child = spawn(process.execPath, ["dist/index.mjs"], {
      env: { ...process.env, NODE_ENV: "development", PORT: String(port), PGOPTIONS: `-c search_path=${schema}` },
      stdio: ["ignore", "pipe", "pipe"],
    });
    stopped = once(child, "exit");
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Isolated category API startup timed out")), 20000);
      let output = "";
      child.stdout.on("data", data => { output += data; if (output.includes("Server listening")) { clearTimeout(timeout); resolve(); } });
      child.stderr.on("data", () => {});
      child.on("exit", () => { clearTimeout(timeout); reject(new Error("Isolated category API exited before ready")); });
    });
    await client.query("UPDATE flora_users SET role='ADMIN' WHERE clerk_user_id='preview-demo-user'");
    const catalog = await request("/species");
    assert.ok(catalog.every(species => species.category && species.categoryLabel && Array.isArray(species.allowedCareTypes)));
    const template = catalog.find(species => species.name === "Монстера");
    const knowledge = await request(`/species/${template.id}/knowledge`);
    const wateringRule = knowledge.careRules.find(rule => rule.careType === "WATERING");
    assert.equal(wateringRule.ruleCode, "SOIL_DRYNESS");
    assert.match(wateringRule.triggerDescription, /підсохла/);
    assert.deepEqual(wateringRule.sourceCodes, ["S01"]);
    assert.equal(knowledge.sources[0].sourceCode, "S01");
    assert.ok(knowledge.sources[0].organization && knowledge.sources[0].citation && knowledge.sources[0].sourceUrl);
    const blackcurrant = catalog.find(species => species.speciesCode === "BLACKCURRANT");
    const blackcurrantPlant = await request("/plants", "POST", {
      speciesId: blackcurrant.id, personalName: null, location: "Тест інтервалу", environmentType: "OUTDOOR", photoUrl: "",
      weatherLocationName: "Тестова погодна локація", weatherLatitude: 49.84, weatherLongitude: 24.03,
    }, 201);
    const blackcurrantPlan = await request(`/plants/${blackcurrantPlant.id}/care-plan`);
    assert.ok(blackcurrantPlan.some(item => item.type === "WATERING"
      && /Інтервал за джерелом — 7 днів/.test(item.reason)
      && /Нова рослина, контейнер або тривала посуха/.test(item.reason)));
    const todayParts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map(part => [part.type, part.value]));
    const today = `${todayParts.year}-${todayParts.month}-${todayParts.day}`;
    const previousWatering = await request("/tasks", "POST", {
      plantId: blackcurrantPlant.id, type: "WATERING", scheduledDate: today, priority: "LOW", notes: "",
    }, 201);
    await request(`/tasks/${previousWatering.id}/complete`, "POST", {}, 200);
    await client.query("UPDATE flora_care_logs SET completed_at = NOW() - INTERVAL '8 days' WHERE task_id = $1", [previousWatering.id]);
    const nextWatering = await request("/tasks", "POST", {
      plantId: blackcurrantPlant.id, type: "WATERING", scheduledDate: today, priority: "LOW", notes: "",
    }, 201);
    const recommendationResult = await request("/recommendations", "POST", { plantId: blackcurrantPlant.id, weatherScenario: "RAIN_TOMORROW" }, 201);
    const wateringAdvice = recommendationResult.recommendations.find(item => item.relatedTaskId === nextWatering.id);
    assert.ok(wateringAdvice, "the saved task receives a generated care recommendation");
    assert.ok(["HIGH", "URGENT"].includes(wateringAdvice.priority));
    assert.match(wateringAdvice.explanation, /останній догляд «Полив» виконано/);
    assert.match(wateringAdvice.explanation, /8 дн\. тому.*інтервал за правилом виду — 7 дн\./);
    assert.match(wateringAdvice.explanation, /Локація: «Тестова погодна локація»/);
    assert.match(wateringAdvice.explanation, /Середовище: надворі/);
    const monsteraPlant = await request("/plants", "POST", {
      speciesId: template.id, personalName: null, location: "Тест умови", environmentType: "INDOOR", photoUrl: "",
    }, 201);
    const monsteraPlan = await request(`/plants/${monsteraPlant.id}/care-plan`);
    assert.ok(!monsteraPlan.some(item => item.type === "WATERING"), "condition-only watering guidance must not create a scheduled watering task");
    const { id: _id, category: _category, ...withoutCategory } = template;
    await request("/species", "POST", { ...withoutCategory, name: "Без категорії" }, 400);
    await request("/species", "POST", { ...template, category: "Не категорія" }, 400);
    await request("/species", "POST", { ...template, applicableCareTypes: ["HARVEST"] }, 400);
    const expected = {
      INDOOR_DECORATIVE: ["WATERING", "FERTILIZING", "PRUNING", "TRANSPLANTING", "TREATMENT"],
      OUTDOOR_DECORATIVE: ["WATERING", "FERTILIZING", "PRUNING", "TRANSPLANTING", "TREATMENT"],
      FRUIT_TREE: ["WATERING", "FERTILIZING", "PRUNING", "TREATMENT", "HARVEST"],
      BERRY_SHRUB: ["WATERING", "FERTILIZING", "PRUNING", "TREATMENT", "HARVEST", "PLANTING"],
      VEGETABLE: ["SOWING", "PLANTING", "WATERING", "FERTILIZING", "TREATMENT", "HARVEST"],
      HERB: ["SOWING", "PLANTING", "WATERING", "FERTILIZING", "HARVEST"],
    };
    const allTypes = ["WATERING", "FERTILIZING", "PRUNING", "TRANSPLANTING", "TREATMENT", "HARVEST", "SOWING", "PLANTING"];
    const fixturePlants = {}, fixtureSpecies = {}, fixtureTasks = {};
    const date = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const taskInput = (plantId, type) => ({ plantId, type, scheduledDate: date, priority: "MEDIUM", notes: "тест" });
    for (const [category, allowed] of Object.entries(expected)) {
      const species = await request("/species", "POST", { ...template, name: `Тест ${category}`, category, applicableCareTypes: null, fertilizingFrequencyDays: 30 }, 201);
      fixtureSpecies[category] = species;
      assert.deepEqual(species.allowedCareTypes, allowed);
      const plant = await request("/plants", "POST", { speciesId: species.id, personalName: "Яблуня — довільний псевдонім", location: `Тест ${category}`, environmentType: "OUTDOOR", photoUrl: "" }, 201);
      fixturePlants[category] = plant;
      assert.equal(plant.category, category);
      assert.equal(plant.categoryLabel, species.categoryLabel);
      for (const type of allTypes) {
        const before = (await client.query("SELECT count(*)::int AS n FROM flora_tasks")).rows[0].n;
        const reminders = (await client.query("SELECT count(*)::int AS n FROM flora_reminders")).rows[0].n;
        const result = await request("/tasks", "POST", taskInput(plant.id, type), allowed.includes(type) ? 201 : 400);
        if (!allowed.includes(type)) {
          assert.match(result.error, /не застосовується/);
          assert.equal((await client.query("SELECT count(*)::int AS n FROM flora_tasks")).rows[0].n, before);
          assert.equal((await client.query("SELECT count(*)::int AS n FROM flora_reminders")).rows[0].n, reminders);
        } else fixtureTasks[`${category}:${type}`] = result;
      }
      const speciesFilter = await request(`/species?category=${category}&search=${encodeURIComponent("Тест")}`);
      assert.ok(speciesFilter.every(item => item.category === category));
      const plantFilter = await request(`/plants?category=${category}&search=${encodeURIComponent("довільний")}`);
      assert.equal(plantFilter.length, 1);
      assert.equal(plantFilter[0].id, plant.id);
    }
    const indoor = fixturePlants.INDOOR_DECORATIVE;
    const indoorSpecies = fixtureSpecies.INDOOR_DECORATIVE;
    const watering = fixtureTasks["INDOOR_DECORATIVE:WATERING"];
    const counts = async () => (await client.query("SELECT (SELECT count(*) FROM flora_tasks)::int AS tasks, (SELECT count(*) FROM flora_reminders)::int AS reminders")).rows[0];
    await request("/tasks", "POST", taskInput(indoor.id, "ARBITRARY"), 400);
    await request(`/tasks/${watering.id}`, "PATCH", { type: "HARVEST" }, 400);
    const sowing = fixtureTasks["HERB:SOWING"];
    await request(`/tasks/${sowing.id}`, "PATCH", { plantId: fixturePlants.FRUIT_TREE.id }, 400);
    const filtered = await request(`/tasks?type=SOWING&status=PLANNED&plantId=${fixturePlants.HERB.id}&from=${date}&to=${date}`);
    assert.deepEqual(filtered.map(task => task.id), [sowing.id]);
    const preview = await request(`/plants/${indoor.id}/care-plan`);
    const beforePreview = await counts();
    await request(`/plants/${indoor.id}/care-plan`);
    assert.deepEqual(await counts(), beforePreview);
    const weatherRule = { careType: "SOWING", rainThresholdMm: 1, maxWindSpeedMps: null, minTemperature: null, maxTemperature: null, notes: null };
    await request(`/species/${indoorSpecies.id}/knowledge`, "PUT", { careRules: [weatherRule], sources: [] }, 400);
    await request(`/species/${indoorSpecies.id}`, "PATCH", { applicableCareTypes: ["HARVEST"] }, 400);
    await request(`/species/${indoorSpecies.id}`, "PATCH", { applicableCareTypes: [] });
    assert.deepEqual((await request(`/plants/${indoor.id}`)).allowedCareTypes, []);
    assert.deepEqual(await request(`/plants/${indoor.id}/care-plan`), []);
    await request(`/plants/${indoor.id}/care-plan`, "POST", { items: preview }, 400);
    await request(`/tasks/${watering.id}`, "PATCH", { scheduledDate: tomorrow }, 400);
    assert.deepEqual(await counts(), beforePreview);
    await request(`/species/${indoorSpecies.id}`, "PATCH", { applicableCareTypes: null });
    await request(`/plants/${indoor.id}/care-plan`, "POST", { items: preview }, 400);
    const fresh = await request(`/plants/${indoor.id}/care-plan`);
    await request(`/plants/${indoor.id}`, "PATCH", { speciesId: fixtureSpecies.FRUIT_TREE.id });
    await request(`/plants/${indoor.id}`, "PATCH", { speciesId: indoorSpecies.id });
    await request(`/plants/${indoor.id}/care-plan`, "POST", { items: fresh }, 400);
    // Planned work is excluded from previews; close one type to make a new proposal.
    await request(`/tasks/${fixtureTasks["INDOOR_DECORATIVE:FERTILIZING"].id}`, "DELETE", undefined, 204);
    const currentPreview = await request(`/plants/${indoor.id}/care-plan`);
    const created = await request(`/plants/${indoor.id}/care-plan`, "POST", { items: currentPreview }, 201);
    assert.equal(created.length, 1);
    // Task context changed on confirmation: replaying the old preview is stale.
    await request(`/plants/${indoor.id}/care-plan`, "POST", { items: currentPreview }, 400);
    await request(`/plants/${indoor.id}/care-plan`, "POST", { items: [{ ...currentPreview[0], type: "TREATMENT" }] }, 400);
    const legacy = (await client.query("INSERT INTO flora_tasks(plant_id,type,scheduled_date,notes) VALUES($1,'HARVEST',$2,'історичне завдання') RETURNING *", [indoor.id, date])).rows[0];
    await client.query("INSERT INTO flora_reminders(task_id,reminder_date) VALUES($1,$2)", [legacy.id, date]);
    assert.ok((await request(`/tasks?type=HARVEST&plantId=${indoor.id}`)).some(task => task.id === legacy.id));
    await request(`/tasks/${legacy.id}`, "PATCH", { type: "HARVEST", scheduledDate: tomorrow }, 400);
    await request(`/tasks/${legacy.id}`, "PATCH", { plantId: indoor.id, type: "HARVEST", scheduledDate: date, status: "COMPLETED" });
    assert.ok((await request(`/plants/${indoor.id}`)).history.some(log => log.taskId === legacy.id));
    await request(`/tasks/${legacy.id}`, "PATCH", { status: "PLANNED" }, 400);
    const legacy2 = (await client.query("INSERT INTO flora_tasks(plant_id,type,scheduled_date) VALUES($1,'HARVEST',$2) RETURNING id", [indoor.id, date])).rows[0];
    await request(`/tasks/${legacy2.id}/complete`, "POST", {}, 200);
    const legacy3 = (await client.query("INSERT INTO flora_tasks(plant_id,type,scheduled_date) VALUES($1,'HARVEST',$2) RETURNING id", [indoor.id, date])).rows[0];
    await request(`/tasks/${legacy3.id}`, "DELETE", undefined, 204);
    const rule = { ...weatherRule, careType: "WATERING" };
    await request(`/species/${indoorSpecies.id}/knowledge`, "PUT", { careRules: [rule], sources: [] });
    // Atomic administration can remove the existing rule and narrow applicability in one request.
    await request(`/species/${indoorSpecies.id}`, "PATCH", { applicableCareTypes: ["PRUNING"], knowledge: { careRules: [], sources: [] } });
    assert.deepEqual((await request(`/species/${indoorSpecies.id}/knowledge`)).careRules, []);
    assert.deepEqual((await request(`/plants/${indoor.id}`)).allowedCareTypes, ["PRUNING"]);
    const [saved] = (await client.query(`INSERT INTO flora_recommendations(plant_id,type,text,priority,related_task_id,explanation,original_date,suggested_date,eligibility_version,care_type)
      VALUES($1,'WEATHER_RESCHEDULE','історична порада','HIGH',$2,'тест',$3,$4,$5,'WATERING') RETURNING id`,
      [indoor.id, watering.id, date, tomorrow, currentPreview[0].eligibilityVersion])).rows;
    const rec = (await request(`/recommendations?plantId=${indoor.id}`)).find(rec => rec.id === saved.id);
    assert.equal(rec.actionable, false);
    assert.match(rec.staleReason, /Застосовність/);
    const beforeAdvice = await counts();
    await request(`/recommendations/${saved.id}/apply`, "POST", {}, 409);
    assert.deepEqual(await counts(), beforeAdvice);
    assert.equal((await client.query("SELECT scheduled_date::text FROM flora_tasks WHERE id=$1", [watering.id])).rows[0].scheduled_date, date);
    // A fresh saved eligible recommendation is actionable, then becomes stale after a same-set refinement edit.
    const herb = fixturePlants.HERB;
    await request(`/tasks/${fixtureTasks["HERB:FERTILIZING"].id}`, "DELETE", undefined, 204);
    await request(`/plants/${herb.id}`, "PATCH", { environmentType: "INDOOR" });
    const herbPreview = await request(`/plants/${herb.id}/care-plan`);
    const herbWater = fixtureTasks["HERB:WATERING"];
    const [good] = (await client.query(`INSERT INTO flora_recommendations(plant_id,type,text,priority,related_task_id,explanation,original_date,suggested_date,eligibility_version,care_type)
      VALUES($1,'WEATHER_RESCHEDULE','перенесення','HIGH',$2,'тест',$3,$4,$5,'WATERING') RETURNING id`,
      [herb.id, herbWater.id, date, tomorrow, herbPreview[0].eligibilityVersion])).rows;
    const indoorWeatherAdvice = (await request(`/recommendations?plantId=${herb.id}`)).find(rec => rec.id === good.id);
    assert.equal(indoorWeatherAdvice.actionable, false);
    assert.match(indoorWeatherAdvice.staleReason, /Зовнішній прогноз/);
    await request(`/recommendations/${good.id}/apply`, "POST", {}, 409);
    assert.equal((await request(`/tasks?plantId=${herb.id}&type=WATERING`))[0].scheduledDate, date);
  } finally {
    if (child) {
      child.kill("SIGTERM"); const forced = setTimeout(() => child.kill("SIGKILL"), 2000);
      await stopped; clearTimeout(forced);
    }
    await client.query("SET search_path TO public");
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    client.release(); await pool.end();
  }
});
