# FloraWise category and applicability rollout

1. Deploy the shared domain library, OpenAPI contract, regenerated clients/validators, and additive migration together. Do not use a forced schema push on populated data.
2. API startup first adopts/provisions the existing schema through the existing plant-name migration. Category migration then adds nullable applicability, species care revision, plant eligibility revision, and recommendation snapshots without changing user data.
3. The category migration accepts existing controlled codes, exact Ukrainian category labels, and explicitly audited catalog row identities (ID + expected name). The audit covers the ten legacy catalog rows, not every row with a matching name. A custom species named “Томат” remains unresolved unless individually reviewed. Other databases with different IDs must review those rows instead of extending a name-only mapping. It preserves all IDs, aliases, photos, locations, knowledge, tasks, reminders, history, and dates. Strawberry's berry-shrub grouping was explicitly selected by the product owner; do not generalize this mapping to other ambiguous species.
4. Unmapped or ambiguous records are reported with species ID, name, and legacy category. Verified mappings and additive columns are retained. Startup stops before serving a partially classified catalog; no blanket default is assigned. Review the reported records and assign a supported category, then rerun startup.
5. Only after every species resolves does the migration apply the category check constraint and NOT NULL. A rerun preserves valid administrator classifications, refinements, and knowledge.
6. Development seeds supply categories explicitly. No new factual sources, dates, sowing/planting/harvest schedules, or broader catalog entries are seeded.
7. Species administration can atomically submit category, applicability and structured weather knowledge. Null applicability inherits category defaults; [] disables all care. Rules must reference eligible activities; missing rules or intervals do not disable an activity.
8. Deploy the web client with the updated API. Old previews without snapshots cannot be confirmed; old saved recommendations without snapshots are historical and non-actionable. Users must refresh previews/generate advice. Eligibility is checked inside the transaction before task/reminder writes.
9. Existing incompatible tasks remain readable, completable and cancellable; edits retaining unchanged care are allowed, but changing date/plant/type or reintroducing incompatible care is rejected. History and filters never remove incompatible rows.

Verification commands:
- `pnpm --filter @workspace/api-spec run codegen`
- `pnpm run typecheck`
- `pnpm --filter @workspace/api-server run test:categories`
- `pnpm --filter @workspace/api-server run test:category-api`
- Existing `test:rules`, `test:photos`, `test:identity`, `test:identity-startup`, `test:identity-flow`
- `pnpm --filter @workspace/flora-wise run test:species`

API integration and migration tests use disposable schemas and remove them afterward. They never reclassify the real user catalog or delete user care records.
