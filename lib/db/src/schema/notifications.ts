import { index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable, plantsTable, tasksTable, remindersTable, recommendationsTable } from "./flora";

export const notificationsTable = pgTable("flora_notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  dedupeKey: text("dedupe_key").notNull(),
  href: text("href"),
  plantId: integer("plant_id").references(() => plantsTable.id, { onDelete: "set null" }),
  taskId: integer("task_id").references(() => tasksTable.id, { onDelete: "set null" }),
  reminderId: integer("reminder_id").references(() => remindersTable.id, { onDelete: "set null" }),
  recommendationId: integer("recommendation_id").references(() => recommendationsTable.id, { onDelete: "set null" }),
  readAt: timestamp("read_at", { withTimezone: true }),
  staleAt: timestamp("stale_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  ownerDedupeIdx: uniqueIndex("flora_notifications_owner_dedupe_idx").on(table.userId, table.dedupeKey),
  ownerCreatedIdx: index("flora_notifications_owner_created_idx").on(table.userId, table.createdAt),
}));

export type FloraNotification = typeof notificationsTable.$inferSelect;
