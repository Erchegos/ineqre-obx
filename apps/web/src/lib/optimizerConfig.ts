/**
 * Optimizer Config Loader
 *
 * Reads per-ticker optimized factor configs produced by the Python
 * ticker_factor_optimizer.py and provides filtered weight objects
 * for the TypeScript prediction pipeline.
 */

import { FACTOR_WEIGHTS_GB, FACTOR_WEIGHTS_RF } from "./factorAdvanced";
import fs from "fs";
import path from "path";

export interface OptimizerConfig {
  ticker: string;
  optimized_at: string;
  optimization_method: string;
  config: {
    factors: string[];
    gb_weight: number;
    rf_weight: number;
    gb_params: Record<string, any>;
    rf_params: Record<string, any>;
  };
  performance: {
    optimized: {
      hit_rate: number;
      mae: number;
      r2: number;
      avg_quintile: number;
      ic: number;
      sharpe: number;
    };
    default_baseline: {
      hit_rate: number;
      mae: number;
      r2: number;
      avg_quintile: number;
    };
    improvement: {
      hit_rate_delta: number;
      mae_delta: number;
    };
  };
  factor_changes: {
    dropped: string[];
    added: string[];
    n_factors: number;
  };
  metadata: {
    n_predictions: number;
    training_periods: number;
  };
}

const configCache = new Map<string, OptimizerConfig | null>();

/**
 * Load optimizer config for a ticker from the JSON files.
 * Returns null if no config exists.
 */
export function loadOptimizerConfig(
  ticker: string
): OptimizerConfig | null {
  const upper = ticker.toUpperCase();
  if (configCache.has(upper)) return configCache.get(upper)!;

  try {
    const configPath = path.join(
      process.cwd(),
      "src",
      "data",
      "optimizer-configs",
      `${upper}.json`
    );
    if (!fs.existsSync(configPath)) {
      configCache.set(upper, null);
      return null;
    }
    const raw = fs.readFileSync(configPath, "utf-8");
    const config: OptimizerConfig = JSON.parse(raw);
    configCache.set(upper, config);
    return config;
  } catch {
    configCache.set(upper, null);
    return null;
  }
}

/**
 * Check whether an optimized config exists for a ticker.
 */
export function hasOptimizerConfig(ticker: string): boolean {
  return loadOptimizerConfig(ticker) !== null;
}

/**
 * Produce filtered GB and RF weight objects that only include
 * the optimizer's selected factors (and their derived interaction /
 * regime-conditional terms).
 */
export function getOptimizedFactorWeights(config: OptimizerConfig): {
  gbWeights: Record<string, number>;
  rfWeights: Record<string, number>;
} {
  const selectedFactors = new Set(config.config.factors);

  const filterWeights = (
    weights: Record<string, number>
  ): Record<string, number> => {
    const filtered: Record<string, number> = {};
    for (const [factor, weight] of Object.entries(weights)) {
      // Direct match
      if (selectedFactors.has(factor)) {
        filtered[factor] = weight;
        continue;
      }
      // Interaction terms: keep if base factor is selected
      // e.g. mom1m_x_nokvol -> base is mom1m
      const interactionMatch = factor.match(/^(\w+?)_x_/);
      if (interactionMatch && selectedFactors.has(interactionMatch[1])) {
        filtered[factor] = weight;
        continue;
      }
      // Regime-conditional: mom1m_highTurnover, mom1m_lowTurnover, etc.
      const regimeMatch = factor.match(
        /^(\w+?)_(highTurnover|lowTurnover|largecap|smallcap)$/
      );
      if (regimeMatch && selectedFactors.has(regimeMatch[1])) {
        filtered[factor] = weight;
        continue;
      }
    }
    return filtered;
  };

  return {
    gbWeights: filterWeights(FACTOR_WEIGHTS_GB),
    rfWeights: filterWeights(FACTOR_WEIGHTS_RF),
  };
}
