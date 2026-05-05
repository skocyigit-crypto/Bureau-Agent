import { pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const stripeWebhookEventsTable = pgTable("stripe_webhook_events", {
  eventId: text("event_id").primaryKey(),
  eventType: varchar("event_type", { length: 100 }).notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type StripeWebhookEvent = typeof stripeWebhookEventsTable.$inferSelect;
