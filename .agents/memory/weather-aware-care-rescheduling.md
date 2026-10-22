---
name: Weather-aware care rescheduling
description: FloraWise's priority rules for weather-sensitive outdoor care recommendations and confirmed date changes.
---

For FloraWise, weather-aware care is the highest-priority recommendation workflow across all eight eligible operations. Evaluate the scheduled day (today for overdue work before suggesting immediate execution). Support later dates, evidence-backed earlier dates, warning/check-only advice, and keeping the schedule without a task weather card. Never change a task until the user confirms. If no supported safe date exists in the forecast, warn without inventing a date.

**Why:** The user expanded the original rain-postponement scenario into an explainable care system while retaining explicit confirmation and the documented priority algorithm.

**How to apply:** Keep location resolution, indoor/outdoor rules, threshold comparisons, and reminder/calendar updates aligned whenever the recommendation or weather flow changes.

For decisions that can move a task, use only a live provider forecast or an explicitly enabled development fixture. Never substitute mock weather automatically. At confirmation, revalidate active/eligible task state and the exact proposed weather decision in either direction. Use Europe/Kyiv civil dates and make no change when the provider is unavailable.

**Why:** A stored recommendation can outlive a forecast or task edit; trusting its old weather can move care unnecessarily, and presenting demo weather as live data can produce unsafe advice.

**How to apply:** Keep generation, refresh, and apply on the same real-provider path. Recheck both dates immediately before mutation and leave tasks/reminders untouched on stale, indoor, or provider-error paths.

Treat unknown balcony exposure, unknown treatment/application method, unknown soil state, and unavailable recent measured rain as unknown—not as confirmed exposure, spraying, wet soil, or adequate water. Rain forecasts can prompt a soil check, not prove moisture. Preserve existing task/reminder IDs and historical recommendation records.

**Why:** The user explicitly rejected inferred site/product/soil facts and required conservative, explainable outcomes.

**How to apply:** Prefer supported operation/species knowledge; otherwise warn. Open-Meteo Forecast past-days are not measured rainfall, and its ERA5 historical archive is delayed, so do not fabricate recent 24–48-hour observations.
