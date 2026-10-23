import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import pg from "pg";

function dateAtKyivOffset(offset) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date()).map(({ type, value }) => [type, value]));
  const date = new Date(`${parts.year}-${parts.month}-${parts.day}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

test("saved care reports use inclusive dates, consistent status metrics, and refresh their full snapshot on upsert", { timeout: 150_000 }, async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  const schema = `flora_reports_${randomUUID().replaceAll("-", "")}`;
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  let child;
  let output = "";
  const start = async () => {
    child = spawn(process.execPath, ["dist/index.mjs"], {
      env: { ...process.env, NODE_ENV: "development", PORT: String(port), PGOPTIONS: `-c search_path=${schema}` },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", data => { output += data.toString(); });
    child.stderr.on("data", data => { output += data.toString(); });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Reports API startup timed out:\n${output}`)), 30_000);
      const check = () => {
        if (output.includes("Server listening")) {
          clearTimeout(timeout);
          resolve();
        }
      };
      child.stdout.on("data", check);
      child.once("error", error => { clearTimeout(timeout); reject(error); });
      child.once("exit", code => {
        clearTimeout(timeout);
        reject(new Error(`Reports API exited (${code}):\n${output}`));
      });
      check();
    });
  };
  const base = `http://127.0.0.1:${port}/api`;
  const request = async (path, method = "GET", body, expected = 200) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : undefined; } catch { data = text; }
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(data)}`);
    return data;
  };
  const createPlant = (name, extra = {}) => request("/plants", "POST", {
    speciesId: null,
    name,
    category: "HERB",
    location: "Тестове місце",
    environmentType: "INDOOR",
    photoUrl: "https://example.invalid/report-plant.jpg",
    ...extra,
  }, 201);
  const createTask = (plantId, scheduledDate) => request("/tasks", "POST", {
    plantId,
    type: "WATERING",
    scheduledDate,
    priority: "MEDIUM",
    notes: "Тест звітів",
  }, 201);

  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await start();

    const plant = await createPlant("Тест звітів");
    const startDate = dateAtKyivOffset(-2);
    const endDate = dateAtKyivOffset(-1);
    const completed = await createTask(plant.id, startDate);
    const overdue = await createTask(plant.id, endDate);
    const cancelled = await createTask(plant.id, endDate);
    const outsideBefore = await createTask(plant.id, dateAtKyivOffset(-3));
    const outsideAfter = await createTask(plant.id, dateAtKyivOffset(1));
    await request(`/tasks/${completed.id}/complete`, "POST", { comment: "Виконано" });
    await request(`/tasks/${overdue.id}`, "PATCH", { scheduledDate: endDate, status: "POSTPONED" });
    await request(`/tasks/${cancelled.id}`, "DELETE", undefined, 204);

    const report = await request("/reports", "POST", { periodStart: startDate, periodEnd: endDate }, 201);
    assert.equal(report.taskCount, 2, "only the two non-cancelled tasks in the inclusive period are counted");
    assert.equal(report.completed, 1);
    assert.equal(report.overdue, 1, "an active task before the Kyiv report-creation date is overdue");
    assert.equal(report.postponed, 1);
    assert.equal(report.cancelled, 1, "cancellations are reported separately");
    assert.equal(report.completionRate, 50, "cancelled tasks are excluded from the denominator");
    assert.equal(report.reportDetails.tasks.length, 3, "the report table still shows cancelled tasks");
    assert.deepEqual(
      report.reportDetails.tasks.map(task => task.taskId),
      [completed.id, overdue.id, cancelled.id],
      "start and end dates are inclusive; records outside the range are excluded",
    );
    assert.equal(report.reportDetails.byType[0]?.label, "Полив");
    assert.equal(report.reportDetails.byType[0]?.value, 2, "type breakdown excludes cancellations");
    assert.ok(report.reportDetails.byStatus.some(item => item.label === "CANCELLED" && item.value === 1));
    assert.equal(report.reportDetails.tasks.find(task => task.taskId === outsideBefore.id), undefined);
    assert.equal(report.reportDetails.tasks.find(task => task.taskId === outsideAfter.id), undefined);

    const reopened = (await request("/reports")).find(item => item.id === report.id);
    assert.equal(reopened.reportDetails.tasks.length, 3, "the detailed snapshot persists after a fresh GET");
    assert.equal(reopened.cancelled, 1);

    await request(`/tasks/${overdue.id}`, "PATCH", { scheduledDate: endDate, status: "COMPLETED" });
    const updated = await request("/reports", "POST", { periodStart: startDate, periodEnd: endDate }, 201);
    assert.equal(updated.id, report.id, "a repeated period updates the existing report");
    assert.equal(updated.taskCount, 2);
    assert.equal(updated.completed, 2);
    assert.equal(updated.overdue, 0);
    assert.equal(updated.postponed, 0);
    assert.equal(updated.cancelled, 1);
    assert.equal(updated.completionRate, 100);
    assert.equal(updated.reportDetails.tasks.find(task => task.taskId === overdue.id).status, "COMPLETED");

    const empty = await request("/reports", "POST", { periodStart: "2099-01-01", periodEnd: "2099-01-01" }, 201);
    assert.equal(empty.taskCount, 0);
    assert.equal(empty.completed, 0);
    assert.equal(empty.completionRate, 0, "empty reports do not divide by zero");
    assert.deepEqual(empty.reportDetails.tasks, []);

    await request("/reports", "POST", { periodStart: endDate, periodEnd: startDate }, 400);
    await request("/reports", "POST", { periodStart: "2026-02-30", periodEnd: "2026-03-01" }, 400);

    const location = await request("/locations", "POST", {
      displayName: "Тестова локація",
      latitude: 49.84,
      longitude: 24.03,
      isDefault: false,
    }, 201);
    const outdoor = await createPlant("Тест погодного перенесення", {
      environmentType: "OUTDOOR",
      weatherLocationId: location.id,
    });
    const weatherTask = await createTask(outdoor.id, dateAtKyivOffset(1));
    const scenario = await request("/recommendations", "POST", {
      plantId: outdoor.id,
      weatherScenario: "RAIN_TOMORROW",
    }, 201);
    const reschedule = scenario.recommendations.find(item => item.relatedTaskId === weatherTask.id && item.type === "WEATHER_RESCHEDULE");
    assert.ok(reschedule?.actionable, "the test forecast should produce an actionable rescheduling recommendation");
    await request(`/recommendations/${reschedule.id}/apply`, "POST", {}, 200);
    const today = dateAtKyivOffset(0);
    const weatherReport = await request("/reports", "POST", { periodStart: today, periodEnd: today }, 201);
    assert.equal(weatherReport.reportDetails.weatherReschedules.length, 1);
    assert.equal(weatherReport.reportDetails.weatherReschedules[0].recommendationId, reschedule.id);
    assert.ok(weatherReport.recommendationSummary.includes("1"));
  } finally {
    if (child && child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5_000))]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    client.release();
    await pool.end();
  }
});
