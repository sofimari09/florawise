import type { PoolClient } from "pg";

export async function migrateReportDetails(client: Pick<PoolClient, "query">) {
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(7829143)");
    await client.query("ALTER TABLE flora_reports ADD COLUMN IF NOT EXISTS report_details jsonb");
    await client.query("INSERT INTO flora_schema_migrations(version) VALUES ('report-details-v1') ON CONFLICT DO NOTHING");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
