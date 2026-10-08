---
name: Care regression fixtures
description: Designing care-plan tests without confusing category eligibility with scheduling evidence.
---

Care-plan regression fixtures must explicitly supply the scheduling data they are testing and leave a supported activity unplanned. Do not assume seed species have optional cadences, or that eligible activities imply schedulable proposals.

**Why:** When previews began excluding already-planned work, full activity-matrix fixtures yielded empty previews. Closing an activity without a supported cadence still cannot produce a valid proposal, so identity/confirmation regressions need deliberate scheduling fixtures.

**How to apply:** Keep empty-preview tests separate from confirmation tests. For confirmation tests, establish a supported interval and absence of active work of that type, and expect a changed task context to invalidate the original snapshot.
