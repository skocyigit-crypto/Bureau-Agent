import { pgTable, serial, integer, text, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organisationsTable } from "./organisations";
import { contactsTable } from "./contacts";
import { tasksTable } from "./tasks";
import { usersTable } from "./users";

export const calendarEventsTable = pgTable("calendar_events", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").references(() => organisationsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  type: text("type").notNull().default("rendez_vous"),
  startDate: timestamp("start_date", { withTimezone: true }).notNull(),
  endDate: timestamp("end_date", { withTimezone: true }).notNull(),
  allDay: boolean("all_day").notNull().default(false),
  location: text("location"),
  color: text("color").default("#f59e0b"),
  relatedContactId: integer("related_contact_id").references(() => contactsTable.id, { onDelete: "set null" }),
  relatedTaskId: integer("related_task_id").references(() => tasksTable.id, { onDelete: "set null" }),
  reminder: text("reminder").default("15min"),
  recurrence: text("recurrence"),
  contactName: text("contact_name"),
  contactPhone: text("contact_phone"),
  contactEmail: text("contact_email"),
  contactCompany: text("contact_company"),
  contactNotes: text("contact_notes"),
  status: text("status").default("confirme"),
  priority: text("priority").default("normale"),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  updatedBy: integer("updated_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("cal_events_start_date_idx").on(table.startDate),
  index("cal_events_end_date_idx").on(table.endDate),
  index("cal_events_related_contact_idx").on(table.relatedContactId),
  index("cal_events_type_idx").on(table.type),
  index("cal_events_org_id_idx").on(table.organisationId),
  index("cal_events_created_by_idx").on(table.createdBy),
]);

export const insertCalendarEventSchema = createInsertSchema(calendarEventsTable).omit({ id: true, createdAt: true, updatedAt: true, createdBy: true, updatedBy: true });
export type InsertCalendarEvent = z.infer<typeof insertCalendarEventSchema>;
export type CalendarEvent = typeof calendarEventsTable.$inferSelect;
