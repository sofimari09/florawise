import type { PoolClient } from "pg";

export async function migrateDemoTomatoEnvironment(client: Pick<PoolClient, "query">) {
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(7829143)");
    const applied = await client.query(
      "SELECT 1 FROM flora_schema_migrations WHERE version = 'demo-tomato-outdoor-environment-v2' LIMIT 1",
    );
    if (applied.rowCount === 0) {
      await client.query(`
        UPDATE flora_plants p SET environment_type = 'OUTDOOR'
        FROM flora_users u, flora_species s
        WHERE p.user_id = u.id
          AND p.species_id = s.id
          AND u.clerk_user_id = 'preview-demo-user'
          AND p.name = 'Томати на грядці'
          AND p.location = 'Сад'
          AND s.name = 'Томат'
          AND p.environment_type = 'INDOOR'
      `);
      await client.query(`
        UPDATE flora_plants p SET place_id = target.id
        FROM flora_users u, flora_plant_places old_place, flora_plant_places target, flora_species s
        WHERE p.user_id = u.id
          AND p.species_id = s.id
          AND p.place_id = old_place.id
          AND target.user_id = u.id
          AND target.name = old_place.name
          AND target.environment_type = 'OUTDOOR'
          AND old_place.environment_type = 'INDOOR'
          AND u.clerk_user_id = 'preview-demo-user'
          AND p.name = 'Томати на грядці'
          AND p.location = 'Сад'
          AND s.name = 'Томат'
      `);
      await client.query(`
        UPDATE flora_plant_places pp SET environment_type = 'OUTDOOR'
        FROM flora_plants p
        JOIN flora_users u ON u.id = p.user_id
        JOIN flora_species s ON s.id = p.species_id
        WHERE p.place_id = pp.id
          AND u.clerk_user_id = 'preview-demo-user'
          AND p.name = 'Томати на грядці'
          AND p.location = 'Сад'
          AND s.name = 'Томат'
          AND pp.environment_type = 'INDOOR'
          AND NOT EXISTS (
            SELECT 1 FROM flora_plant_places target
            WHERE target.user_id = pp.user_id
              AND target.name = pp.name
              AND target.environment_type = 'OUTDOOR'
          )
          AND NOT EXISTS (
            SELECT 1 FROM flora_plants other
            WHERE other.place_id = pp.id AND other.id <> p.id
          )
      `);
      await client.query(
        "INSERT INTO flora_schema_migrations(version) VALUES ('demo-tomato-outdoor-environment-v2') ON CONFLICT DO NOTHING",
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
