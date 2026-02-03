import {
  pgTable,
  bigserial,
  serial,
  varchar,
  date,
  numeric,
  jsonb,
  boolean,
  text,
  integer,
  timestamp,
  unique,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { stocks } from "./001_initial";

/**
 * ML Predictions Table
 *
 * Stores ensemble model predictions for 1-month forward returns:
 * - Individual model predictions (GB, RF)
 * - Ensemble prediction (weighted average)
 * - Probability distribution (5th, 25th, 50th, 75th, 95th percentiles)
 * - Feature importance rankings
 * - Prediction confidence score
 */
export const mlPredictions = pgTable(
  "ml_predictions",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    ticker: varchar("ticker", { length: 20 })
      .notNull()
      .references(() => stocks.ticker, { onDelete: "cascade" }),
    predictionDate: date("prediction_date").notNull(),
    targetDate: date("target_date").notNull(),
    modelVersion: varchar("model_version", { length: 50 }).notNull(),

    // Model predictions
    gbPrediction: numeric("gb_prediction", { precision: 12, scale: 6 }),
    rfPrediction: numeric("rf_prediction", { precision: 12, scale: 6 }),
    ensemblePrediction: numeric("ensemble_prediction", {
      precision: 12,
      scale: 6,
    }),

    // Probability distribution
    p05: numeric("p05", { precision: 12, scale: 6 }),
    p25: numeric("p25", { precision: 12, scale: 6 }),
    p50: numeric("p50", { precision: 12, scale: 6 }),
    p75: numeric("p75", { precision: 12, scale: 6 }),
    p95: numeric("p95", { precision: 12, scale: 6 }),

    // Metadata
    featureImportance: jsonb("feature_importance"),
    confidenceScore: numeric("confidence_score", { precision: 5, scale: 4 }),
    factorsUsed: jsonb("factors_used"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => {
    return {
      // Unique constraint
      tickerPredictionModelUnique: unique().on(
        table.ticker,
        table.predictionDate,
        table.modelVersion
      ),

      // Indexes
      tickerTargetIdx: index("idx_ml_predictions_ticker_target").on(
        table.ticker,
        table.targetDate
      ),
      dateIdx: index("idx_ml_predictions_date").on(table.predictionDate),
      modelVersionIdx: index("idx_ml_predictions_model_version").on(
        table.modelVersion
      ),

      // Check constraint for confidence score
      confidenceCheck: check(
        "ml_predictions_confidence_check",
        sql`${table.confidenceScore} >= 0 AND ${table.confidenceScore} <= 1`
      ),
    };
  }
);

/**
 * ML Model Metadata Table
 *
 * Tracks training runs, hyperparameters, and performance metrics for ML models
 */
export const mlModelMetadata = pgTable("ml_model_metadata", {
  id: serial("id").primaryKey(),
  modelVersion: varchar("model_version", { length: 50 }).notNull().unique(),

  // Training metadata
  trainedAt: timestamp("trained_at", { withTimezone: true }).notNull(),
  trainingStartDate: date("training_start_date").notNull(),
  trainingEndDate: date("training_end_date").notNull(),
  nTrainingSamples: integer("n_training_samples"),

  // Hyperparameters
  gbParams: jsonb("gb_params"),
  rfParams: jsonb("rf_params"),
  ensembleWeights: jsonb("ensemble_weights"),

  // Performance metrics
  trainR2: numeric("train_r2", { precision: 8, scale: 6 }),
  testR2: numeric("test_r2", { precision: 8, scale: 6 }),
  trainMse: numeric("train_mse", { precision: 12, scale: 6 }),
  testMse: numeric("test_mse", { precision: 12, scale: 6 }),
  sharpeRatio: numeric("sharpe_ratio", { precision: 8, scale: 4 }),

  // Feature engineering
  featuresSelected: jsonb("features_selected"),
  featureImportanceAvg: jsonb("feature_importance_avg"),

  // Status
  isActive: boolean("is_active").default(true),
  notes: text("notes"),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type MlPrediction = typeof mlPredictions.$inferSelect;
export type NewMlPrediction = typeof mlPredictions.$inferInsert;

export type MlModelMetadata = typeof mlModelMetadata.$inferSelect;
export type NewMlModelMetadata = typeof mlModelMetadata.$inferInsert;
