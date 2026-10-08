import type { PoolClient } from "pg";

/** Schema-only upgrade; never replays names, creates species, or changes existing rows. */
export async function migrateCustomPlants(client: Pick<PoolClient, "query">) {
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(704631003)");
    await client.query("ALTER TABLE flora_plants ADD COLUMN IF NOT EXISTS category text");
    await client.query("ALTER TABLE flora_plants ALTER COLUMN species_id DROP NOT NULL");
    await client.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'flora_plants_identity_valid' AND conrelid = 'flora_plants'::regclass) THEN
        ALTER TABLE flora_plants ADD CONSTRAINT flora_plants_identity_valid CHECK (
          (species_id IS NOT NULL AND category IS NULL) OR
          (species_id IS NULL AND category IS NOT NULL AND category IN ('INDOOR_DECORATIVE','OUTDOOR_DECORATIVE','FRUIT_TREE','BERRY_SHRUB','VEGETABLE','HERB')
            AND length(btrim(name)) > 0 AND personal_name IS NULL));
      END IF;
    END $$`);
    await client.query("INSERT INTO flora_schema_migrations(version) VALUES ('custom-plant-identity') ON CONFLICT DO NOTHING");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
