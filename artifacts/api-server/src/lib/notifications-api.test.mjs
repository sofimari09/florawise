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

test("notifications persist, deduplicate, follow task/reminder changes, and stay user-scoped", { timeout: 150_000 }, async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  const schema = `flora_notifications_${randomUUID().replaceAll("-", "")}`;
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
      const timeout = setTimeout(() => reject(new Error(`Notification API startup timed out:\n${output}`)), 30_000);
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
        reject(new Error(`Notification API exited (${code}):\n${output}`));
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
  const basePlant = {
    speciesId: null,
    category: "HERB",
    location: "Тестове місце",
    environmentType: "INDOOR",
    photoUrl: "https://example.invalid/test-plant.jpg",
  };
  const createPlant = (name, extra = {}) => request("/plants", "POST", { ...basePlant, name, ...extra }, 201);
  const createTask = (plantId, scheduledDate) => request("/tasks", "POST", {
    plantId,
    type: "WATERING",
    scheduledDate,
    priority: "MEDIUM",
    notes: "Notification integration test",
  }, 201);

  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await start();

    const plant = await createPlant("Тест сповіщень");
    const upcoming = await createTask(plant.id, dateAtKyivOffset(1));
    const firstFeed = await request("/notifications");
    const upcomingRecord = firstFeed.notifications.find(item => item.taskId === upcoming.id && item.type === "UPCOMING_TASK");
    assert.ok(upcomingRecord, "tomorrow task should create an upcoming notification");
    assert.equal(upcomingRecord.isRead, false);
    const afterRepeat = await request("/notifications");
    assert.equal(afterRepeat.notifications.filter(item => item.taskId === upcoming.id && item.type === "UPCOMING_TASK").length, 1);

    const beforeRead = afterRepeat.unreadCount;
    const marked = await request(`/notifications/${upcomingRecord.id}`, "PATCH", { read: true });
    assert.equal(marked.isRead, true);
    const afterRead = await request("/notifications");
    assert.equal(afterRead.notifications.find(item => item.id === upcomingRecord.id).isRead, true);
    assert.equal(afterRead.unreadCount, beforeRead - 1);
    const allRead = await request("/notifications/read-all", "POST", {});
    assert.ok(allRead.updated >= 0);
    assert.equal((await request("/notifications")).unreadCount, 0);

    const overdue = await createTask(plant.id, dateAtKyivOffset(-1));
    const overdueFeed = await request("/notifications");
    assert.ok(overdueFeed.notifications.some(item => item.taskId === overdue.id && item.type === "OVERDUE_TASK"));

    const completedSoon = await createTask(plant.id, dateAtKyivOffset(1));
    const beforeComplete = await request("/notifications");
    const completionNotice = beforeComplete.notifications.find(item => item.taskId === completedSoon.id && item.type === "UPCOMING_TASK");
    assert.ok(completionNotice);
    await request(`/tasks/${completedSoon.id}/complete`, "POST", { comment: "Виконано" });
    const afterComplete = await request("/notifications");
    const dismissedNotice = afterComplete.notifications.find(item => item.id === completionNotice.id);
    assert.ok(dismissedNotice?.staleAt, "completed task notification should be marked historical");
    assert.equal(dismissedNotice.isRead, true);

    const manual = await createTask(plant.id, dateAtKyivOffset(4));
    const originalDate = manual.scheduledDate;
    const movedDate = dateAtKyivOffset(5);
    await request(`/tasks/${manual.id}`, "PATCH", { scheduledDate: movedDate, status: "POSTPONED" });
    const reminders = await request("/reminders");
    assert.equal(reminders.find(item => item.taskId === manual.id)?.reminderDate, movedDate);
    const manualFeed = await request("/notifications");
    const manualNotices = manualFeed.notifications.filter(item => item.taskId === manual.id && item.type === "MANUAL_RESCHEDULED");
    assert.equal(manualNotices.length, 1);
    const dateLabel = value => new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "long", timeZone: "Europe/Kyiv" })
      .format(new Date(`${value}T12:00:00.000Z`));
    assert.ok(manualNotices[0].message.includes(dateLabel(originalDate)));
    assert.ok(manualNotices[0].message.includes(dateLabel(movedDate)));
    await request("/notifications");
    assert.equal((await request("/notifications")).notifications.filter(item => item.taskId === manual.id && item.type === "MANUAL_RESCHEDULED").length, 1);

    const location = await request("/locations", "POST", {
      displayName: "Тестова локація",
      latitude: 49.84,
      longitude: 24.03,
      isDefault: false,
    }, 201);
    const outdoor = await createPlant("Тестова рослина надворі", {
      environmentType: "OUTDOOR",
      weatherLocationId: location.id,
    });
    const weatherTask = await createTask(outdoor.id, dateAtKyivOffset(1));
    const scenario = await request("/recommendations", "POST", {
      plantId: outdoor.id,
      weatherScenario: "RAIN_TOMORROW",
    }, 201);
    const reschedule = scenario.recommendations.find(item => item.relatedTaskId === weatherTask.id && item.type === "WEATHER_RESCHEDULE");
    assert.ok(reschedule?.actionable, "deterministic scenario should produce an actionable recommendation");
    assert.equal((await request("/notifications")).notifications.some(item => item.recommendationId === reschedule.id), false,
      "development mock forecast must not create a weather alert");
    await request(`/recommendations/${reschedule.id}/apply`, "POST", {}, 200);
    const appliedFeed = await request("/notifications");
    const confirmation = appliedFeed.notifications.filter(item => item.recommendationId === reschedule.id && item.type === "WEATHER_RESCHEDULED");
    assert.equal(confirmation.length, 1);
    assert.equal((await request(`/tasks`)).find(item => item.id === weatherTask.id)?.scheduledDate, reschedule.suggestedDate);
    assert.equal((await request("/reminders")).find(item => item.taskId === weatherTask.id)?.reminderDate, reschedule.suggestedDate);

    const otherUser = await client.query(
      "INSERT INTO flora_users (clerk_user_id, username, email) VALUES ($1, $2, $3) RETURNING id",
      [`other-${randomUUID()}`, "Other user", "other@example.invalid"],
    );
    const foreign = await client.query(
      `INSERT INTO flora_notifications (user_id, type, title, message, dedupe_key)
       VALUES ($1, 'UPCOMING_TASK', 'Чуже сповіщення', 'Не повинно бути видно', $2) RETURNING id`,
      [otherUser.rows[0].id, `foreign-${randomUUID()}`],
    );
    const ownFeed = await request("/notifications");
    assert.equal(ownFeed.notifications.some(item => item.title === "Чуже сповіщення"), false);
    await request(`/notifications/${foreign.rows[0].id}`, "PATCH", { read: true }, 404);
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
