import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  // `user_sessions` is created and owned by connect-pg-simple (Express session
  // store), NOT by Drizzle — it is intentionally absent from the schema source.
  // Excluding it here stops `drizzle-kit push` from treating it as an orphan and
  // guessing a destructive rename (e.g. user_sessions -> a newly added table such
  // as agent_proposals) under `--force`, which would wipe live sessions. Never
  // remove this filter.
  tablesFilter: ["!user_sessions"],
});
