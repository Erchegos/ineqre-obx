-- update-company-fleet-sizes.sql
-- Update shipping_companies with real fleet sizes and totals

BEGIN;

-- FRO: 70 vessels (35 VLCC + 21 Suezmax + 14 LR2/Aframax)
UPDATE shipping_companies SET
  fleet_size = 70, fleet_owned = 62, fleet_chartered_in = 8,
  avg_vessel_age = 6.5,
  total_dwt = 16200000,
  updated_at = NOW()
WHERE ticker = 'FRO';

-- HAFNI: 50 vessels (10 LR2 + 25 MR + 15 Handy)
UPDATE shipping_companies SET
  fleet_size = 50, fleet_owned = 42, fleet_chartered_in = 8,
  avg_vessel_age = 8.2,
  total_dwt = 2950000,
  updated_at = NOW()
WHERE ticker = 'HAFNI';

-- GOGL: 51 vessels (35 Capesize + 12 Panamax + 4 Ultramax)
UPDATE shipping_companies SET
  fleet_size = 51, fleet_owned = 38, fleet_chartered_in = 13,
  avg_vessel_age = 9.8,
  total_dwt = 9500000,
  updated_at = NOW()
WHERE ticker = 'GOGL';

-- BELCO: 39 Ultramax
UPDATE shipping_companies SET
  fleet_size = 39, fleet_owned = 32, fleet_chartered_in = 7,
  avg_vessel_age = 5.8,
  total_dwt = 2430000,
  updated_at = NOW()
WHERE ticker = 'BELCO';

-- 2020: 6 Newcastlemax (being sold)
UPDATE shipping_companies SET
  fleet_size = 6, fleet_owned = 6, fleet_chartered_in = 0,
  avg_vessel_age = 5.0,
  total_dwt = 1248000,
  updated_at = NOW()
WHERE ticker = '2020';

-- FLNG: 13 LNG carriers
UPDATE shipping_companies SET
  fleet_size = 13, fleet_owned = 13, fleet_chartered_in = 0,
  avg_vessel_age = 4.5,
  total_dwt = 0,
  updated_at = NOW()
WHERE ticker = 'FLNG';

-- BWLPG: 40 VLGCs
UPDATE shipping_companies SET
  fleet_size = 40, fleet_owned = 34, fleet_chartered_in = 6,
  avg_vessel_age = 10.2,
  total_dwt = 0,
  updated_at = NOW()
WHERE ticker = 'BWLPG';

-- HAVI: 30 PCTCs
UPDATE shipping_companies SET
  fleet_size = 30, fleet_owned = 26, fleet_chartered_in = 4,
  avg_vessel_age = 9.5,
  total_dwt = 0,
  updated_at = NOW()
WHERE ticker = 'HAVI';

-- MPCC: 51 container vessels
UPDATE shipping_companies SET
  fleet_size = 51, fleet_owned = 51, fleet_chartered_in = 0,
  avg_vessel_age = 13.8,
  total_dwt = 1600000,
  updated_at = NOW()
WHERE ticker = 'MPCC';

-- ODFJELL-B: 65 chemical tankers
UPDATE shipping_companies SET
  fleet_size = 65, fleet_owned = 42, fleet_chartered_in = 23,
  avg_vessel_age = 11.5,
  total_dwt = 2200000,
  updated_at = NOW()
WHERE ticker = 'ODFJELL-B';

-- Update company_rates with more accurate coverage data for latest quarters
-- Q4 2025 rates with TC coverage percentages

-- FRO
UPDATE shipping_company_rates SET contract_coverage_pct = 46, spot_exposure_pct = 54
WHERE ticker = 'FRO' AND vessel_class = 'VLCC' AND quarter = 'Q4 2025';
UPDATE shipping_company_rates SET contract_coverage_pct = 62, spot_exposure_pct = 38
WHERE ticker = 'FRO' AND vessel_class = 'Suezmax' AND quarter = 'Q4 2025';

-- HAFNI
UPDATE shipping_company_rates SET contract_coverage_pct = 70, spot_exposure_pct = 30
WHERE ticker = 'HAFNI' AND vessel_class = 'LR2' AND quarter = 'Q4 2025';
UPDATE shipping_company_rates SET contract_coverage_pct = 60, spot_exposure_pct = 40
WHERE ticker = 'HAFNI' AND vessel_class = 'MR' AND quarter = 'Q4 2025';

-- GOGL
UPDATE shipping_company_rates SET contract_coverage_pct = 40, spot_exposure_pct = 60
WHERE ticker = 'GOGL' AND vessel_class = 'Capesize' AND quarter = 'Q4 2025';

-- BELCO
UPDATE shipping_company_rates SET contract_coverage_pct = 69, spot_exposure_pct = 31
WHERE ticker = 'BELCO' AND vessel_class = 'Ultramax' AND quarter = 'Q4 2025';

-- FLNG
UPDATE shipping_company_rates SET contract_coverage_pct = 85, spot_exposure_pct = 15
WHERE ticker = 'FLNG' AND vessel_class = 'LNG' AND quarter = 'Q4 2025';

-- BWLPG
UPDATE shipping_company_rates SET contract_coverage_pct = 45, spot_exposure_pct = 55
WHERE ticker = 'BWLPG' AND vessel_class = 'VLGC' AND quarter = 'Q4 2025';

-- HAVI
UPDATE shipping_company_rates SET contract_coverage_pct = 90, spot_exposure_pct = 10
WHERE ticker = 'HAVI' AND vessel_class = 'PCTC' AND quarter = 'Q4 2025';

-- MPCC
UPDATE shipping_company_rates SET contract_coverage_pct = 80, spot_exposure_pct = 20
WHERE ticker = 'MPCC' AND vessel_class = 'Container' AND quarter = 'Q4 2025';

-- ODFJELL-B
UPDATE shipping_company_rates SET contract_coverage_pct = 65, spot_exposure_pct = 35
WHERE ticker = 'ODFJELL-B' AND vessel_class = 'Chemical' AND quarter = 'Q4 2025';

COMMIT;
