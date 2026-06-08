import { pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const stripeWebhookEventsTable = pgTable("stripe_webhook_events", {
  eventId: text("event_id").primaryKey(),
  eventType: varchar("event_type", { length: 100 }).notNull(),
  // State machine: a row is first written as "processing", then flipped to
  // "processed" ONLY after its handler succeeds. Dedupe must skip only fully
  // "processed" events — a row stuck at "processing" means a prior attempt
  // crashed before completing, so a Stripe retry MUST be allowed to reprocess
  // it (handlers are idempotent). Marking processed up-front would permanently
  // drop the event on transient handler/DB failures.
  status: varchar("status", { length: 20 }).notNull().default("processing"),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type StripeWebhookEvent = typeof stripeWebhookEventsTable.$inferSelect;
