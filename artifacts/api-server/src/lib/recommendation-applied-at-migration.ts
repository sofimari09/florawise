import type { PoolClient } from "pg";

export async function migrateRecommendationAppliedAt(client: Pick<PoolClient, "query">) {
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(7829143)");
    await client.query("ALTER TABLE flora_recommendations ADD COLUMN IF NOT EXISTS applied_at timestamptz");
    await client.query("UPDATE flora_recommendations SET applied_at = generated_at WHERE applied = 1 AND applied_at IS NULL");
    await client.query("INSERT INTO flora_schema_migrations(version) VALUES ('recommendation-applied-at') ON CONFLICT DO NOTHING");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
