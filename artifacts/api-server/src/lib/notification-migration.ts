import type { PoolClient } from "pg";

export async function migrateNotifications(client: Pick<PoolClient, "query">) {
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(7829143)");
    await client.query(`
      CREATE TABLE IF NOT EXISTS flora_notifications (
        id serial PRIMARY KEY,
        user_id integer NOT NULL REFERENCES flora_users(id) ON DELETE CASCADE,
        type text NOT NULL,
        title text NOT NULL,
        message text NOT NULL,
        dedupe_key text NOT NULL,
        href text,
        plant_id integer REFERENCES flora_plants(id) ON DELETE SET NULL,
        task_id integer REFERENCES flora_tasks(id) ON DELETE SET NULL,
        reminder_id integer REFERENCES flora_reminders(id) ON DELETE SET NULL,
        recommendation_id integer REFERENCES flora_recommendations(id) ON DELETE SET NULL,
        read_at timestamptz,
        stale_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query("CREATE UNIQUE INDEX IF NOT EXISTS flora_notifications_owner_dedupe_idx ON flora_notifications(user_id, dedupe_key)");
    await client.query("CREATE INDEX IF NOT EXISTS flora_notifications_owner_created_idx ON flora_notifications(user_id, created_at DESC)");
    await client.query("INSERT INTO flora_schema_migrations(version) VALUES ('notifications-v1') ON CONFLICT DO NOTHING");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
