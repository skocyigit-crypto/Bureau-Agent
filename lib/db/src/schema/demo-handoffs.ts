import { pgTable, serial, integer, varchar, timestamp, index, jsonb } from "drizzle-orm/pg-core";
import { organisationsTable } from "./organisations";
import { usersTable } from "./users";

// Server-persisted handoff of a marketing-site (tanitim) demo conversation.
// The visitor is anonymous when the demo happens, so the row is created without
// an owner and addressed only by a secret random `claimToken` carried in the
// browser (URL param + localStorage). On first login the in-app assistant
// claims the token, binding the transcript to the new account/org. Once claimed
// it is resumable from any device and survives the old 30-min localStorage TTL.
// Privacy: rows are deleted on consume and purged after a sane retention window.
export type DemoHandoffMessage = { r: string; t: string };

export const demoHandoffsTable = pgTable("demo_handoffs", {
  id: serial("id").primaryKey(),
  claimToken: varchar("claim_token", { length: 64 }).notNull().unique(),
  transcript: jsonb("transcript").$type<DemoHandoffMessage[]>().notNull(),
  // Null until a logged-in user claims the token (anonymous at creation time).
  organisationId: integer("organisation_id").references(() => organisationsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("demo_handoff_owner_idx").on(t.organisationId, t.userId, t.consumedAt),
]);

export type DemoHandoff = typeof demoHandoffsTable.$inferSelect;
