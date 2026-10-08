---
name: Category classification
description: Reviewed application grouping for species whose taxonomy differs from the controlled categories.
---
Group «Полуниця» under BERRY_SHRUB («Ягідний кущ») in FloraWise.

**Why:** The user explicitly selected this application care grouping after being told strawberry is not botanically a shrub.

**How to apply:** Preserve this reviewed classification in seeds and migrations. It is not a botanical assertion or permission to classify other ambiguous species automatically.

Automatic legacy backfill is scoped to individually audited row identities, never all species sharing a known catalog name.

**Why:** Administrators may create arbitrary species names, including duplicate catalog names. A namesake is not evidence of botanical identity.

**How to apply:** Require an explicitly reviewed record identity for null-category backfill; leave custom namesakes and unaudited records unresolved for review. Source-owned seed records may carry their category directly.
