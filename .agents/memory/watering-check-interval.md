---
name: Watering checks versus watering cadence
description: FloraWise knowledge must distinguish how often to inspect watering conditions from how often to water.
---

Treat the workbook's watering-check interval as a reminder to inspect conditions, not a fixed watering cadence. A condition-triggered watering rule supersedes an older top-level fixed watering frequency. A source-backed numeric action interval may support recurrence and log-based urgency, but the condition must still be checked before recommending the action. For a documented interval range, use its upper bound before raising urgency.

**Why:** The FloraWise workbook's «Контроль_поливу_днів» field specifies a check interval, and many watering rules depend on soil moisture rather than a calendar. Using the upper end of a sourced range avoids treating care as overdue while it remains inside the documented window.

**How to apply:** Keep check intervals and watering frequencies in separate fields and labels; never turn an inspection interval into a watering task. Compare each care action only with the latest completed log of the same type. Care-plan previews and recommendation urgency may use numeric intervals from sourced action rules and must include their condition/action; condition-only rules remain guidance and do not create recurring tasks or date-based urgency.
