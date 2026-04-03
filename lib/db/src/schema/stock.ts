import { pgTable, serial, integer, text, timestamp, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const stockArticlesTable = pgTable("stock_articles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  reference: text("reference").notNull(),
  barcode: text("barcode"),
  description: text("description"),
  category: text("category").notNull().default("general"),
  quantity: integer("quantity").notNull().default(0),
  minQuantity: integer("min_quantity").notNull().default(5),
  unitPrice: numeric("unit_price", { precision: 10, scale: 2 }),
  supplier: text("supplier"),
  location: text("location"),
  unit: text("unit").notNull().default("piece"),
  status: text("status").notNull().default("en_stock"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertStockArticleSchema = createInsertSchema(stockArticlesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertStockArticle = z.infer<typeof insertStockArticleSchema>;
export type StockArticle = typeof stockArticlesTable.$inferSelect;
