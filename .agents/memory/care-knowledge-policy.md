---
name: Care knowledge policy
description: User's standing constraints for species knowledge, recommendations, and care scheduling.
---

Use PlantSpecies as the factual source of care knowledge. Do not use an LLM as the factual source for care parameters or fabricate knowledge-source URLs. Missing detailed knowledge should use explicit safe fallbacks, not invented facts.

**Why:** The user's comprehensive FloraWise specification requires structured, deterministic, explainable knowledge while preserving existing data and functionality.

**How to apply:** When extending the knowledge base or recommendation rules, keep unknown optional fields empty and distinguish species-specific thresholds from general fallback rules.

Do not silently create large care schedules or change care dates. Show the proposed tasks or change and require the user's confirmation.

**Why:** The user explicitly requires optional care-plan previews and confirmed date changes.

**How to apply:** Generating a preview or recommendation must not mutate tasks; only explicit confirmation may create selected tasks or apply a date change.
