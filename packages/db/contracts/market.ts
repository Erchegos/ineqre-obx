import { z } from "zod";

export const DailyBarSchema = z.object({
  ticker: z.string(),
  date: z.string(), // YYYY-MM-DD
  open: z.number().nullable(),
  high: z.number().nullable(),
  low: z.number().nullable(),
  close: z.number(),
  volume: z.number(),
  currency: z.string().default("NOK"),
  source: z.string(),
});

export type DailyBar = z.infer<typeof DailyBarSchema>;
