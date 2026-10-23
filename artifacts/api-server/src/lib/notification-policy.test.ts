import assert from "node:assert/strict";
import { test } from "node:test";
import {
  notificationDateLabel,
  notificationEventHash,
  isCurrentRealWeatherNotification,
  taskNotificationDedupeKey,
  taskNotificationKind,
} from "./notification-policy";

test("upcoming and overdue reminders are derived only for active tasks", () => {
  const base = { status: "PLANNED", today: "2026-10-23", tomorrow: "2026-10-24" };
  assert.equal(taskNotificationKind({ ...base, scheduledDate: "2026-10-24", reminderDate: "2026-10-24" }), "UPCOMING_TASK");
  assert.equal(taskNotificationKind({ ...base, scheduledDate: "2026-10-23", reminderDate: "2026-10-23" }), "UPCOMING_TASK");
  assert.equal(taskNotificationKind({ ...base, status: "POSTPONED", scheduledDate: "2026-10-22", reminderDate: "2026-10-22" }), "OVERDUE_TASK");
  assert.equal(taskNotificationKind({ ...base, status: "COMPLETED", scheduledDate: "2026-10-24", reminderDate: "2026-10-24" }), null);
  assert.equal(taskNotificationKind({ ...base, status: "CANCELLED", scheduledDate: "2026-10-22" }), null);
  assert.equal(taskNotificationKind({ ...base, scheduledDate: "2026-10-25", reminderDate: "2026-10-25" }), null);
  assert.equal(taskNotificationKind({ ...base, scheduledDate: "2026-10-24" }), null);
});

test("event keys are stable for the same occurrence and change when the task date changes", () => {
  assert.equal(taskNotificationDedupeKey("UPCOMING_TASK", 17, "2026-10-24"), "upcoming_task:17:2026-10-24");
  assert.notEqual(taskNotificationDedupeKey("UPCOMING_TASK", 17, "2026-10-24"), taskNotificationDedupeKey("UPCOMING_TASK", 17, "2026-10-25"));
  assert.equal(notificationEventHash("warning|task-17"), notificationEventHash("warning|task-17"));
  assert.notEqual(notificationEventHash("warning|task-17"), notificationEventHash("warning|task-17|new-date"));
});

test("notification dates are formatted in Ukrainian without timezone day drift", () => {
  assert.equal(notificationDateLabel("2026-10-23"), "23 жовтня");
});

test("weather notifications require a current real forecast and an active recommendation", () => {
  const base = {
    recommendationType: "WEATHER_RESCHEDULE",
    relatedTaskId: 17,
    applied: false,
    superseded: false,
    generatedAtMs: 10_000,
    nowMs: 12_000,
    weatherIsMock: false,
    hasDevelopmentScenario: false,
    maxAgeMs: 5_000,
  };
  assert.equal(isCurrentRealWeatherNotification(base), true);
  assert.equal(isCurrentRealWeatherNotification({ ...base, weatherIsMock: true }), false);
  assert.equal(isCurrentRealWeatherNotification({ ...base, weatherIsMock: undefined }), false);
  assert.equal(isCurrentRealWeatherNotification({ ...base, hasDevelopmentScenario: true }), false);
  assert.equal(isCurrentRealWeatherNotification({ ...base, generatedAtMs: 1_000 }), false);
  assert.equal(isCurrentRealWeatherNotification({ ...base, applied: true }), false);
  assert.equal(isCurrentRealWeatherNotification({ ...base, superseded: true }), false);
  assert.equal(isCurrentRealWeatherNotification({ ...base, recommendationType: "GENERAL" }), false);
});
