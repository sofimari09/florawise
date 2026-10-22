import type { PoolClient } from "pg";

export async function migrateRecommendationSupersededAt(client: Pick<PoolClient, "query">) {
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(7829143)");
    await client.query("ALTER TABLE flora_recommendations ADD COLUMN IF NOT EXISTS superseded_at timestamptz");
    await client.query("INSERT INTO flora_schema_migrations(version) VALUES ('recommendation-superseded-at') ON CONFLICT DO NOTHING");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
