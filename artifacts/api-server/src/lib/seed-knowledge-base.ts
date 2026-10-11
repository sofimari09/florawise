import { eq, sql, type SQLWrapper } from "drizzle-orm";
import knowledgeBase from "../data/florawise-knowledge-base.json" with { type: "json" };
import {
  db, floraKnowledgeImportsTable, knowledgeSourcesTable, speciesCareRulesTable,
  speciesCareRuleSourcesTable, speciesKnowledgeSourcesTable, speciesTable,
} from "@workspace/db";
import { CATEGORY_DEFAULTS, CATEGORY_LABELS, CATEGORY_NOTES, isCategory } from "@workspace/plant-care";

const importVersion = `flora-wise-knowledge-base-v${knowledgeBase.version}`;

// These are catalog row identities from the previously audited seed catalog,
// not matches against personal plant aliases.
const auditedLegacyRows: Record<string, { id: number; name: string }> = {
  MONSTERA: { id: 1, name: "Монстера" },
  FICUS_ELASTICA: { id: 2, name: "Фікус" },
  SPATHIPHYLLUM: { id: 3, name: "Спатифілум" },
  PHALAENOPSIS: { id: 4, name: "Орхідея" },
  TOMATO: { id: 5, name: "Томат" },
  ROSA: { id: 6, name: "Троянда" },
  LAVENDER: { id: 7, name: "Лаванда" },
  STRAWBERRY: { id: 8, name: "Полуниця" },
  BASIL: { id: 9, name: "Базилік" },
  HYDRANGEA_MACROPHYLLA: { id: 10, name: "Гортензія" },
};

const coalesce = (column: SQLWrapper) =>
  sql`COALESCE(EXCLUDED.${column}, ${column})`;
const dbNumeric = (value: number | null) => value === null ? null : String(value);

export async function seedKnowledgeBase() {
  const categories = knowledgeBase.categories;
  for (const category of categories) {
    if (!isCategory(category.code)
      || CATEGORY_LABELS[category.code] !== category.name
      || CATEGORY_NOTES[category.code] !== category.notes
      || JSON.stringify(CATEGORY_DEFAULTS[category.code]) !== JSON.stringify(category.allowedCareTypes)) {
      throw new Error(`FloraWise category data does not match its runtime care matrix: ${category.code}`);
    }
  }

  await db.transaction(async tx => {
    const [completed] = await tx.select({ version: floraKnowledgeImportsTable.version })
      .from(floraKnowledgeImportsTable)
      .where(eq(floraKnowledgeImportsTable.version, importVersion))
      .limit(1);
    if (completed) return;

    const catalog = await tx.select().from(speciesTable);
    const speciesIds = new Map<string, number>();
    for (const row of knowledgeBase.species) {
      let existing = catalog.find(item => item.speciesCode === row.code);
      if (!existing && row.scientificName) {
        const scientificMatches = catalog.filter(item => item.scientificName === row.scientificName);
        if (scientificMatches.length > 1) throw new Error(`Ambiguous scientific name for species ${row.code}`);
        existing = scientificMatches[0];
        if (existing?.speciesCode && existing.speciesCode !== row.code) {
          throw new Error(`Species code conflict for ${row.code}`);
        }
      }
      if (!existing) {
        const legacy = auditedLegacyRows[row.code];
        const audited = legacy && catalog.find(item => item.id === legacy.id);
        if (audited && audited.name !== legacy.name) {
          throw new Error(`Audited legacy catalog row ${legacy.id} no longer matches ${legacy.name}`);
        }
        if (audited?.speciesCode && audited.speciesCode !== row.code) {
          throw new Error(`Audited legacy catalog row ${legacy.id} already has a different species code`);
        }
        existing = audited;
      }

      if (!isCategory(row.category)) throw new Error(`Unknown species category for ${row.code}`);
      if (existing) {
        const changes: Partial<typeof speciesTable.$inferInsert> = {
          speciesCode: row.code,
          name: row.name,
          scientificName: row.scientificName,
          category: row.category,
        };
        const setIfKnown = <K extends keyof typeof changes>(key: K, value: typeof changes[K] | null) => {
          if (value !== null && value !== undefined && value !== "") changes[key] = value;
        };
        setIfKnown("lifeCycle", row.lifeCycle);
        setIfKnown("suitableEnvironmentTypes", row.environment ? [row.environment] : null);
        setIfKnown("lightRequirements", row.lightRequirements);
        setIfKnown("optimalTempMin", dbNumeric(row.optimalTempMin));
        setIfKnown("optimalTempMax", dbNumeric(row.optimalTempMax));
        setIfKnown("soilRecommendations", row.soilRecommendations);
        setIfKnown("wateringRecommendations", row.wateringRecommendations);
        setIfKnown("wateringCheckIntervalDays", row.wateringCheckIntervalDays);
        setIfKnown("targetWaterMmWeekMin", dbNumeric(row.targetWaterMmWeekMin));
        setIfKnown("targetWaterMmWeekMax", dbNumeric(row.targetWaterMmWeekMax));
        setIfKnown("fertilizingRecommendations", row.fertilizingRecommendations);
        setIfKnown("pruningRecommendations", row.pruningRecommendations);
        setIfKnown("sowingPlantingRecommendations", row.sowingPlantingRecommendations);
        setIfKnown("harvestingRecommendations", row.harvestingRecommendations);
        setIfKnown("generalCareRecommendations", row.notes);
        const changed = Object.entries(changes).some(([key, value]) =>
          JSON.stringify(existing![key as keyof typeof existing]) !== JSON.stringify(value));
        if (changed) {
          const [updated] = await tx.update(speciesTable)
            .set({ ...changes, careRevision: existing.careRevision + 1 })
            .where(eq(speciesTable.id, existing.id))
            .returning({ id: speciesTable.id });
          speciesIds.set(row.code, updated.id);
        } else {
          speciesIds.set(row.code, existing.id);
        }
      } else {
        const [created] = await tx.insert(speciesTable).values({
          speciesCode: row.code,
          name: row.name,
          scientificName: row.scientificName,
          lifeCycle: row.lifeCycle,
          category: row.category,
          applicableCareTypes: null,
          suitableEnvironmentTypes: row.environment ? [row.environment] : null,
          description: "",
          careRecommendations: "",
          optimalTempMin: dbNumeric(row.optimalTempMin),
          optimalTempMax: dbNumeric(row.optimalTempMax),
          optimalHumidity: null,
          wateringFrequencyDays: null,
          wateringCheckIntervalDays: row.wateringCheckIntervalDays,
          targetWaterMmWeekMin: dbNumeric(row.targetWaterMmWeekMin),
          targetWaterMmWeekMax: dbNumeric(row.targetWaterMmWeekMax),
          lightRequirements: row.lightRequirements ?? "",
          soilRecommendations: row.soilRecommendations ?? "",
          wateringRecommendations: row.wateringRecommendations ?? "",
          fertilizingRecommendations: row.fertilizingRecommendations ?? "",
          pruningRecommendations: row.pruningRecommendations ?? "",
          transplantingRecommendations: "",
          sowingPlantingRecommendations: row.sowingPlantingRecommendations,
          harvestingRecommendations: row.harvestingRecommendations,
          generalCareRecommendations: row.notes,
          imageUrl: null,
        }).returning({ id: speciesTable.id });
        speciesIds.set(row.code, created.id);
      }
    }

    const sourceIds = new Map<string, number>();
    for (const source of knowledgeBase.sources) {
      const values = {
        speciesId: null,
        sourceCode: source.code,
        sourceName: source.title,
        organization: source.organization,
        subject: source.subject,
        sourceUrl: source.url,
        retrievedAt: source.retrievedAt ? new Date(`${source.retrievedAt}T00:00:00.000Z`) : null,
        notes: source.notes,
        citation: source.citation,
      };
      const [saved] = await tx.insert(knowledgeSourcesTable).values(values)
        .onConflictDoUpdate({
          target: knowledgeSourcesTable.sourceCode,
          set: {
            sourceName: values.sourceName,
            organization: coalesce(knowledgeSourcesTable.organization),
            subject: coalesce(knowledgeSourcesTable.subject),
            sourceUrl: coalesce(knowledgeSourcesTable.sourceUrl),
            retrievedAt: coalesce(knowledgeSourcesTable.retrievedAt),
            notes: coalesce(knowledgeSourcesTable.notes),
            citation: coalesce(knowledgeSourcesTable.citation),
          },
        })
        .returning({ id: knowledgeSourcesTable.id });
      sourceIds.set(source.code, saved.id);
    }

    for (const species of knowledgeBase.species) {
      const speciesId = speciesIds.get(species.code);
      if (speciesId === undefined) throw new Error(`Species was not saved: ${species.code}`);
      const ids = species.sourceCodes.map(code => {
        const id = sourceIds.get(code);
        if (id === undefined) throw new Error(`Unknown source ${code} for ${species.code}`);
        return id;
      });
      if (ids.length) await tx.insert(speciesKnowledgeSourcesTable)
        .values(ids.map(sourceId => ({ speciesId, sourceId })))
        .onConflictDoNothing();
    }

    for (const rule of knowledgeBase.careRules) {
      const speciesId = speciesIds.get(rule.speciesCode);
      if (speciesId === undefined) throw new Error(`Species was not saved: ${rule.speciesCode}`);
      const [savedRule] = await tx.insert(speciesCareRulesTable).values({
        speciesId,
        careType: rule.careType,
        ruleCode: rule.ruleCode,
        triggerDescription: rule.triggerDescription,
        recommendedAction: rule.recommendedAction,
        intervalDaysMin: rule.intervalDaysMin,
        intervalDaysMax: rule.intervalDaysMax,
        targetWaterMmWeekMin: dbNumeric(rule.targetWaterMmWeekMin),
        targetWaterMmWeekMax: dbNumeric(rule.targetWaterMmWeekMax),
        rainThresholdMm: null,
        maxWindSpeedMps: null,
        minTemperature: null,
        maxTemperature: null,
        notes: null,
      }).onConflictDoUpdate({
        target: [speciesCareRulesTable.speciesId, speciesCareRulesTable.careType],
        set: {
          ruleCode: coalesce(speciesCareRulesTable.ruleCode),
          triggerDescription: coalesce(speciesCareRulesTable.triggerDescription),
          recommendedAction: coalesce(speciesCareRulesTable.recommendedAction),
          intervalDaysMin: sql`COALESCE(EXCLUDED.interval_days_min, ${speciesCareRulesTable.intervalDaysMin})`,
          intervalDaysMax: sql`COALESCE(EXCLUDED.interval_days_max, ${speciesCareRulesTable.intervalDaysMax})`,
          targetWaterMmWeekMin: coalesce(speciesCareRulesTable.targetWaterMmWeekMin),
          targetWaterMmWeekMax: coalesce(speciesCareRulesTable.targetWaterMmWeekMax),
        },
      }).returning({ id: speciesCareRulesTable.id });

      const ids = rule.sourceCodes.map(code => {
        const id = sourceIds.get(code);
        if (id === undefined) throw new Error(`Unknown source ${code} for rule ${rule.ruleCode}`);
        return id;
      });
      if (ids.length) await tx.insert(speciesCareRuleSourcesTable)
        .values(ids.map(sourceId => ({ careRuleId: savedRule.id, sourceId })))
        .onConflictDoNothing();
    }

    await tx.insert(floraKnowledgeImportsTable).values({ version: importVersion }).onConflictDoNothing();
  });
}
