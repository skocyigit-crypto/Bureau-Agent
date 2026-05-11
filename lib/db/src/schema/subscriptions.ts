import { pgTable, serial, integer, varchar, text, timestamp, numeric, boolean } from "drizzle-orm/pg-core";
import { organisationsTable } from "./organisations";

export const subscriptionsTable = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }).unique(),
  plan: varchar("plan", { length: 50 }).notNull().default("essai"),
  status: varchar("status", { length: 30 }).notNull().default("active"),
  licenseKey: varchar("license_key", { length: 100 }).unique(),
  maxUsers: integer("max_users").notNull().default(3),
  maxContacts: integer("max_contacts").notNull().default(100),
  maxCallsPerMonth: integer("max_calls_per_month").notNull().default(500),
  aiEnabled: boolean("ai_enabled").notNull().default(false),
  stockEnabled: boolean("stock_enabled").notNull().default(false),
  automationEnabled: boolean("automation_enabled").notNull().default(false),
  price: numeric("price", { precision: 10, scale: 2 }).notNull().default("0"),
  currency: varchar("currency", { length: 3 }).notNull().default("EUR"),
  billingCycle: varchar("billing_cycle", { length: 20 }).notNull().default("monthly"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  paymentFailedCount: integer("payment_failed_count").notNull().default(0),
  lastPaymentFailedAt: timestamp("last_payment_failed_at", { withTimezone: true }),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  stripeCustomerId: text("stripe_customer_id").unique(),
  stripeSubscriptionId: text("stripe_subscription_id").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const PLANS = {
  essai: {
    name: "Essai Gratuit",
    maxUsers: 3,
    maxContacts: 100,
    maxCallsPerMonth: 500,
    aiEnabled: false,
    stockEnabled: false,
    automationEnabled: false,
    price: 0,
    trialDays: 14,
  },
  starter: {
    name: "Starter",
    maxUsers: 5,
    maxContacts: 500,
    maxCallsPerMonth: 2000,
    aiEnabled: false,
    stockEnabled: true,
    automationEnabled: false,
    price: 29,
    trialDays: 0,
  },
  professionnel: {
    name: "Professionnel",
    maxUsers: 15,
    maxContacts: 5000,
    maxCallsPerMonth: 10000,
    aiEnabled: true,
    stockEnabled: true,
    automationEnabled: true,
    price: 79,
    trialDays: 0,
  },
  entreprise: {
    name: "Entreprise",
    maxUsers: 100,
    maxContacts: 50000,
    maxCallsPerMonth: 100000,
    aiEnabled: true,
    stockEnabled: true,
    automationEnabled: true,
    price: 199,
    trialDays: 0,
  },
} as const;

export type PlanKey = keyof typeof PLANS;
export type Subscription = typeof subscriptionsTable.$inferSelect;
export type InsertSubscription = typeof subscriptionsTable.$inferInsert;
