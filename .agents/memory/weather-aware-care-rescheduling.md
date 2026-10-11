---
name: Weather-aware care rescheduling
description: FloraWise's priority rules for weather-sensitive outdoor care recommendations and confirmed date changes.
---

For FloraWise, weather-aware rescheduling of planned outdoor care is the highest-priority recommendation workflow. Evaluate weather for the task's exact scheduled date, use the species-specific rain threshold when available and the global fallback otherwise, then choose the nearest suitable future day in the forecast. Never change a task until the user confirms. If no suitable future date is available, leave the suggested date empty and explain why.

**Why:** The user designated this the highest-priority scenario and required exact-date forecast checks plus explicit confirmation before schedule changes.

**How to apply:** Keep location resolution, indoor/outdoor rules, threshold comparisons, and reminder/calendar updates aligned whenever the recommendation or weather flow changes.
