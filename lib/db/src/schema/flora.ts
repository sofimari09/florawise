import { boolean, check, date, integer, numeric, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("flora_users", {
  id: serial("id").primaryKey(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  username: text("username").notNull(),
  email: text("email").notNull(),
  role: text("role").notNull().default("USER"),
  weatherLocationName: text("weather_location_name").notNull().default("Ваш регіон"),
  weatherLatitude: numeric("weather_latitude", { precision: 10, scale: 7 }),
  weatherLongitude: numeric("weather_longitude", { precision: 11, scale: 7 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const plantPlacesTable = pgTable("flora_plant_places", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  environmentType: text("environment_type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  ownerNameEnvironmentIdx: uniqueIndex("flora_plant_places_owner_name_environment_idx").on(table.userId, table.name, table.environmentType),
}));

export const savedLocationsTable = pgTable("flora_saved_locations", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
  latitude: numeric("latitude", { precision: 10, scale: 7 }).notNull(),
  longitude: numeric("longitude", { precision: 11, scale: 7 }).notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  ownerCoordinatesIdx: uniqueIndex("flora_saved_locations_owner_coordinates_idx").on(table.userId, table.latitude, table.longitude),
}));

export const speciesTable = pgTable("flora_species", {
  id: serial("id").primaryKey(),
  speciesCode: text("species_code"),
  name: text("name").notNull(),
  scientificName: text("scientific_name"),
  lifeCycle: text("life_cycle"),
  category: text("category").notNull(),
  applicableCareTypes: text("applicable_care_types").array(),
  careRevision: integer("care_revision").notNull().default(0),
  suitableEnvironmentTypes: text("suitable_environment_types").array(),
  description: text("description").notNull(),
  careRecommendations: text("care_recommendations").notNull(),
  optimalTempMin: numeric("optimal_temp_min"),
  optimalTempMax: numeric("optimal_temp_max"),
  optimalHumidity: integer("optimal_humidity"),
  humidityMin: integer("humidity_min"),
  humidityMax: integer("humidity_max"),
  wateringFrequencyDays: integer("watering_frequency_days"),
  wateringCheckIntervalDays: integer("watering_check_interval_days"),
  targetWaterMmWeekMin: numeric("target_water_mm_week_min"),
  targetWaterMmWeekMax: numeric("target_water_mm_week_max"),
  lightRequirements: text("light_requirements").notNull(),
  soilRecommendations: text("soil_recommendations").notNull(),
  wateringRecommendations: text("watering_recommendations").notNull(),
  fertilizingRecommendations: text("fertilizing_recommendations").notNull(),
  fertilizingFrequencyDays: integer("fertilizing_frequency_days"),
  pruningRecommendations: text("pruning_recommendations").notNull(),
  pruningSeason: text("pruning_season"),
  transplantingRecommendations: text("transplanting_recommendations").notNull(),
  transplantingFrequencyMonths: integer("transplanting_frequency_months"),
  harvestingRecommendations: text("harvesting_recommendations"),
  sowingPlantingRecommendations: text("sowing_planting_recommendations"),
  generalCareRecommendations: text("general_care_recommendations"),
  imageUrl: text("image_url"),
}, (table) => ({
  categoryValid: check("flora_species_category_valid", sql`${table.category} IN ('INDOOR_DECORATIVE', 'OUTDOOR_DECORATIVE', 'FRUIT_TREE', 'BERRY_SHRUB', 'VEGETABLE', 'HERB')`),
  speciesCodeUnique: uniqueIndex("flora_species_code_idx").on(table.speciesCode),
}));

export const speciesCareRulesTable = pgTable("flora_species_care_rules", {
  id: serial("id").primaryKey(),
  speciesId: integer("species_id").notNull().references(() => speciesTable.id, { onDelete: "cascade" }),
  careType: text("care_type").notNull(),
  rainThresholdMm: numeric("rain_threshold_mm"),
  maxWindSpeedMps: numeric("max_wind_speed_mps"),
  minTemperature: numeric("min_temperature"),
  maxTemperature: numeric("max_temperature"),
  notes: text("notes"),
  ruleCode: text("rule_code"),
  triggerDescription: text("trigger_description"),
  recommendedAction: text("recommended_action"),
  intervalDaysMin: integer("interval_days_min"),
  intervalDaysMax: integer("interval_days_max"),
  targetWaterMmWeekMin: numeric("target_water_mm_week_min"),
  targetWaterMmWeekMax: numeric("target_water_mm_week_max"),
}, (table) => ({
  speciesCareTypeIdx: uniqueIndex("flora_species_care_rules_species_type_idx").on(table.speciesId, table.careType),
}));

export const knowledgeSourcesTable = pgTable("flora_knowledge_sources", {
  id: serial("id").primaryKey(),
  speciesId: integer("species_id").references(() => speciesTable.id, { onDelete: "cascade" }),
  sourceCode: text("source_code"),
  sourceName: text("source_name").notNull(),
  organization: text("organization"),
  subject: text("subject"),
  sourceUrl: text("source_url"),
  retrievedAt: timestamp("retrieved_at", { withTimezone: true }),
  notes: text("notes"),
  citation: text("citation"),
}, (table) => ({
  sourceCodeIdx: uniqueIndex("flora_knowledge_sources_source_code_idx").on(table.sourceCode),
}));

export const speciesKnowledgeSourcesTable = pgTable("flora_species_knowledge_sources", {
  speciesId: integer("species_id").notNull().references(() => speciesTable.id, { onDelete: "cascade" }),
  sourceId: integer("source_id").notNull().references(() => knowledgeSourcesTable.id, { onDelete: "cascade" }),
}, (table) => ({
  speciesSourceIdx: uniqueIndex("flora_species_source_links_species_source_idx").on(table.speciesId, table.sourceId),
}));

export const speciesCareRuleSourcesTable = pgTable("flora_species_care_rule_sources", {
  careRuleId: integer("care_rule_id").notNull().references(() => speciesCareRulesTable.id, { onDelete: "cascade" }),
  sourceId: integer("source_id").notNull().references(() => knowledgeSourcesTable.id, { onDelete: "cascade" }),
}, (table) => ({
  careRuleSourceIdx: uniqueIndex("flora_care_rule_source_links_rule_source_idx").on(table.careRuleId, table.sourceId),
}));

export const floraSchemaMigrationsTable = pgTable("flora_schema_migrations", {
  version: text("version").primaryKey(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
});

export const plantsTable = pgTable("flora_plants", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  speciesId: integer("species_id").references(() => speciesTable.id),
  category: text("category"),
  eligibilityRevision: integer("eligibility_revision").notNull().default(0),
  name: text("name").notNull(),
  personalName: text("personal_name"),
  photoUrl: text("photo_url").notNull(),
  photoObjectPath: text("photo_object_path"),
  placeId: integer("place_id").references(() => plantPlacesTable.id, { onDelete: "set null" }),
  weatherLocationId: integer("weather_location_id").references(() => savedLocationsTable.id, { onDelete: "set null" }),
  // Legacy columns remain during the additive migration and are kept in sync for existing clients.
  location: text("location").notNull(),
  environmentType: text("environment_type").notNull().default("INDOOR"),
  weatherLocationName: text("weather_location_name"),
  weatherLatitude: numeric("weather_latitude", { precision: 10, scale: 7 }),
  weatherLongitude: numeric("weather_longitude", { precision: 11, scale: 7 }),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  identityValid: check("flora_plants_identity_valid", sql`(${table.speciesId} IS NOT NULL AND ${table.category} IS NULL) OR (${table.speciesId} IS NULL AND ${table.category} IS NOT NULL AND ${table.category} IN ('INDOOR_DECORATIVE','OUTDOOR_DECORATIVE','FRUIT_TREE','BERRY_SHRUB','VEGETABLE','HERB') AND length(btrim(${table.name})) > 0 AND ${table.personalName} IS NULL)`),
}));

export const plantPhotosTable = pgTable("flora_plant_photos", {
  objectPath: text("object_path").primaryKey(),
  uploadPath: text("upload_path").notNull(),
  clerkUserId: text("clerk_user_id").notNull(),
  name: text("name").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  ready: boolean("ready").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tasksTable = pgTable("flora_tasks", {
  id: serial("id").primaryKey(),
  plantId: integer("plant_id").notNull().references(() => plantsTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  scheduledDate: date("scheduled_date", { mode: "string" }).notNull(),
  status: text("status").notNull().default("PLANNED"),
  priority: text("priority").notNull().default("MEDIUM"),
  notes: text("notes").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  postponementCount: integer("postponement_count").notNull().default(0),
});

export const careLogsTable = pgTable("flora_care_logs", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull().references(() => tasksTable.id, { onDelete: "cascade" }),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
  comment: text("comment").notNull().default(""),
});

export const remindersTable = pgTable("flora_reminders", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull().references(() => tasksTable.id, { onDelete: "cascade" }),
  reminderDate: date("reminder_date", { mode: "string" }).notNull(),
  status: text("status").notNull().default("PENDING"),
});

export const recommendationsTable = pgTable("flora_recommendations", {
  id: serial("id").primaryKey(),
  plantId: integer("plant_id").notNull().references(() => plantsTable.id, { onDelete: "cascade" }),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  type: text("type").notNull(),
  text: text("text").notNull(),
  priority: text("priority").notNull(),
  relatedTaskId: integer("related_task_id").references(() => tasksTable.id, { onDelete: "set null" }),
  explanation: text("explanation").notNull(),
  originalDate: date("original_date", { mode: "string" }),
  suggestedDate: date("suggested_date", { mode: "string" }),
  applied: integer("applied").notNull().default(0),
  weatherJson: text("weather_json").notNull().default("{}"),
  eligibilityVersion: text("eligibility_version"),
  careType: text("care_type"),
});

export const reportsTable = pgTable("flora_reports", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  periodStart: date("period_start", { mode: "string" }).notNull(),
  periodEnd: date("period_end", { mode: "string" }).notNull(),
  taskCount: integer("task_count").notNull(),
  completed: integer("completed").notNull(),
  overdue: integer("overdue").notNull(),
  postponed: integer("postponed").notNull(),
  completionRate: numeric("completion_rate").notNull(),
  frequentCategory: text("frequent_category").notNull(),
  mostActivePlant: text("most_active_plant").notNull(),
  recommendationSummary: text("recommendation_summary").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  periodIdx: uniqueIndex("flora_reports_user_period_idx").on(table.userId, table.periodStart, table.periodEnd),
}));

export const insertSpeciesSchema = createInsertSchema(speciesTable).omit({ id: true });
export const insertPlantSchema = createInsertSchema(plantsTable).omit({ id: true, addedAt: true });
export const insertTaskSchema = createInsertSchema(tasksTable).omit({ id: true, createdAt: true });
export const insertPlantPlaceSchema = createInsertSchema(plantPlacesTable).omit({ id: true, createdAt: true });
export const insertSavedLocationSchema = createInsertSchema(savedLocationsTable).omit({ id: true, createdAt: true, lastUsedAt: true });
export const insertSpeciesCareRuleSchema = createInsertSchema(speciesCareRulesTable).omit({ id: true });
export const insertKnowledgeSourceSchema = createInsertSchema(knowledgeSourcesTable).omit({ id: true });
export type User = typeof usersTable.$inferSelect;
export type PlantSpecies = typeof speciesTable.$inferSelect;
export type Plant = typeof plantsTable.$inferSelect;
export type PlantPlace = typeof plantPlacesTable.$inferSelect;
export type SavedLocation = typeof savedLocationsTable.$inferSelect;
export type SpeciesCareRule = typeof speciesCareRulesTable.$inferSelect;
export type KnowledgeSource = typeof knowledgeSourcesTable.$inferSelect;
export type SpeciesCareRuleSource = typeof speciesCareRuleSourcesTable.$inferSelect;
export type CareTask = typeof tasksTable.$inferSelect;
export type CareLog = typeof careLogsTable.$inferSelect;
export type Reminder = typeof remindersTable.$inferSelect;
export type Recommendation = typeof recommendationsTable.$inferSelect;
export type Report = typeof reportsTable.$inferSelect;
export type InsertSpecies = z.infer<typeof insertSpeciesSchema>;