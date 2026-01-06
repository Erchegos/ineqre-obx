import { DailyBarSchema, type DailyBar } from "@ineqre/db";

// compile-time check only
export function validateDailyBar(input: unknown): DailyBar {
  return DailyBarSchema.parse(input);
}

