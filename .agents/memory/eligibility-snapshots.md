---
name: Eligibility snapshots
description: Why care confirmation requires revisions in addition to the current allowed activity set.
---
Care previews and saved advice must become stale after eligibility or linked-species changes, even if later edits restore the original category/activity set or species.

**Why:** Matching only the current allowed activities would make previously rejected advice actionable again after a change is reversed. Users have not confirmed the intervening care knowledge or identity changes.

**How to apply:** Preserve monotonic revisions for species care knowledge/applicability and linked plant identity, include them in confirmation snapshots, and compare the current snapshot inside the task/reminder write transaction. Alias, photo, and location-only edits must not count as botanical identity changes.
