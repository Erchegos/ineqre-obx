// packages/db/src/schema/obxFeatures.ts
import { pgTable, text, date, numeric } from "drizzle-orm/pg-core";

export const obxFeatures = pgTable("obx_features", {
  ticker: text("ticker").notNull(),
  date: date("date").notNull(),
  ret1d: numeric("ret_1d", { precision: 18, scale: 10 }).notNull(),
  vol20d: numeric("vol_20d", { precision: 18, scale: 10 }),
});
