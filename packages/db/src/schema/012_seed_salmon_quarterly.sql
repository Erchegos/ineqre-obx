-- Seed: Salmon Quarterly Operations Data
-- Source: Company quarterly reports Q1-Q4 2025 + Q1-Q4 2024 comparisons
-- All per-kg figures in respective reporting currency

-- ===== MOWI (reports in EUR) =====
-- 2024 data from Q1-Q4 2025 reports (prior year comparisons)
INSERT INTO salmon_quarterly_ops (ticker, year, quarter, harvest_tonnes_gwt, revenue_m, ebit_operational_m, ebit_per_kg, cost_per_kg, currency, source) VALUES
('MOWI', 2024, 1, 96495, NULL, NULL, 2.08, 6.05, 'EUR', 'Q1 2025 Report (prior year)'),
('MOWI', 2024, 2, 110419, NULL, NULL, 2.08, 5.84, 'EUR', 'Q2 2025 Report (prior year)'),
('MOWI', 2024, 3, 161020, NULL, NULL, 1.07, 5.72, 'EUR', 'Q3 2025 Report (prior year)'),
('MOWI', 2024, 4, 133596, NULL, 225.9, 1.69, 5.69, 'EUR', 'Q4 2025 Report (prior year)')
ON CONFLICT (ticker, year, quarter) DO UPDATE SET
  harvest_tonnes_gwt = EXCLUDED.harvest_tonnes_gwt,
  revenue_m = EXCLUDED.revenue_m,
  ebit_operational_m = EXCLUDED.ebit_operational_m,
  ebit_per_kg = EXCLUDED.ebit_per_kg,
  cost_per_kg = EXCLUDED.cost_per_kg,
  updated_at = NOW();

-- 2025 data
INSERT INTO salmon_quarterly_ops (ticker, year, quarter, harvest_tonnes_gwt, ebit_operational_m, ebit_per_kg, cost_per_kg, currency, source) VALUES
('MOWI', 2025, 1, 108064, NULL, 1.98, 5.89, 'EUR', 'Mowi Q1 2025 Report'),
('MOWI', 2025, 2, 133239, NULL, 1.41, 5.39, 'EUR', 'Mowi Q2 2025 Report'),
('MOWI', 2025, 3, 165640, NULL, 0.67, 5.42, 'EUR', 'Mowi Q3 2025 Report'),
('MOWI', 2025, 4, 151927, 212.5, 1.40, 5.36, 'EUR', 'Mowi Q4 2025 Report')
ON CONFLICT (ticker, year, quarter) DO UPDATE SET
  harvest_tonnes_gwt = EXCLUDED.harvest_tonnes_gwt,
  ebit_operational_m = EXCLUDED.ebit_operational_m,
  ebit_per_kg = EXCLUDED.ebit_per_kg,
  cost_per_kg = EXCLUDED.cost_per_kg,
  updated_at = NOW();

-- ===== SALM (reports in NOK) =====
-- 2024 data from Q reports (prior year comparisons)
INSERT INTO salmon_quarterly_ops (ticker, year, quarter, harvest_tonnes_gwt, revenue_m, ebit_operational_m, ebit_per_kg, currency, source) VALUES
('SALM', 2024, 1, 52900, 6555, 1521, 28.8, 'NOK', 'SalMar Q1 2025 Report (prior year)'),
('SALM', 2024, 2, 44800, 5838, 1378, 30.7, 'NOK', 'SalMar Q2 2025 Report (prior year)'),
('SALM', 2024, 3, 60300, 6158, 1041, 17.3, 'NOK', 'SalMar Q3 2025 Report (prior year)'),
('SALM', 2024, 4, 73800, 7876, 1489, 20.2, 'NOK', 'SalMar Q4 2025 Report (prior year)')
ON CONFLICT (ticker, year, quarter) DO UPDATE SET
  harvest_tonnes_gwt = EXCLUDED.harvest_tonnes_gwt,
  revenue_m = EXCLUDED.revenue_m,
  ebit_operational_m = EXCLUDED.ebit_operational_m,
  ebit_per_kg = EXCLUDED.ebit_per_kg,
  updated_at = NOW();

-- 2025 data
INSERT INTO salmon_quarterly_ops (ticker, year, quarter, harvest_tonnes_gwt, revenue_m, ebit_operational_m, ebit_per_kg, currency, source) VALUES
('SALM', 2025, 1, 42700, 5193, 798, 18.7, 'NOK', 'SalMar Q1 2025 Report'),
('SALM', 2025, 2, 64500, 6175, 524, 8.1, 'NOK', 'SalMar Q2 2025 Report'),
('SALM', 2025, 3, 93200, 7850, 711, 7.6, 'NOK', 'SalMar Q3 2025 Report'),
('SALM', 2025, 4, 84100, 8176, 1834, 21.8, 'NOK', 'SalMar Q4 2025 Report')
ON CONFLICT (ticker, year, quarter) DO UPDATE SET
  harvest_tonnes_gwt = EXCLUDED.harvest_tonnes_gwt,
  revenue_m = EXCLUDED.revenue_m,
  ebit_operational_m = EXCLUDED.ebit_operational_m,
  ebit_per_kg = EXCLUDED.ebit_per_kg,
  updated_at = NOW();

-- ===== GSF (reports in NOK, continued ops = Rogaland only from Q2 2025) =====
-- 2024 data
INSERT INTO salmon_quarterly_ops (ticker, year, quarter, harvest_tonnes_gwt, ebit_per_kg, cost_per_kg, currency, source) VALUES
('GSF', 2024, 1, NULL, NULL, 63.6, 'NOK', 'GSF Q1 2025 Report (prior year)'),
('GSF', 2024, 2, NULL, NULL, 65.4, 'NOK', 'GSF Q2 2025 Report (prior year)'),
('GSF', 2024, 3, NULL, NULL, 62.0, 'NOK', 'GSF Q3 2025 Report (prior year)'),
('GSF', 2024, 4, 8074, 8.3, 62.6, 'NOK', 'GSF Q4 2025 Report (prior year)')
ON CONFLICT (ticker, year, quarter) DO UPDATE SET
  harvest_tonnes_gwt = EXCLUDED.harvest_tonnes_gwt,
  ebit_per_kg = EXCLUDED.ebit_per_kg,
  cost_per_kg = EXCLUDED.cost_per_kg,
  updated_at = NOW();

-- 2025 data (continued operations - Rogaland)
INSERT INTO salmon_quarterly_ops (ticker, year, quarter, harvest_tonnes_gwt, revenue_m, ebit_operational_m, ebit_per_kg, cost_per_kg, price_realization_per_kg, currency, source) VALUES
('GSF', 2025, 1, 8850, NULL, NULL, 16.5, 54.7, NULL, 'NOK', 'GSF Q1 2025 Report'),
('GSF', 2025, 2, 7419, NULL, NULL, 35.1, 58.3, NULL, 'NOK', 'GSF Q2 2025 Report'),
('GSF', 2025, 3, 6820, NULL, 15, 3.2, 70.4, NULL, 'NOK', 'GSF Q3 2025 Report'),
('GSF', 2025, 4, 7372, 971, 143, 19.4, 63.6, 84.3, 'NOK', 'GSF Q4 2025 Report')
ON CONFLICT (ticker, year, quarter) DO UPDATE SET
  harvest_tonnes_gwt = EXCLUDED.harvest_tonnes_gwt,
  revenue_m = EXCLUDED.revenue_m,
  ebit_operational_m = EXCLUDED.ebit_operational_m,
  ebit_per_kg = EXCLUDED.ebit_per_kg,
  cost_per_kg = EXCLUDED.cost_per_kg,
  price_realization_per_kg = EXCLUDED.price_realization_per_kg,
  updated_at = NOW();

-- ===== LSG (reports in NOK) =====
-- 2024 data from Q reports
INSERT INTO salmon_quarterly_ops (ticker, year, quarter, harvest_tonnes_gwt, ebit_operational_m, ebit_per_kg, currency, source) VALUES
('LSG', 2024, 1, 26400, 842, 28.5, 'NOK', 'LSG Q1 2025 Report (prior year)'),
('LSG', 2024, 2, 36700, NULL, 27.1, 'NOK', 'LSG Q2 2025 Report (prior year)'),
('LSG', 2024, 3, 51400, 412, 10.3, 'NOK', 'LSG Q3 2025 Report (prior year)'),
('LSG', 2024, 4, 56800, 799, 15.3, 'NOK', 'LSG Q4 2025 Report (prior year)')
ON CONFLICT (ticker, year, quarter) DO UPDATE SET
  harvest_tonnes_gwt = EXCLUDED.harvest_tonnes_gwt,
  ebit_operational_m = EXCLUDED.ebit_operational_m,
  ebit_per_kg = EXCLUDED.ebit_per_kg,
  updated_at = NOW();

-- 2025 data
INSERT INTO salmon_quarterly_ops (ticker, year, quarter, harvest_tonnes_gwt, ebit_operational_m, ebit_per_kg, currency, source) VALUES
('LSG', 2025, 1, 38200, 1049, 26.2, 'NOK', 'LSG Q1 2025 Report'),
('LSG', 2025, 2, 48900, NULL, 12.4, 'NOK', 'LSG Q2 2025 Report'),
('LSG', 2025, 3, 59200, 15, 1.7, 'NOK', 'LSG Q3 2025 Report'),
('LSG', 2025, 4, 49200, 758, 17.9, 'NOK', 'LSG Q4 2025 Report')
ON CONFLICT (ticker, year, quarter) DO UPDATE SET
  harvest_tonnes_gwt = EXCLUDED.harvest_tonnes_gwt,
  ebit_operational_m = EXCLUDED.ebit_operational_m,
  ebit_per_kg = EXCLUDED.ebit_per_kg,
  updated_at = NOW();

-- ===== BAKKA (reports in DKK, Farming FO = Faroe Islands farming) =====
-- 2024 data (farming FO segment)
INSERT INTO salmon_quarterly_ops (ticker, year, quarter, harvest_tonnes_gwt, ebit_operational_m, ebit_per_kg, currency, source) VALUES
('BAKKA', 2024, 1, 21557, 710, 33.03, 'DKK', 'Bakkafrost Q1 2025 (prior year)'),
('BAKKA', 2024, 2, 21592, 388, 20.15, 'DKK', 'Bakkafrost Q2 2025 (prior year)'),
('BAKKA', 2024, 3, 27029, 173, -1.31, 'DKK', 'Bakkafrost Q3 2025 (prior year)'),
('BAKKA', 2024, 4, 20478, 280, 5.98, 'DKK', 'Bakkafrost Q4 2025 (prior year)')
ON CONFLICT (ticker, year, quarter) DO UPDATE SET
  harvest_tonnes_gwt = EXCLUDED.harvest_tonnes_gwt,
  ebit_operational_m = EXCLUDED.ebit_operational_m,
  ebit_per_kg = EXCLUDED.ebit_per_kg,
  updated_at = NOW();

-- 2025 data (farming FO segment)
INSERT INTO salmon_quarterly_ops (ticker, year, quarter, harvest_tonnes_gwt, ebit_operational_m, ebit_per_kg, currency, source) VALUES
('BAKKA', 2025, 1, 25200, 505, 15.15, 'DKK', 'Bakkafrost Q1 2025 Report'),
('BAKKA', 2025, 2, 23100, 65, 0.24, 'DKK', 'Bakkafrost Q2 2025 Report'),
('BAKKA', 2025, 3, 30700, 22, -1.13, 'DKK', 'Bakkafrost Q3 2025 Report'),
('BAKKA', 2025, 4, 27891, 295, 7.34, 'DKK', 'Bakkafrost Q4 2025 Report')
ON CONFLICT (ticker, year, quarter) DO UPDATE SET
  harvest_tonnes_gwt = EXCLUDED.harvest_tonnes_gwt,
  ebit_operational_m = EXCLUDED.ebit_operational_m,
  ebit_per_kg = EXCLUDED.ebit_per_kg,
  updated_at = NOW();

-- ===== AUSS (holding company, reports LSG subsidiary data in NOK) =====
-- AUSS reports consolidated data, salmon ops come from LSG subsidiary
-- Using AUSS consolidated EBIT (adj) which includes LSG + pelagic + other
INSERT INTO salmon_quarterly_ops (ticker, year, quarter, harvest_tonnes_gwt, revenue_m, ebit_operational_m, ebit_per_kg, currency, source) VALUES
('AUSS', 2024, 1, 26400, NULL, NULL, 28.5, 'NOK', 'AUSS Q1 2025 (LSG subsidiary, prior year)'),
('AUSS', 2024, 2, 36700, NULL, NULL, 27.1, 'NOK', 'AUSS Q2 2025 (LSG subsidiary, prior year)'),
('AUSS', 2024, 3, 51400, NULL, NULL, 10.3, 'NOK', 'AUSS Q3 2025 (LSG subsidiary, prior year)'),
('AUSS', 2024, 4, 56800, 9096, 845, 15.3, 'NOK', 'AUSS Q4 2025 Report (prior year)')
ON CONFLICT (ticker, year, quarter) DO UPDATE SET
  harvest_tonnes_gwt = EXCLUDED.harvest_tonnes_gwt,
  revenue_m = EXCLUDED.revenue_m,
  ebit_operational_m = EXCLUDED.ebit_operational_m,
  ebit_per_kg = EXCLUDED.ebit_per_kg,
  updated_at = NOW();

INSERT INTO salmon_quarterly_ops (ticker, year, quarter, harvest_tonnes_gwt, revenue_m, ebit_operational_m, ebit_per_kg, currency, source) VALUES
('AUSS', 2025, 1, 38200, NULL, NULL, 26.2, 'NOK', 'AUSS Q1 2025 (LSG subsidiary)'),
('AUSS', 2025, 2, 48900, NULL, NULL, 12.4, 'NOK', 'AUSS Q2 2025 (LSG subsidiary)'),
('AUSS', 2025, 3, 59200, NULL, NULL, 1.7, 'NOK', 'AUSS Q3 2025 (LSG subsidiary)'),
('AUSS', 2025, 4, 49200, 9410, 769, 17.9, 'NOK', 'AUSS Q4 2025 Report')
ON CONFLICT (ticker, year, quarter) DO UPDATE SET
  harvest_tonnes_gwt = EXCLUDED.harvest_tonnes_gwt,
  revenue_m = EXCLUDED.revenue_m,
  ebit_operational_m = EXCLUDED.ebit_operational_m,
  ebit_per_kg = EXCLUDED.ebit_per_kg,
  updated_at = NOW();
