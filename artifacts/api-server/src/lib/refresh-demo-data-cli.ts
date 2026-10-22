import { pool } from "@workspace/db";
import { refreshDemoData } from "./seed";
import { logger } from "./logger";

async function main() {
  try {
    if (process.argv.includes("--confirm-demo-refresh") === false) {
      throw new Error("Для оновлення потрібен прапорець --confirm-demo-refresh.");
    }
    if (process.env.NODE_ENV !== "development") {
      throw new Error("Демо-дані можна оновлювати лише в середовищі розробки.");
    }

    const summary = await refreshDemoData();
    logger.info(summary, "Дані демо-користувача оновлено");
  } catch (error) {
    logger.error({ error }, "Не вдалося оновити демо-дані");
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();
