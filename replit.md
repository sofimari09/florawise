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

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
