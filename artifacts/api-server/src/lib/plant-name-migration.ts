import baselineSQL from "../../../../lib/db/drizzle/0000_flora_baseline.sql";

/** Fresh schemas get a create-only baseline; existing schemas get only the additive upgrade. */
export async function migratePlantNames(client: { query: (sql: string) => Promise<{ rows: Array<Record<string, unknown>> }> }) {
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(704631002)");
    const tables = await client.query(`SELECT tablename FROM pg_tables
      WHERE schemaname = current_schema() AND tablename LIKE 'flora_%'
        AND tablename <> 'flora_schema_migrations'`);
    const names = new Set(tables.rows.map(row => row.tablename));
    if (names.size === 0) {
      // Baseline DDL only runs for a fresh FloraWise schema, never over existing rows.
      // Use the active schema so isolated provisioning tests cannot touch public tables.
      await client.query(baselineSQL.replaceAll('"public".', ""));
    } else if (!names.has("flora_plants") || !names.has("flora_species")) {
      throw new Error("Неповна схема FloraWise: потрібна перевірка міграцій; автоматичне відновлення даних не виконується.");
    }
    await client.query(`CREATE TABLE IF NOT EXISTS flora_schema_migrations (
      version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    await client.query("ALTER TABLE flora_plants ADD COLUMN IF NOT EXISTS personal_name text");
    await client.query(`DO $migration$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM flora_schema_migrations WHERE version = 'plant-personal-name') THEN
          UPDATE flora_plants AS p SET personal_name = p.name
          FROM flora_species AS s
          WHERE p.species_id = s.id AND p.name IS DISTINCT FROM s.name
            AND p.personal_name IS NULL;
          INSERT INTO flora_schema_migrations(version) VALUES ('plant-personal-name');
        END IF;
      END $migration$`);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
