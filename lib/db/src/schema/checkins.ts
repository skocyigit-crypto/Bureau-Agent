import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const checkinsTable = pgTable("checkins", {
  id: serial("id").primaryKey(),
  employeeName: text("employee_name").notNull(),
  employeeRole: text("employee_role"),
  type: text("type").notNull(),
  status: text("status").notNull(),
  location: text("location"),
  notes: text("notes"),
  ipAddress: text("ip_address"),
  checkInAt: timestamp("check_in_at", { withTimezone: true }).notNull().defaultNow(),
  checkOutAt: timestamp("check_out_at", { withTimezone: true }),
  breakMinutes: integer("break_minutes").notNull().default(0),
  totalMinutes: integer("total_minutes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCheckinSchema = createInsertSchema(checkinsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCheckin = z.infer<typeof insertCheckinSchema>;
export type Checkin = typeof checkinsTable.$inferSelect;
