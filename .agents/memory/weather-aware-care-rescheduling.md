---
name: Weather-aware care rescheduling
description: FloraWise's priority rules for weather-sensitive outdoor care recommendations and confirmed date changes.
---

For FloraWise, weather-aware rescheduling of planned outdoor care is the highest-priority recommendation workflow. Evaluate weather for the task's exact scheduled date, use the species-specific rain threshold when available and the global fallback otherwise, then choose the nearest suitable future day in the forecast. Never change a task until the user confirms. If no suitable future date is available, leave the suggested date empty and explain why.

**Why:** The user designated this the highest-priority scenario and required exact-date forecast checks plus explicit confirmation before schedule changes.

**How to apply:** Keep location resolution, indoor/outdoor rules, threshold comparisons, and reminder/calendar updates aligned whenever the recommendation or weather flow changes.

For decisions that can move a task, use only a live provider forecast or an explicitly enabled development fixture. Never substitute mock weather automatically. At confirmation, revalidate that the task is still active and eligible, the original scheduled date still has the weather conflict, and the suggested date is currently suitable. Use Europe/Kyiv civil dates for app scheduling, and make no change when the provider is unavailable.

**Why:** A stored recommendation can outlive a forecast or task edit; trusting its old weather can move care unnecessarily, and presenting demo weather as live data can produce unsafe advice.

**How to apply:** Keep generation, refresh, and apply on the same real-provider path. Recheck both dates immediately before mutation and leave tasks/reminders untouched on stale, indoor, or provider-error paths.
