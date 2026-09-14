import { date, integer, numeric, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("flora_users", {
  id: serial("id").primaryKey(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  username: text("username").notNull(),
  email: text("email").notNull(),
  role: text("role").notNull().default("USER"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const speciesTable = pgTable("flora_species", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  careRecommendations: text("care_recommendations").notNull(),
  optimalTempMin: numeric("optimal_temp_min").notNull(),
  optimalTempMax: numeric("optimal_temp_max").notNull(),
  optimalHumidity: integer("optimal_humidity").notNull(),
  wateringFrequencyDays: integer("watering_frequency_days").notNull(),
  lightRequirements: text("light_requirements").notNull(),
  soilRecommendations: text("soil_recommendations").notNull(),
  wateringRecommendations: text("watering_recommendations").notNull(),
  fertilizingRecommendations: text("fertilizing_recommendations").notNull(),
  pruningRecommendations: text("pruning_recommendations").notNull(),
  transplantingRecommendations: text("transplanting_recommendations").notNull(),
  imageUrl: text("image_url").notNull(),
});

export const plantsTable = pgTable("flora_plants", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  speciesId: integer("species_id").notNull().references(() => speciesTable.id),
  name: text("name").notNull(),
  photoUrl: text("photo_url").notNull(),
  location: text("location").notNull(),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
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
export type User = typeof usersTable.$inferSelect;
export type PlantSpecies = typeof speciesTable.$inferSelect;
export type Plant = typeof plantsTable.$inferSelect;
export type CareTask = typeof tasksTable.$inferSelect;
export type CareLog = typeof careLogsTable.$inferSelect;
export type Reminder = typeof remindersTable.$inferSelect;
export type Recommendation = typeof recommendationsTable.$inferSelect;
export type Report = typeof reportsTable.$inferSelect;
export type InsertSpecies = z.infer<typeof insertSpeciesSchema>;