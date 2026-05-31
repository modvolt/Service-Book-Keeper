import { pgTable, varchar, json, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Session store table for connect-pg-simple. The column layout (sid/sess/expire)
 * must match what connect-pg-simple expects. We manage it via Drizzle push
 * instead of `createTableIfMissing`, because that option reads a bundled
 * `table.sql` file which is not present in the esbuild output.
 */
export const userSessionsTable = pgTable(
  "user_sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: json("sess").notNull(),
    expire: timestamp("expire", { precision: 6 }).notNull(),
  },
  (table) => [index("IDX_user_sessions_expire").on(table.expire)],
);
