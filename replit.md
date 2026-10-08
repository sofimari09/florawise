# FloraWise

FloraWise is a Ukrainian plant-care workspace for tracking plants, planning care, receiving transparent weather-aware recommendations, and reviewing progress.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server on the configured `PORT`
- `pnpm --filter @workspace/flora-wise run dev` — run the FloraWise web app
- `pnpm run typecheck:libs` — typecheck shared libraries
- `pnpm --filter @workspace/api-server run typecheck` — typecheck the API
- `pnpm --filter @workspace/flora-wise run typecheck` — typecheck the web app
- `pnpm --filter @workspace/flora-wise run build` — build the web app
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (development only)
- Required env: `DATABASE_URL` — Postgres connection string
- Clerk is Replit-managed; `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, and `VITE_CLERK_PUBLISHABLE_KEY` are provisioned as workspace secrets.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: Vite for the web app, esbuild for the API bundle

## Where things live

- `artifacts/flora-wise/src/App.tsx` — Ukrainian web UI, routes, CRUD forms, dashboard, recommendations, statistics, and reports
- `artifacts/flora-wise/src/index.css` — FloraWise visual tokens, typography, responsive styles, and Clerk theme layer
- `artifacts/flora-wise/public/logo.svg` — branded auth logo
- `artifacts/api-server/src/routes/flora.ts` — FloraWise API routes, ownership checks, completion flow, reminders, and reports
- `artifacts/api-server/src/lib/recommendation-engine.ts` — transparent rule-based recommendation rules
- `artifacts/api-server/src/lib/weather.ts` — `WeatherServiceClient` and offline `MockWeatherService`
- `artifacts/api-server/src/lib/seed.ts` — idempotent development demo data
- `lib/api-spec/openapi.yaml` — source-of-truth API contract
- `lib/db/src/schema/flora.ts` — source-of-truth PostgreSQL/Drizzle schema

## Architecture decisions

- API-first: the OpenAPI contract generates both React Query hooks and Zod types.
- Recommendations are rule-based and explain their reason; there is no machine-learning dependency.
- Weather is behind an interface so the app works offline with deterministic mock forecasts.
- Browser auth uses Clerk session cookies; the API keeps a development-only `preview-demo-user` fallback for preview usability.
- Every personal resource is filtered through the current user's database record; admin species mutations require `ADMIN`.

## Product

- Landing page and Clerk sign-in/sign-up in Ukrainian
- Plant collection with species directory, search, create, edit, delete, and detail views
- Care calendar with task creation, completion, postponement, cancellation, care history, and reminders
- Weather dashboard and explainable recommendations with apply/reschedule flow
- Statistics and persisted period reports
- Admin route for managing the shared species directory

Development preview seeds four plants, care tasks, reminders, and a recommendation for the demo user. The API also seeds a separate `preview-demo-admin` record for admin-role testing.

## User preferences

- The user-facing interface and copy should remain Ukrainian.

## Gotchas

- Do not replace `MockWeatherService` with a live weather provider unless the product explicitly requires an integration.
- Regenerate the API client and Zod package after changing `lib/api-spec/openapi.yaml`.
- The Clerk proxy is production-only; development uses the Clerk development instance directly.
- API `PORT` and frontend `BASE_PATH` are required by their Vite/server configs when running commands outside managed workflows.

## Plant identity rollout

- Apply `pnpm --filter @workspace/api-server run migrate:names` before starting the new API or deploying its callers. Startup also runs this transactional additive migration before seeding or any ORM reads.
- Fresh setup is automatic: when the active schema contains no FloraWise tables, the same command (and API startup) applies the checked-in create-only baseline from `lib/db/drizzle/0000_flora_baseline.sql`, then the versioned alias migration. No schema push or external CLI is needed at runtime.
- On existing FloraWise schemas, only nullable `personal_name` and a version ledger are added; existing data is never replaced, catalog reseeding is not part of the migration, and species links/relationships are unchanged. A partially provisioned schema without plants/species fails explicitly instead of guessing repairs.
- The one-time backfill preserves historical names differing from their linked species name as aliases. Names exactly equal to that species name remain defaults. Equality is only used to distinguish legacy display aliases, never to guess identity or repair species links.
- Do not rerun a null-only backfill: null is also an intentional cleared alias. The ledger prevents future reruns from repopulating clears.
- `speciesId` alone defines botanical identity and care. `personalName` is an optional display alias. The legacy `name` response remains the resolved display name and the required DB column is synchronized on writes.
- Legacy request `name` is treated only as an alias. Explicit `personalName` takes precedence. PATCH omission preserves the alias, blank/null clears it, and a species-only change keeps an alias but refreshes the default name.
- Post-merge setup uses the additive migration, not a general schema push. Broader schema changes need their own reviewed migrations.
- The baseline is a fresh-install snapshot, not an upgrade script: never manually apply it over existing FloraWise tables.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

## Custom plant identity and rollout

- The existing `migrate:names` command now applies the name, category and custom-identity migrations in order. Run it **before releasing the API and its callers**; startup also applies them before seed/ORM access. The custom migration adds a nullable category, drops the species-link NOT NULL constraint, adds a checked identity invariant and records a version. It is schema-only, transactional and rerunnable on fresh and existing installations; it never replays alias backfills or changes existing plants/tasks/photos/locations.
- Linked plants have `identityKind=LINKED`, a real `speciesId`, and no stored category override. Their effective category and all species knowledge come solely from that species, regardless of aliases.
- Custom plants have `identityKind=CUSTOM`, `speciesId=null`, a manually selected controlled category, a required nonblank name and no species alias. Their `speciesName` and detail `species` are null. Text that does not match search never implies custom identity.
- POST requires an explicit species ID or explicit null. PATCH omission preserves the mode/name/category; explicit null switches to custom and requires an explicit name/category. Switching to linked clears the custom category; nonnull category overrides on linked requests are rejected.
- Category defaults determine eligible activities for custom plants without species refinements. General weather/activity rules are labeled generic; species thresholds/cadences remain unknown. No supported category-level biological cadence is currently available, so custom previews deliberately return an empty list with a Ukrainian explanation in the UI; users may schedule eligible tasks manually.
- Advice/previews never mutate tasks. Confirmation compares identity revisions and current environment, resolved weather location, care history and task context. Existing incompatible historical tasks remain visible and can be completed/cancelled; they cannot be newly scheduled under an incompatible category.
