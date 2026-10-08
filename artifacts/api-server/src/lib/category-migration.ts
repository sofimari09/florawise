import type { PoolClient } from "pg";
import { isCategory, PLANT_CATEGORIES, type PlantCategory } from "@workspace/plant-care";

/** Explicit categories for source-owned seed records only; never use this dictionary to classify legacy rows. */
export const SEED_CATEGORIES: Record<string, PlantCategory> = {
  "Монстера": "INDOOR_DECORATIVE", "Фікус": "INDOOR_DECORATIVE", "Спатифілум": "INDOOR_DECORATIVE", "Орхідея": "INDOOR_DECORATIVE",
  "Троянда": "OUTDOOR_DECORATIVE", "Гортензія": "OUTDOOR_DECORATIVE", "Лаванда": "HERB",
  "Яблуня": "FRUIT_TREE", "Малина": "BERRY_SHRUB", "Томат": "VEGETABLE", "Базилік": "HERB",
  // Explicitly reviewed by the product owner; this is a care grouping, not literal taxonomy.
  "Полуниця": "BERRY_SHRUB",
};
export type ReviewedClassification = { id: number; name: string; category: PlantCategory };

// Explicit row identities from the audited legacy catalog, not a name-matching classifier.
// Rows absent from this audit (including namesakes and missing apple/raspberry records)
// must be individually reviewed before being added or assigned a category.
export const AUDITED_LEGACY_CATALOG: readonly ReviewedClassification[] = [
  { id: 1, name: "Монстера", category: "INDOOR_DECORATIVE" },
  { id: 2, name: "Фікус", category: "INDOOR_DECORATIVE" },
  { id: 3, name: "Спатифілум", category: "INDOOR_DECORATIVE" },
  { id: 4, name: "Орхідея", category: "INDOOR_DECORATIVE" },
  { id: 5, name: "Томат", category: "VEGETABLE" },
  { id: 6, name: "Троянда", category: "OUTDOOR_DECORATIVE" },
  { id: 7, name: "Лаванда", category: "HERB" },
  { id: 8, name: "Полуниця", category: "BERRY_SHRUB" },
  { id: 9, name: "Базилік", category: "HERB" },
  { id: 10, name: "Гортензія", category: "OUTDOOR_DECORATIVE" },
];

export async function migrateCategories(client: Pick<PoolClient, "query">, reviewed: readonly ReviewedClassification[] = AUDITED_LEGACY_CATALOG) {
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(7829143)");
    await client.query("ALTER TABLE flora_species ADD COLUMN IF NOT EXISTS applicable_care_types text[], ADD COLUMN IF NOT EXISTS care_revision integer NOT NULL DEFAULT 0");
    await client.query("ALTER TABLE flora_recommendations ADD COLUMN IF NOT EXISTS eligibility_version text, ADD COLUMN IF NOT EXISTS care_type text");
    await client.query("ALTER TABLE flora_plants ADD COLUMN IF NOT EXISTS eligibility_revision integer NOT NULL DEFAULT 0");
    const { rows } = await client.query("SELECT id, name, category FROM flora_species ORDER BY id");
    const unresolved = [];
    for (const row of rows) {
      if (isCategory(row.category)) continue;
      const localized = PLANT_CATEGORIES.find(code => ({
        INDOOR_DECORATIVE: "Кімнатна декоративна", OUTDOOR_DECORATIVE: "Садова декоративна",
        FRUIT_TREE: "Плодове дерево", BERRY_SHRUB: "Ягідний кущ", VEGETABLE: "Овочева культура", HERB: "Зелень / пряна культура",
      })[code] === row.category);
      const audited = reviewed.find(record => record.id === row.id && record.name === row.name);
      const category = localized ?? (row.category == null || row.category === "" ? audited?.category : undefined);
      if (category) await client.query("UPDATE flora_species SET category = $1 WHERE id = $2", [category, row.id]);
      else unresolved.push({ id: row.id, name: row.name, category: row.category });
    }
    if (unresolved.length) {
      // Commit additive columns and verified mappings, but do not enforce NOT NULL prematurely.
      await client.query("COMMIT");
      throw new Error(`Потрібна перевірена класифікація видів: ${JSON.stringify(unresolved)}`);
    }
    await client.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'flora_species_category_valid' AND conrelid = 'flora_species'::regclass) THEN
        ALTER TABLE flora_species ADD CONSTRAINT flora_species_category_valid CHECK (category IN ('INDOOR_DECORATIVE','OUTDOOR_DECORATIVE','FRUIT_TREE','BERRY_SHRUB','VEGETABLE','HERB'));
      END IF;
    END $$`);
    await client.query("ALTER TABLE flora_species ALTER COLUMN category SET NOT NULL");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
