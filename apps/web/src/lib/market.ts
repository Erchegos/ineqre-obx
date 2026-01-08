import { z } from "zod"

export const DailyBarSchema = z.object({
  date: z.string(),
  open: z.number().nullable(),
  high: z.number().nullable(),
  low: z.number().nullable(),
  close: z.number().nullable(),
  volume: z.number().nullable().optional(),
})

export type DailyBar = z.infer<typeof DailyBarSchema>
