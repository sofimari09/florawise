import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CARE_PRIORITY_WEIGHTS,
  delaySensitivity,
  priorityFromScore,
  temporalUrgency,
  weatherSignalForPriority,
  weatherUrgency,
  weightedPriority,
} from "./care-task-priority";

test("thesis control example calculates P=0.798 and HIGH", () => {
  const result = weightedPriority({ temporal: 0.67, sensitivity: 0.8, weather: 1 });
  assert.equal(Number(result.score.toFixed(3)), 0.798);
  assert.equal(result.priority, "HIGH");
});

test("priority score boundaries match the three weighted categories", () => {
  assert.equal(priorityFromScore(0), "LOW");
  assert.equal(priorityFromScore(0.399999), "LOW");
  assert.equal(priorityFromScore(0.4), "MEDIUM");
  assert.equal(priorityFromScore(0.699999), "MEDIUM");
  assert.equal(priorityFromScore(0.7), "HIGH");
  assert.equal(priorityFromScore(1), "HIGH");
});

test("temporal urgency rises toward the due date and caps for overdue tasks", () => {
  assert.equal(temporalUrgency(7), 0);
  assert.equal(temporalUrgency(3.5), 0.5);
  assert.equal(temporalUrgency(0), 1);
  assert.equal(temporalUrgency(-10), 1);
});

test("shorter source-backed care intervals mean greater delay sensitivity", () => {
  assert.equal(delaySensitivity(7), 0.7666666666666666);
  assert.equal(delaySensitivity(30), 0);
  assert.equal(delaySensitivity(null), 0.5);
  assert.equal(delaySensitivity(0), 0.5);
});

test("weather concern is an urgency factor, not a safety decision", () => {
  assert.equal(weatherUrgency("CLEAR"), 0);
  assert.equal(weatherUrgency("WARNING"), 0.5);
  assert.equal(weatherUrgency("RESCHEDULE"), 1);
  assert.equal(weatherUrgency(null), null);
});

test("indoor, greenhouse, balcony, and unavailable forecasts exclude the weather factor", () => {
  for (const environment of ["INDOOR", "GREENHOUSE", "BALCONY"]) {
    assert.equal(weatherSignalForPriority(environment, true, "RESCHEDULE"), null);
  }
  assert.equal(weatherSignalForPriority("OUTDOOR", false, "RESCHEDULE"), null);
  assert.equal(weatherSignalForPriority("OUTDOOR", true, "RESCHEDULE"), "RESCHEDULE");
});

test("unavailable or irrelevant weather renormalizes the D/S weights", () => {
  const result = weightedPriority({ temporal: 0.8, sensitivity: 0.6, weather: null });
  assert.equal(Number(result.score.toFixed(6)), Number(((0.4 * 0.8 + 0.35 * 0.6) / 0.75).toFixed(6)));
  assert.equal(result.priority, "HIGH");
});

test("weights remain configurable and URGENT is a separate override", () => {
  const weighted = weightedPriority(
    { temporal: 1, sensitivity: 0, weather: 0 },
    { temporal: 0.2, sensitivity: 0.7, weather: 0.1 },
  );
  assert.equal(Number(weighted.score.toFixed(3)), 0.2);
  assert.equal(weighted.priority, "LOW");
  assert.equal(weightedPriority({ temporal: 0, sensitivity: 0, weather: 0 }, CARE_PRIORITY_WEIGHTS, true).priority, "URGENT");
});
