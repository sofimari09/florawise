---
name: FloraWise report semantics
description: Canonical date, cancellation, and completion-rate rules for FloraWise care reports.
---

**Rule:** A report includes scheduled task dates on both period boundaries. Cancelled tasks remain visible in the status breakdown and task table, but are excluded from the counted-task total and completion-rate denominator. A task is overdue only while planned or postponed and when its scheduled date is before the report-creation date in Europe/Kyiv.

**Why:** Reports and dashboard statistics should use the same completion denominator, and date-only care records must not shift with the viewer's time zone.

**How to apply:** Keep report summaries, task breakdowns, date comparisons, and explanatory Ukrainian labels aligned with these rules.
