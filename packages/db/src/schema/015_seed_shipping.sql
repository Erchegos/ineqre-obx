-- 015_seed_shipping.sql
-- Seed data for shipping intelligence terminal
-- Covers: companies, vessels, positions, contracts, company rates, market rates, ports
-- All inserts use ON CONFLICT DO NOTHING for idempotency

BEGIN;

-- ============================================================================
-- 1. STOCKS — Insert missing shipping tickers into master stocks table
-- ============================================================================

INSERT INTO stocks (ticker, name, sector, exchange, currency, is_active)
VALUES
  ('GOGL',     'Golden Ocean Group',    'Shipping', 'OSE', 'NOK', true),
  ('MPCC',     'MPC Container Ships',   'Shipping', 'OSE', 'NOK', true),
  ('BELCO',    'Belships',              'Shipping', 'OSE', 'NOK', true),
  ('ODFJELL-B','Odfjell SE',            'Shipping', 'OSE', 'NOK', true),
  ('BWLPG',   'BW LPG',                'Shipping', 'OSE', 'NOK', true)
ON CONFLICT DO NOTHING;


-- ============================================================================
-- 2. SHIPPING COMPANIES — 10 OSE-listed shipping companies
-- ============================================================================

INSERT INTO shipping_companies
  (ticker, company_name, sector, fleet_size, fleet_owned, fleet_chartered_in, avg_vessel_age, total_dwt, headquarters, color_hex)
VALUES
  ('FRO',      'Frontline',             'tanker',       82, 72, 10,  5.2, 18400000, 'Hamilton, Bermuda',   '#E63946'),
  ('HAFNI',    'Hafnia',                'tanker',       37, 30,  7,  7.8,  4200000, 'Copenhagen, Denmark', '#BC4749'),
  ('GOGL',     'Golden Ocean',          'dry_bulk',     81, 52, 29,  8.1, 12600000, 'Hamilton, Bermuda',   '#457B9D'),
  ('BELCO',    'Belships',              'dry_bulk',     32, 24,  8,  9.5,  1950000, 'Oslo, Norway',        '#264653'),
  ('2020',     '2020 Bulkers',          'dry_bulk',      8,  8,  0,  4.0,  1600000, 'Hamilton, Bermuda',   '#6A994E'),
  ('MPCC',     'MPC Container Ships',   'container',    67, 67,  0, 12.3,   850000, 'Oslo, Norway',        '#F4A261'),
  ('HAVI',     'Höegh Autoliners',      'car_carrier',  40, 36,  4,  8.3,        0, 'Oslo, Norway',        '#E9C46A'),
  ('ODFJELL-B','Odfjell SE',            'chemical',     74, 48, 26, 10.1,  1800000, 'Bergen, Norway',      '#2A9D8F'),
  ('FLNG',     'Flex LNG',              'gas',          13, 13,  0,  4.5,        0, 'Hamilton, Bermuda',   '#7209B7'),
  ('BWLPG',   'BW LPG',                'gas',          46, 38,  8,  9.2,        0, 'Oslo, Norway',        '#4361EE')
ON CONFLICT (ticker) DO NOTHING;


-- ============================================================================
-- 3. SHIPPING VESSELS — 30 vessels (3 per company), real names and IMOs
-- ============================================================================

INSERT INTO shipping_vessels
  (imo, vessel_name, vessel_type, company_ticker, dwt, teu, cbm, built_year, flag, class_society, scrubber_fitted, ice_class, status)
VALUES
  -- FRO (Frontline) — tankers
  ('9806089', 'Front Alta',        'vlcc',          'FRO',  300000, NULL, NULL, 2019, 'Marshall Islands', 'DNV', true,  NULL, 'active'),
  ('9348906', 'Front Njord',       'suezmax',       'FRO',  157000, NULL, NULL, 2009, 'Marshall Islands', 'DNV', false, NULL, 'active'),
  ('9806091', 'Front Eminence',    'aframax_lr2',   'FRO',  115000, NULL, NULL, 2019, 'Marshall Islands', 'DNV', false, NULL, 'active'),

  -- HAFNI (Hafnia) — product tankers
  ('9858272', 'Hafnia Lotte',      'mr_tanker',     'HAFNI',  50000, NULL, NULL, 2020, 'Singapore',        'Lloyd''s', false, NULL, 'active'),
  ('9828143', 'Hafnia Phoenix',    'lr2_tanker',    'HAFNI', 110000, NULL, NULL, 2019, 'Singapore',        'DNV',      false, NULL, 'active'),
  ('9723965', 'Hafnia Courage',    'handy_tanker',  'HAFNI',  38000, NULL, NULL, 2016, 'Marshall Islands', 'BV',       false, NULL, 'active'),

  -- GOGL (Golden Ocean) — dry bulk
  ('9840746', 'Golden Monterey',   'capesize',      'GOGL', 208000, NULL, NULL, 2022, 'Marshall Islands', 'DNV', false, NULL, 'active'),
  ('9304831', 'Golden Hawk',       'panamax_bulk',  'GOGL',  76000, NULL, NULL, 2006, 'Marshall Islands', 'BV',  false, NULL, 'active'),
  ('9840758', 'Golden Opus',       'capesize',      'GOGL', 208000, NULL, NULL, 2022, 'Marshall Islands', 'DNV', false, NULL, 'active'),

  -- BELCO (Belships) — dry bulk
  ('9901764', 'Belfriend',         'ultramax',      'BELCO',  63500, NULL, NULL, 2022, 'Norway',           'DNV', false, NULL, 'active'),
  ('9901776', 'Belforest',         'ultramax',      'BELCO',  63500, NULL, NULL, 2022, 'Norway',           'DNV', false, NULL, 'active'),
  ('9847382', 'Belvista',          'supramax',      'BELCO',  58000, NULL, NULL, 2020, 'Marshall Islands', 'BV',  false, NULL, 'active'),

  -- 2020 (2020 Bulkers) — newcastlemax dry bulk
  ('9855072', 'Bulk Shenzhen',     'newcastlemax',  '2020',  208000, NULL, NULL, 2020, 'Marshall Islands', 'DNV', false, NULL, 'active'),
  ('9855084', 'Bulk Shanghai',     'newcastlemax',  '2020',  208000, NULL, NULL, 2020, 'Marshall Islands', 'DNV', false, NULL, 'active'),
  ('9855096', 'Bulk Sandefjord',   'newcastlemax',  '2020',  208000, NULL, NULL, 2020, 'Marshall Islands', 'DNV', false, NULL, 'active'),

  -- MPCC (MPC Container Ships) — containers
  ('9354845', 'AS Carelia',        'container_feeder',     'MPCC',  90000, 8600, NULL, 2008, 'Liberia',              'DNV', false, NULL, 'active'),
  ('9354857', 'AS Clarita',        'container_subpanamax', 'MPCC',  42000, 3500, NULL, 2008, 'Liberia',              'DNV', false, NULL, 'active'),
  ('9297591', 'MPCC Bilbao',       'container_feeder',     'MPCC',  23000, 1700, NULL, 2005, 'Antigua and Barbuda',  'BV',  false, NULL, 'active'),

  -- HAVI (Höegh Autoliners) — car carriers (PCTC)
  ('9919217', 'Höegh Aurora',      'pctc',          'HAVI',      0, NULL, NULL, 2024, 'Norway', 'DNV', false, '1A',  'active'),
  ('9684993', 'Höegh Jacksonville','pctc',          'HAVI',      0, NULL, NULL, 2015, 'Norway', 'DNV', false, NULL,  'active'),
  ('9684981', 'Höegh Trapper',     'pctc',          'HAVI',      0, NULL, NULL, 2015, 'Norway', 'DNV', false, NULL,  'active'),

  -- ODFJELL-B (Odfjell SE) — chemical tankers
  ('9796218', 'Bow Trident',       'chemical_tanker','ODFJELL-B', 49000, NULL, NULL, 2019, 'Norway',           'DNV', false, NULL, 'active'),
  ('9370803', 'Bow Fortune',       'chemical_tanker','ODFJELL-B', 37500, NULL, NULL, 2008, 'Marshall Islands', 'DNV', false, NULL, 'active'),
  ('9370815', 'Bow Architect',     'chemical_tanker','ODFJELL-B', 37500, NULL, NULL, 2008, 'Marshall Islands', 'DNV', false, NULL, 'active'),

  -- FLNG (Flex LNG) — LNG carriers
  ('9787198', 'Flex Endeavour',    'lng_carrier',   'FLNG',      0, NULL, 173400, 2018, 'Marshall Islands', 'DNV', false, NULL, 'active'),
  ('9750489', 'Flex Ranger',       'lng_carrier',   'FLNG',      0, NULL, 173400, 2018, 'Marshall Islands', 'DNV', false, NULL, 'active'),
  ('9787203', 'Flex Constellation','lng_carrier',   'FLNG',      0, NULL, 173400, 2019, 'Marshall Islands', 'DNV', false, NULL, 'active'),

  -- BWLPG (BW LPG) — VLGC
  ('9728648', 'BW Magellan',       'vlgc',          'BWLPG',  52000, NULL, 84000, 2016, 'Singapore', 'DNV', false, NULL, 'active'),
  ('9728650', 'BW Gemini',         'vlgc',          'BWLPG',  52000, NULL, 84000, 2016, 'Singapore', 'DNV', false, NULL, 'active'),
  ('9234984', 'BW Balder',         'vlgc',          'BWLPG',  51000, NULL, 82000, 2003, 'Singapore', 'LR',  false, NULL, 'active')
ON CONFLICT (imo) DO NOTHING;


-- ============================================================================
-- 4. SHIPPING POSITIONS — AIS snapshot for all 30 vessels (2026-03-04 08:00 UTC)
-- ============================================================================

INSERT INTO shipping_positions
  (imo, latitude, longitude, speed_knots, heading, destination, nav_status, operational_status, current_region, reported_at, source)
VALUES
  -- FRO vessels
  ('9806089',  25.200000,  56.800000, 12.5, 180, 'FUJAIRAH',       'under_way', 'at_sea',       'Arabian Gulf',  '2026-03-04 08:00:00+00', 'mock'),
  ('9348906',  51.900000,   1.800000, 10.2,  45, 'ROTTERDAM',      'under_way', 'at_sea',       'North Sea',     '2026-03-04 08:00:00+00', 'mock'),
  ('9806091',   5.300000,   3.400000,  0.0,   0, 'BONNY',          'at_anchor', 'anchored',     'West Africa',   '2026-03-04 08:00:00+00', 'mock'),

  -- HAFNI vessels
  ('9858272',   1.280000, 103.850000,  0.0,   0, 'SINGAPORE',      'moored',    'in_port',      'SE Asia',       '2026-03-04 08:00:00+00', 'mock'),
  ('9828143',  29.000000,  48.100000,  0.0,   0, 'SINGAPORE',      'moored',    'loading',      'Arabian Gulf',  '2026-03-04 08:00:00+00', 'mock'),
  ('9723965',  36.100000,  -5.300000, 14.0,  90, 'HOUSTON',        'under_way', 'at_sea',       'Mediterranean', '2026-03-04 08:00:00+00', 'mock'),

  -- GOGL vessels
  ('9840746', -23.900000, -46.300000,  0.0,   0, 'QINGDAO',        'moored',    'loading',      'South America', '2026-03-04 08:00:00+00', 'mock'),
  ('9304831',  36.000000, 140.500000, 11.5, 210, 'NEWCASTLE AU',   'under_way', 'at_sea',       'Pacific',       '2026-03-04 08:00:00+00', 'mock'),
  ('9840758', -20.300000, 118.600000,  0.0,   0, 'DALIAN',         'moored',    'loading',      'Australia',     '2026-03-04 08:00:00+00', 'mock'),

  -- BELCO vessels
  ('9901764',  30.600000,  32.300000,  7.0, 340, 'RAVENNA',        'under_way', 'at_sea',       'Red Sea',       '2026-03-04 08:00:00+00', 'mock'),
  ('9901776',  10.300000, 107.100000, 12.0,  45, 'TOKYO',          'under_way', 'at_sea',       'SE Asia',       '2026-03-04 08:00:00+00', 'mock'),
  ('9847382',  45.400000, -73.500000,  0.0,   0, 'MONTREAL',       'moored',    'discharging',  'Great Lakes',   '2026-03-04 08:00:00+00', 'mock'),

  -- 2020 vessels
  ('9855072',  35.000000, 129.000000,  0.0,   0, 'GWANGYANG',      'at_anchor', 'waiting',      'East Asia',     '2026-03-04 08:00:00+00', 'mock'),
  ('9855084', -30.000000, -47.000000, 13.5, 120, 'NINGBO',         'under_way', 'at_sea',       'South Atlantic','2026-03-04 08:00:00+00', 'mock'),
  ('9855096',  12.000000,  44.000000, 14.0,  90, 'SINGAPORE',      'under_way', 'at_sea',       'Indian Ocean',  '2026-03-04 08:00:00+00', 'mock'),

  -- MPCC vessels
  ('9354845',   4.000000, 100.000000, 16.0, 315, 'HAMBURG',        'under_way', 'at_sea',       'SE Asia',       '2026-03-04 08:00:00+00', 'mock'),
  ('9354857',  53.500000,   9.900000,  0.0,   0, 'HAMBURG',        'moored',    'discharging',  'North Europe',  '2026-03-04 08:00:00+00', 'mock'),
  ('9297591',  43.300000,  -3.000000,  0.0,   0, 'TANGIER',        'moored',    'loading',      'West Europe',   '2026-03-04 08:00:00+00', 'mock'),

  -- HAVI vessels
  ('9919217',  34.500000, 136.800000,  0.0,   0, 'BREMERHAVEN',    'moored',    'loading',      'East Asia',     '2026-03-04 08:00:00+00', 'mock'),
  ('9684993',  30.400000, -81.700000,  0.0,   0, 'JACKSONVILLE',   'moored',    'discharging',  'US East Coast', '2026-03-04 08:00:00+00', 'mock'),
  ('9684981',  22.300000,  39.100000,  0.0,   0, 'JEDDAH',         'moored',    'discharging',  'Red Sea',       '2026-03-04 08:00:00+00', 'mock'),

  -- ODFJELL-B vessels
  ('9796218',  29.700000, -95.000000,  0.0,   0, 'ANTWERP',        'moored',    'loading',      'US Gulf',       '2026-03-04 08:00:00+00', 'mock'),
  ('9370803',  51.300000,   4.300000,  0.0,   0, 'ANTWERP',        'moored',    'discharging',  'North Europe',  '2026-03-04 08:00:00+00', 'mock'),
  ('9370815',  37.900000,-122.400000,  8.0, 210, 'BUSAN',          'under_way', 'at_sea',       'US West Coast', '2026-03-04 08:00:00+00', 'mock'),

  -- FLNG vessels
  ('9787198',  60.300000,   5.000000,  0.0,   0, 'COVE POINT',     'at_anchor', 'waiting',      'North Sea',     '2026-03-04 08:00:00+00', 'mock'),
  ('9750489',  25.400000,  51.500000,  0.0,   0, 'INCHEON',        'moored',    'loading',      'Arabian Gulf',  '2026-03-04 08:00:00+00', 'mock'),
  ('9787203',  33.300000, 131.000000, 17.5,  45, 'TOBATA',         'under_way', 'at_sea',       'Pacific',       '2026-03-04 08:00:00+00', 'mock'),

  -- BWLPG vessels
  ('9728648',  26.500000,  50.500000,  0.0,   0, 'CHIBA',          'moored',    'loading',      'Arabian Gulf',  '2026-03-04 08:00:00+00', 'mock'),
  ('9728650', -33.900000,  18.400000, 14.0,  90, 'MUMBAI',         'under_way', 'at_sea',       'South Africa',  '2026-03-04 08:00:00+00', 'mock'),
  ('9234984',   1.100000, 103.700000,  0.0,   0, 'SINGAPORE',      'at_anchor', 'waiting',      'SE Asia',       '2026-03-04 08:00:00+00', 'mock');


-- ============================================================================
-- 5. SHIPPING VESSEL CONTRACTS — per-vessel charter employment (30 contracts)
-- ============================================================================

INSERT INTO shipping_vessel_contracts
  (imo, contract_type, rate_usd_per_day, rate_worldscale, charterer, contract_start, contract_end, contract_duration_months, is_current, source_quarter, notes)
VALUES
  -- FRO (Frontline)
  ('9806089', 'time_charter',   48000.00, NULL,  'Shell',              '2024-06-01', '2025-06-30', 12, true, 'Q4 2024', NULL),
  ('9348906', 'spot',           42000.00, 55.0,  'Trafigura',         '2025-02-15',  NULL,         NULL, true, 'Q4 2024', NULL),
  ('9806091', 'time_charter',   38000.00, NULL,  'Vitol',             '2024-09-01', '2025-08-31', 12, true, 'Q4 2024', NULL),

  -- HAFNI (Hafnia)
  ('9858272', 'spot',           28000.00, NULL,   NULL,                NULL,          NULL,         NULL, true, 'Q4 2024', NULL),
  ('9828143', 'time_charter',   36000.00, NULL,  'BP',                '2024-07-01', '2025-06-30', 12, true, 'Q4 2024', NULL),
  ('9723965', 'pool',           25000.00, NULL,  'Hafnia Pool',        NULL,          NULL,         NULL, true, 'Q4 2024', 'Pool rate, variable'),

  -- GOGL (Golden Ocean)
  ('9840746', 'time_charter',   26500.00, NULL,  'Cargill',           '2024-04-01', '2025-03-31', 12, true, 'Q4 2024', NULL),
  ('9304831', 'pool',           16800.00, NULL,  'Golden Ocean Pool',  NULL,          NULL,         NULL, true, 'Q4 2024', NULL),
  ('9840758', 'spot',           28000.00, NULL,   NULL,                NULL,          NULL,         NULL, true, 'Q4 2024', NULL),

  -- BELCO (Belships)
  ('9901764', 'time_charter',   15500.00, NULL,  'Koch Shipping',     '2024-01-15', '2025-07-14', 18, true, 'Q4 2024', NULL),
  ('9901776', 'time_charter',   16200.00, NULL,  'Oldendorff',        '2024-06-01', '2025-05-31', 12, true, 'Q4 2024', NULL),
  ('9847382', 'spot',           14000.00, NULL,   NULL,                NULL,          NULL,         NULL, true, 'Q4 2024', NULL),

  -- 2020 (2020 Bulkers)
  ('9855072', 'time_charter',   29000.00, NULL,  'COSCO',             '2024-03-01', '2025-02-28', 12, true, 'Q4 2024', NULL),
  ('9855084', 'pool',           27500.00, NULL,  '2020 Pool',          NULL,          NULL,         NULL, true, 'Q4 2024', NULL),
  ('9855096', 'spot',           31000.00, NULL,   NULL,                NULL,          NULL,         NULL, true, 'Q4 2024', NULL),

  -- MPCC (MPC Container Ships)
  ('9354845', 'time_charter',   22000.00, NULL,  'MSC',               '2023-06-01', '2025-05-31', 24, true, 'Q4 2024', NULL),
  ('9354857', 'time_charter',   18500.00, NULL,  'Hapag-Lloyd',       '2024-01-01', '2025-12-31', 24, true, 'Q4 2024', NULL),
  ('9297591', 'time_charter',   12000.00, NULL,  'CMA CGM',           '2024-09-01', '2025-08-31', 12, true, 'Q4 2024', NULL),

  -- HAVI (Höegh Autoliners)
  ('9919217', 'time_charter',   62000.00, NULL,  'Volkswagen Logistics', '2024-01-01', '2026-12-31', 36, true, 'Q4 2024', NULL),
  ('9684993', 'time_charter',   52000.00, NULL,  'Wallenius Wilhelmsen', '2024-06-01', '2025-05-31', 12, true, 'Q4 2024', NULL),
  ('9684981', 'coa',            48000.00, NULL,  'NYK RORO',          '2024-03-01', '2025-02-28', 12, true, 'Q4 2024', NULL),

  -- ODFJELL-B (Odfjell SE)
  ('9796218', 'coa',            24000.00, NULL,  'BASF',              '2024-01-01', '2025-12-31', 24, true, 'Q4 2024', NULL),
  ('9370803', 'time_charter',   21000.00, NULL,  'Stolt-Nielsen',     '2024-04-01', '2025-03-31', 12, true, 'Q4 2024', NULL),
  ('9370815', 'pool',           19500.00, NULL,  'Odfjell Pool',       NULL,          NULL,         NULL, true, 'Q4 2024', NULL),

  -- FLNG (Flex LNG)
  ('9787198', 'time_charter',   85000.00, NULL,  'Cheniere',          '2023-01-01', '2030-12-31', 96, true, 'Q4 2024', NULL),
  ('9750489', 'time_charter',   82000.00, NULL,  'Shell',             '2023-06-01', '2030-05-31', 84, true, 'Q4 2024', NULL),
  ('9787203', 'time_charter',   88000.00, NULL,  'TotalEnergies',     '2023-03-01', '2030-02-28', 84, true, 'Q4 2024', NULL),

  -- BWLPG (BW LPG)
  ('9728648', 'time_charter',   42000.00, NULL,  'Petredec',          '2024-07-01', '2025-06-30', 12, true, 'Q4 2024', NULL),
  ('9728650', 'pool',           38000.00, NULL,  'BW LPG Pool',       NULL,          NULL,         NULL, true, 'Q4 2024', NULL),
  ('9234984', 'spot',           35000.00, NULL,   NULL,                NULL,          NULL,         NULL, true, 'Q4 2024', NULL);


-- ============================================================================
-- 6. SHIPPING COMPANY RATES — 8 quarters of rate history per vessel class
--    Quarters: Q1 2024 through Q4 2025
-- ============================================================================

-- FRO — VLCC rates
INSERT INTO shipping_company_rates (ticker, vessel_class, rate_type, rate_usd_per_day, contract_coverage_pct, spot_exposure_pct, quarter)
VALUES
  ('FRO', 'VLCC',    'tc_equivalent', 42000.00, 55.0, 45.0, 'Q1 2024'),
  ('FRO', 'VLCC',    'tc_equivalent', 38000.00, 50.0, 50.0, 'Q2 2024'),
  ('FRO', 'VLCC',    'tc_equivalent', 48000.00, 60.0, 40.0, 'Q3 2024'),
  ('FRO', 'VLCC',    'tc_equivalent', 46000.00, 58.0, 42.0, 'Q4 2024'),
  ('FRO', 'VLCC',    'tc_equivalent', 44000.00, 55.0, 45.0, 'Q1 2025'),
  ('FRO', 'VLCC',    'tc_equivalent', 40000.00, 52.0, 48.0, 'Q2 2025'),
  ('FRO', 'VLCC',    'tc_equivalent', 50000.00, 62.0, 38.0, 'Q3 2025'),
  ('FRO', 'VLCC',    'tc_equivalent', 48000.00, 60.0, 40.0, 'Q4 2025')
ON CONFLICT (ticker, quarter, vessel_class) DO NOTHING;

-- FRO — Suezmax rates
INSERT INTO shipping_company_rates (ticker, vessel_class, rate_type, rate_usd_per_day, contract_coverage_pct, spot_exposure_pct, quarter)
VALUES
  ('FRO', 'Suezmax', 'tc_equivalent', 38000.00, 50.0, 50.0, 'Q1 2024'),
  ('FRO', 'Suezmax', 'tc_equivalent', 34000.00, 45.0, 55.0, 'Q2 2024'),
  ('FRO', 'Suezmax', 'tc_equivalent', 42000.00, 55.0, 45.0, 'Q3 2024'),
  ('FRO', 'Suezmax', 'tc_equivalent', 40000.00, 52.0, 48.0, 'Q4 2024'),
  ('FRO', 'Suezmax', 'tc_equivalent', 39000.00, 50.0, 50.0, 'Q1 2025'),
  ('FRO', 'Suezmax', 'tc_equivalent', 36000.00, 48.0, 52.0, 'Q2 2025'),
  ('FRO', 'Suezmax', 'tc_equivalent', 44000.00, 58.0, 42.0, 'Q3 2025'),
  ('FRO', 'Suezmax', 'tc_equivalent', 42000.00, 55.0, 45.0, 'Q4 2025')
ON CONFLICT (ticker, quarter, vessel_class) DO NOTHING;

-- GOGL — Capesize rates
INSERT INTO shipping_company_rates (ticker, vessel_class, rate_type, rate_usd_per_day, contract_coverage_pct, spot_exposure_pct, quarter)
VALUES
  ('GOGL', 'Capesize', 'tc_equivalent', 22000.00, 40.0, 60.0, 'Q1 2024'),
  ('GOGL', 'Capesize', 'tc_equivalent', 18000.00, 35.0, 65.0, 'Q2 2024'),
  ('GOGL', 'Capesize', 'tc_equivalent', 26000.00, 45.0, 55.0, 'Q3 2024'),
  ('GOGL', 'Capesize', 'tc_equivalent', 27500.00, 48.0, 52.0, 'Q4 2024'),
  ('GOGL', 'Capesize', 'tc_equivalent', 24000.00, 42.0, 58.0, 'Q1 2025'),
  ('GOGL', 'Capesize', 'tc_equivalent', 20000.00, 38.0, 62.0, 'Q2 2025'),
  ('GOGL', 'Capesize', 'tc_equivalent', 28000.00, 50.0, 50.0, 'Q3 2025'),
  ('GOGL', 'Capesize', 'tc_equivalent', 26500.00, 47.0, 53.0, 'Q4 2025')
ON CONFLICT (ticker, quarter, vessel_class) DO NOTHING;

-- GOGL — Panamax rates
INSERT INTO shipping_company_rates (ticker, vessel_class, rate_type, rate_usd_per_day, contract_coverage_pct, spot_exposure_pct, quarter)
VALUES
  ('GOGL', 'Panamax', 'tc_equivalent', 14500.00, 45.0, 55.0, 'Q1 2024'),
  ('GOGL', 'Panamax', 'tc_equivalent', 12000.00, 40.0, 60.0, 'Q2 2024'),
  ('GOGL', 'Panamax', 'tc_equivalent', 17000.00, 50.0, 50.0, 'Q3 2024'),
  ('GOGL', 'Panamax', 'tc_equivalent', 16800.00, 48.0, 52.0, 'Q4 2024'),
  ('GOGL', 'Panamax', 'tc_equivalent', 15500.00, 46.0, 54.0, 'Q1 2025'),
  ('GOGL', 'Panamax', 'tc_equivalent', 13500.00, 42.0, 58.0, 'Q2 2025'),
  ('GOGL', 'Panamax', 'tc_equivalent', 18000.00, 52.0, 48.0, 'Q3 2025'),
  ('GOGL', 'Panamax', 'tc_equivalent', 17200.00, 50.0, 50.0, 'Q4 2025')
ON CONFLICT (ticker, quarter, vessel_class) DO NOTHING;

-- BELCO — Supramax rates
INSERT INTO shipping_company_rates (ticker, vessel_class, rate_type, rate_usd_per_day, contract_coverage_pct, spot_exposure_pct, quarter)
VALUES
  ('BELCO', 'Supramax', 'tc_equivalent', 13000.00, 65.0, 35.0, 'Q1 2024'),
  ('BELCO', 'Supramax', 'tc_equivalent', 11500.00, 60.0, 40.0, 'Q2 2024'),
  ('BELCO', 'Supramax', 'tc_equivalent', 15000.00, 70.0, 30.0, 'Q3 2024'),
  ('BELCO', 'Supramax', 'tc_equivalent', 14800.00, 68.0, 32.0, 'Q4 2024'),
  ('BELCO', 'Supramax', 'tc_equivalent', 14000.00, 66.0, 34.0, 'Q1 2025'),
  ('BELCO', 'Supramax', 'tc_equivalent', 12500.00, 62.0, 38.0, 'Q2 2025'),
  ('BELCO', 'Supramax', 'tc_equivalent', 16000.00, 72.0, 28.0, 'Q3 2025'),
  ('BELCO', 'Supramax', 'tc_equivalent', 15500.00, 70.0, 30.0, 'Q4 2025')
ON CONFLICT (ticker, quarter, vessel_class) DO NOTHING;

-- 2020 — Newcastlemax rates
INSERT INTO shipping_company_rates (ticker, vessel_class, rate_type, rate_usd_per_day, contract_coverage_pct, spot_exposure_pct, quarter)
VALUES
  ('2020', 'Newcastlemax', 'tc_equivalent', 24000.00, 50.0, 50.0, 'Q1 2024'),
  ('2020', 'Newcastlemax', 'tc_equivalent', 20000.00, 45.0, 55.0, 'Q2 2024'),
  ('2020', 'Newcastlemax', 'tc_equivalent', 28000.00, 55.0, 45.0, 'Q3 2024'),
  ('2020', 'Newcastlemax', 'tc_equivalent', 29000.00, 58.0, 42.0, 'Q4 2024'),
  ('2020', 'Newcastlemax', 'tc_equivalent', 26000.00, 52.0, 48.0, 'Q1 2025'),
  ('2020', 'Newcastlemax', 'tc_equivalent', 22000.00, 48.0, 52.0, 'Q2 2025'),
  ('2020', 'Newcastlemax', 'tc_equivalent', 30000.00, 60.0, 40.0, 'Q3 2025'),
  ('2020', 'Newcastlemax', 'tc_equivalent', 28500.00, 57.0, 43.0, 'Q4 2025')
ON CONFLICT (ticker, quarter, vessel_class) DO NOTHING;

-- HAFNI — LR2 rates
INSERT INTO shipping_company_rates (ticker, vessel_class, rate_type, rate_usd_per_day, contract_coverage_pct, spot_exposure_pct, quarter)
VALUES
  ('HAFNI', 'LR2', 'tc_equivalent', 34000.00, 45.0, 55.0, 'Q1 2024'),
  ('HAFNI', 'LR2', 'tc_equivalent', 30000.00, 40.0, 60.0, 'Q2 2024'),
  ('HAFNI', 'LR2', 'tc_equivalent', 38000.00, 50.0, 50.0, 'Q3 2024'),
  ('HAFNI', 'LR2', 'tc_equivalent', 36000.00, 48.0, 52.0, 'Q4 2024'),
  ('HAFNI', 'LR2', 'tc_equivalent', 35000.00, 46.0, 54.0, 'Q1 2025'),
  ('HAFNI', 'LR2', 'tc_equivalent', 32000.00, 42.0, 58.0, 'Q2 2025'),
  ('HAFNI', 'LR2', 'tc_equivalent', 40000.00, 52.0, 48.0, 'Q3 2025'),
  ('HAFNI', 'LR2', 'tc_equivalent', 38000.00, 50.0, 50.0, 'Q4 2025')
ON CONFLICT (ticker, quarter, vessel_class) DO NOTHING;

-- HAFNI — MR rates
INSERT INTO shipping_company_rates (ticker, vessel_class, rate_type, rate_usd_per_day, contract_coverage_pct, spot_exposure_pct, quarter)
VALUES
  ('HAFNI', 'MR', 'tc_equivalent', 26000.00, 40.0, 60.0, 'Q1 2024'),
  ('HAFNI', 'MR', 'tc_equivalent', 22000.00, 35.0, 65.0, 'Q2 2024'),
  ('HAFNI', 'MR', 'tc_equivalent', 30000.00, 48.0, 52.0, 'Q3 2024'),
  ('HAFNI', 'MR', 'tc_equivalent', 28000.00, 45.0, 55.0, 'Q4 2024'),
  ('HAFNI', 'MR', 'tc_equivalent', 27000.00, 42.0, 58.0, 'Q1 2025'),
  ('HAFNI', 'MR', 'tc_equivalent', 24000.00, 38.0, 62.0, 'Q2 2025'),
  ('HAFNI', 'MR', 'tc_equivalent', 32000.00, 50.0, 50.0, 'Q3 2025'),
  ('HAFNI', 'MR', 'tc_equivalent', 30000.00, 48.0, 52.0, 'Q4 2025')
ON CONFLICT (ticker, quarter, vessel_class) DO NOTHING;

-- MPCC — Container rates
INSERT INTO shipping_company_rates (ticker, vessel_class, rate_type, rate_usd_per_day, contract_coverage_pct, spot_exposure_pct, quarter)
VALUES
  ('MPCC', 'Container', 'tc_equivalent', 20000.00, 85.0, 15.0, 'Q1 2024'),
  ('MPCC', 'Container', 'tc_equivalent', 18000.00, 82.0, 18.0, 'Q2 2024'),
  ('MPCC', 'Container', 'tc_equivalent', 22000.00, 85.0, 15.0, 'Q3 2024'),
  ('MPCC', 'Container', 'tc_equivalent', 22000.00, 85.0, 15.0, 'Q4 2024'),
  ('MPCC', 'Container', 'tc_equivalent', 21000.00, 83.0, 17.0, 'Q1 2025'),
  ('MPCC', 'Container', 'tc_equivalent', 19000.00, 80.0, 20.0, 'Q2 2025'),
  ('MPCC', 'Container', 'tc_equivalent', 23000.00, 85.0, 15.0, 'Q3 2025'),
  ('MPCC', 'Container', 'tc_equivalent', 22500.00, 84.0, 16.0, 'Q4 2025')
ON CONFLICT (ticker, quarter, vessel_class) DO NOTHING;

-- HAVI — PCTC rates
INSERT INTO shipping_company_rates (ticker, vessel_class, rate_type, rate_usd_per_day, contract_coverage_pct, spot_exposure_pct, quarter)
VALUES
  ('HAVI', 'PCTC', 'tc_equivalent', 48000.00, 80.0, 20.0, 'Q1 2024'),
  ('HAVI', 'PCTC', 'tc_equivalent', 46000.00, 78.0, 22.0, 'Q2 2024'),
  ('HAVI', 'PCTC', 'tc_equivalent', 55000.00, 82.0, 18.0, 'Q3 2024'),
  ('HAVI', 'PCTC', 'tc_equivalent', 55000.00, 82.0, 18.0, 'Q4 2024'),
  ('HAVI', 'PCTC', 'tc_equivalent', 52000.00, 80.0, 20.0, 'Q1 2025'),
  ('HAVI', 'PCTC', 'tc_equivalent', 50000.00, 78.0, 22.0, 'Q2 2025'),
  ('HAVI', 'PCTC', 'tc_equivalent', 58000.00, 83.0, 17.0, 'Q3 2025'),
  ('HAVI', 'PCTC', 'tc_equivalent', 56000.00, 82.0, 18.0, 'Q4 2025')
ON CONFLICT (ticker, quarter, vessel_class) DO NOTHING;

-- ODFJELL-B — Chemical rates
INSERT INTO shipping_company_rates (ticker, vessel_class, rate_type, rate_usd_per_day, contract_coverage_pct, spot_exposure_pct, quarter)
VALUES
  ('ODFJELL-B', 'Chemical', 'tc_equivalent', 20000.00, 70.0, 30.0, 'Q1 2024'),
  ('ODFJELL-B', 'Chemical', 'tc_equivalent', 18000.00, 65.0, 35.0, 'Q2 2024'),
  ('ODFJELL-B', 'Chemical', 'tc_equivalent', 22000.00, 72.0, 28.0, 'Q3 2024'),
  ('ODFJELL-B', 'Chemical', 'tc_equivalent', 22000.00, 72.0, 28.0, 'Q4 2024'),
  ('ODFJELL-B', 'Chemical', 'tc_equivalent', 21000.00, 70.0, 30.0, 'Q1 2025'),
  ('ODFJELL-B', 'Chemical', 'tc_equivalent', 19500.00, 68.0, 32.0, 'Q2 2025'),
  ('ODFJELL-B', 'Chemical', 'tc_equivalent', 23000.00, 74.0, 26.0, 'Q3 2025'),
  ('ODFJELL-B', 'Chemical', 'tc_equivalent', 22500.00, 72.0, 28.0, 'Q4 2025')
ON CONFLICT (ticker, quarter, vessel_class) DO NOTHING;

-- FLNG — LNG rates
INSERT INTO shipping_company_rates (ticker, vessel_class, rate_type, rate_usd_per_day, contract_coverage_pct, spot_exposure_pct, quarter)
VALUES
  ('FLNG', 'LNG', 'tc_equivalent', 82000.00, 85.0, 15.0, 'Q1 2024'),
  ('FLNG', 'LNG', 'tc_equivalent', 80000.00, 85.0, 15.0, 'Q2 2024'),
  ('FLNG', 'LNG', 'tc_equivalent', 85000.00, 85.0, 15.0, 'Q3 2024'),
  ('FLNG', 'LNG', 'tc_equivalent', 85000.00, 85.0, 15.0, 'Q4 2024'),
  ('FLNG', 'LNG', 'tc_equivalent', 83000.00, 85.0, 15.0, 'Q1 2025'),
  ('FLNG', 'LNG', 'tc_equivalent', 81000.00, 85.0, 15.0, 'Q2 2025'),
  ('FLNG', 'LNG', 'tc_equivalent', 87000.00, 85.0, 15.0, 'Q3 2025'),
  ('FLNG', 'LNG', 'tc_equivalent', 86000.00, 85.0, 15.0, 'Q4 2025')
ON CONFLICT (ticker, quarter, vessel_class) DO NOTHING;

-- BWLPG — VLGC rates
INSERT INTO shipping_company_rates (ticker, vessel_class, rate_type, rate_usd_per_day, contract_coverage_pct, spot_exposure_pct, quarter)
VALUES
  ('BWLPG', 'VLGC', 'tc_equivalent', 36000.00, 50.0, 50.0, 'Q1 2024'),
  ('BWLPG', 'VLGC', 'tc_equivalent', 32000.00, 45.0, 55.0, 'Q2 2024'),
  ('BWLPG', 'VLGC', 'tc_equivalent', 42000.00, 55.0, 45.0, 'Q3 2024'),
  ('BWLPG', 'VLGC', 'tc_equivalent', 40000.00, 52.0, 48.0, 'Q4 2024'),
  ('BWLPG', 'VLGC', 'tc_equivalent', 38000.00, 50.0, 50.0, 'Q1 2025'),
  ('BWLPG', 'VLGC', 'tc_equivalent', 34000.00, 46.0, 54.0, 'Q2 2025'),
  ('BWLPG', 'VLGC', 'tc_equivalent', 44000.00, 58.0, 42.0, 'Q3 2025'),
  ('BWLPG', 'VLGC', 'tc_equivalent', 42000.00, 55.0, 45.0, 'Q4 2025')
ON CONFLICT (ticker, quarter, vessel_class) DO NOTHING;


-- ============================================================================
-- 7. SHIPPING MARKET RATES — 12 months of benchmark freight indices
--    Monthly data from 2025-04-01 to 2026-03-01
-- ============================================================================

-- BDI (Baltic Dry Index)
INSERT INTO shipping_market_rates (index_name, index_display_name, rate_value, rate_unit, rate_date, source)
VALUES
  ('BDI', 'Baltic Dry Index',  1450.00, 'index_points', '2025-04-01', 'manual'),
  ('BDI', 'Baltic Dry Index',  1620.00, 'index_points', '2025-05-01', 'manual'),
  ('BDI', 'Baltic Dry Index',  1780.00, 'index_points', '2025-06-01', 'manual'),
  ('BDI', 'Baltic Dry Index',  1890.00, 'index_points', '2025-07-01', 'manual'),
  ('BDI', 'Baltic Dry Index',  1720.00, 'index_points', '2025-08-01', 'manual'),
  ('BDI', 'Baltic Dry Index',  1850.00, 'index_points', '2025-09-01', 'manual'),
  ('BDI', 'Baltic Dry Index',  2100.00, 'index_points', '2025-10-01', 'manual'),
  ('BDI', 'Baltic Dry Index',  2340.00, 'index_points', '2025-11-01', 'manual'),
  ('BDI', 'Baltic Dry Index',  1950.00, 'index_points', '2025-12-01', 'manual'),
  ('BDI', 'Baltic Dry Index',  2180.00, 'index_points', '2026-01-01', 'manual'),
  ('BDI', 'Baltic Dry Index',  1760.00, 'index_points', '2026-02-01', 'manual'),
  ('BDI', 'Baltic Dry Index',  1580.00, 'index_points', '2026-03-01', 'manual')
ON CONFLICT (index_name, rate_date) DO NOTHING;

-- BDTI (Baltic Dirty Tanker Index)
INSERT INTO shipping_market_rates (index_name, index_display_name, rate_value, rate_unit, rate_date, source)
VALUES
  ('BDTI', 'Baltic Dirty Tanker Index',  850.00, 'index_points', '2025-04-01', 'manual'),
  ('BDTI', 'Baltic Dirty Tanker Index',  920.00, 'index_points', '2025-05-01', 'manual'),
  ('BDTI', 'Baltic Dirty Tanker Index', 1080.00, 'index_points', '2025-06-01', 'manual'),
  ('BDTI', 'Baltic Dirty Tanker Index', 1150.00, 'index_points', '2025-07-01', 'manual'),
  ('BDTI', 'Baltic Dirty Tanker Index',  980.00, 'index_points', '2025-08-01', 'manual'),
  ('BDTI', 'Baltic Dirty Tanker Index', 1100.00, 'index_points', '2025-09-01', 'manual'),
  ('BDTI', 'Baltic Dirty Tanker Index', 1250.00, 'index_points', '2025-10-01', 'manual'),
  ('BDTI', 'Baltic Dirty Tanker Index', 1380.00, 'index_points', '2025-11-01', 'manual'),
  ('BDTI', 'Baltic Dirty Tanker Index', 1100.00, 'index_points', '2025-12-01', 'manual'),
  ('BDTI', 'Baltic Dirty Tanker Index', 1200.00, 'index_points', '2026-01-01', 'manual'),
  ('BDTI', 'Baltic Dirty Tanker Index',  950.00, 'index_points', '2026-02-01', 'manual'),
  ('BDTI', 'Baltic Dirty Tanker Index',  880.00, 'index_points', '2026-03-01', 'manual')
ON CONFLICT (index_name, rate_date) DO NOTHING;

-- BCTI (Baltic Clean Tanker Index)
INSERT INTO shipping_market_rates (index_name, index_display_name, rate_value, rate_unit, rate_date, source)
VALUES
  ('BCTI', 'Baltic Clean Tanker Index',  620.00, 'index_points', '2025-04-01', 'manual'),
  ('BCTI', 'Baltic Clean Tanker Index',  680.00, 'index_points', '2025-05-01', 'manual'),
  ('BCTI', 'Baltic Clean Tanker Index',  780.00, 'index_points', '2025-06-01', 'manual'),
  ('BCTI', 'Baltic Clean Tanker Index',  820.00, 'index_points', '2025-07-01', 'manual'),
  ('BCTI', 'Baltic Clean Tanker Index',  710.00, 'index_points', '2025-08-01', 'manual'),
  ('BCTI', 'Baltic Clean Tanker Index',  750.00, 'index_points', '2025-09-01', 'manual'),
  ('BCTI', 'Baltic Clean Tanker Index',  880.00, 'index_points', '2025-10-01', 'manual'),
  ('BCTI', 'Baltic Clean Tanker Index',  950.00, 'index_points', '2025-11-01', 'manual'),
  ('BCTI', 'Baltic Clean Tanker Index',  780.00, 'index_points', '2025-12-01', 'manual'),
  ('BCTI', 'Baltic Clean Tanker Index',  850.00, 'index_points', '2026-01-01', 'manual'),
  ('BCTI', 'Baltic Clean Tanker Index',  680.00, 'index_points', '2026-02-01', 'manual'),
  ('BCTI', 'Baltic Clean Tanker Index',  640.00, 'index_points', '2026-03-01', 'manual')
ON CONFLICT (index_name, rate_date) DO NOTHING;

-- CAPESIZE_5TC (Capesize 5TC Average)
INSERT INTO shipping_market_rates (index_name, index_display_name, rate_value, rate_unit, rate_date, source)
VALUES
  ('CAPESIZE_5TC', 'Capesize 5TC Average', 18500.00, 'usd_per_day', '2025-04-01', 'manual'),
  ('CAPESIZE_5TC', 'Capesize 5TC Average', 20200.00, 'usd_per_day', '2025-05-01', 'manual'),
  ('CAPESIZE_5TC', 'Capesize 5TC Average', 24800.00, 'usd_per_day', '2025-06-01', 'manual'),
  ('CAPESIZE_5TC', 'Capesize 5TC Average', 26500.00, 'usd_per_day', '2025-07-01', 'manual'),
  ('CAPESIZE_5TC', 'Capesize 5TC Average', 22000.00, 'usd_per_day', '2025-08-01', 'manual'),
  ('CAPESIZE_5TC', 'Capesize 5TC Average', 25000.00, 'usd_per_day', '2025-09-01', 'manual'),
  ('CAPESIZE_5TC', 'Capesize 5TC Average', 28500.00, 'usd_per_day', '2025-10-01', 'manual'),
  ('CAPESIZE_5TC', 'Capesize 5TC Average', 32000.00, 'usd_per_day', '2025-11-01', 'manual'),
  ('CAPESIZE_5TC', 'Capesize 5TC Average', 25500.00, 'usd_per_day', '2025-12-01', 'manual'),
  ('CAPESIZE_5TC', 'Capesize 5TC Average', 29000.00, 'usd_per_day', '2026-01-01', 'manual'),
  ('CAPESIZE_5TC', 'Capesize 5TC Average', 22500.00, 'usd_per_day', '2026-02-01', 'manual'),
  ('CAPESIZE_5TC', 'Capesize 5TC Average', 20000.00, 'usd_per_day', '2026-03-01', 'manual')
ON CONFLICT (index_name, rate_date) DO NOTHING;

-- VLCC_TD3C_TCE (VLCC MEG-China TCE)
INSERT INTO shipping_market_rates (index_name, index_display_name, rate_value, rate_unit, rate_date, source)
VALUES
  ('VLCC_TD3C_TCE', 'VLCC MEG-China TCE', 38000.00, 'usd_per_day', '2025-04-01', 'manual'),
  ('VLCC_TD3C_TCE', 'VLCC MEG-China TCE', 42000.00, 'usd_per_day', '2025-05-01', 'manual'),
  ('VLCC_TD3C_TCE', 'VLCC MEG-China TCE', 52000.00, 'usd_per_day', '2025-06-01', 'manual'),
  ('VLCC_TD3C_TCE', 'VLCC MEG-China TCE', 55000.00, 'usd_per_day', '2025-07-01', 'manual'),
  ('VLCC_TD3C_TCE', 'VLCC MEG-China TCE', 45000.00, 'usd_per_day', '2025-08-01', 'manual'),
  ('VLCC_TD3C_TCE', 'VLCC MEG-China TCE', 48000.00, 'usd_per_day', '2025-09-01', 'manual'),
  ('VLCC_TD3C_TCE', 'VLCC MEG-China TCE', 58000.00, 'usd_per_day', '2025-10-01', 'manual'),
  ('VLCC_TD3C_TCE', 'VLCC MEG-China TCE', 62000.00, 'usd_per_day', '2025-11-01', 'manual'),
  ('VLCC_TD3C_TCE', 'VLCC MEG-China TCE', 48000.00, 'usd_per_day', '2025-12-01', 'manual'),
  ('VLCC_TD3C_TCE', 'VLCC MEG-China TCE', 52000.00, 'usd_per_day', '2026-01-01', 'manual'),
  ('VLCC_TD3C_TCE', 'VLCC MEG-China TCE', 40000.00, 'usd_per_day', '2026-02-01', 'manual'),
  ('VLCC_TD3C_TCE', 'VLCC MEG-China TCE', 36000.00, 'usd_per_day', '2026-03-01', 'manual')
ON CONFLICT (index_name, rate_date) DO NOTHING;

-- SUEZMAX_TD20_TCE (Suezmax WAF-UKC TCE)
INSERT INTO shipping_market_rates (index_name, index_display_name, rate_value, rate_unit, rate_date, source)
VALUES
  ('SUEZMAX_TD20_TCE', 'Suezmax WAF-UKC TCE', 32000.00, 'usd_per_day', '2025-04-01', 'manual'),
  ('SUEZMAX_TD20_TCE', 'Suezmax WAF-UKC TCE', 36000.00, 'usd_per_day', '2025-05-01', 'manual'),
  ('SUEZMAX_TD20_TCE', 'Suezmax WAF-UKC TCE', 44000.00, 'usd_per_day', '2025-06-01', 'manual'),
  ('SUEZMAX_TD20_TCE', 'Suezmax WAF-UKC TCE', 46000.00, 'usd_per_day', '2025-07-01', 'manual'),
  ('SUEZMAX_TD20_TCE', 'Suezmax WAF-UKC TCE', 38000.00, 'usd_per_day', '2025-08-01', 'manual'),
  ('SUEZMAX_TD20_TCE', 'Suezmax WAF-UKC TCE', 42000.00, 'usd_per_day', '2025-09-01', 'manual'),
  ('SUEZMAX_TD20_TCE', 'Suezmax WAF-UKC TCE', 50000.00, 'usd_per_day', '2025-10-01', 'manual'),
  ('SUEZMAX_TD20_TCE', 'Suezmax WAF-UKC TCE', 52000.00, 'usd_per_day', '2025-11-01', 'manual'),
  ('SUEZMAX_TD20_TCE', 'Suezmax WAF-UKC TCE', 42000.00, 'usd_per_day', '2025-12-01', 'manual'),
  ('SUEZMAX_TD20_TCE', 'Suezmax WAF-UKC TCE', 46000.00, 'usd_per_day', '2026-01-01', 'manual'),
  ('SUEZMAX_TD20_TCE', 'Suezmax WAF-UKC TCE', 34000.00, 'usd_per_day', '2026-02-01', 'manual'),
  ('SUEZMAX_TD20_TCE', 'Suezmax WAF-UKC TCE', 30000.00, 'usd_per_day', '2026-03-01', 'manual')
ON CONFLICT (index_name, rate_date) DO NOTHING;

-- MR_TC2_TCE (MR TC2 37kt UKC-USAC)
INSERT INTO shipping_market_rates (index_name, index_display_name, rate_value, rate_unit, rate_date, source)
VALUES
  ('MR_TC2_TCE', 'MR TC2 37kt UKC-USAC', 22000.00, 'usd_per_day', '2025-04-01', 'manual'),
  ('MR_TC2_TCE', 'MR TC2 37kt UKC-USAC', 26000.00, 'usd_per_day', '2025-05-01', 'manual'),
  ('MR_TC2_TCE', 'MR TC2 37kt UKC-USAC', 32000.00, 'usd_per_day', '2025-06-01', 'manual'),
  ('MR_TC2_TCE', 'MR TC2 37kt UKC-USAC', 34000.00, 'usd_per_day', '2025-07-01', 'manual'),
  ('MR_TC2_TCE', 'MR TC2 37kt UKC-USAC', 28000.00, 'usd_per_day', '2025-08-01', 'manual'),
  ('MR_TC2_TCE', 'MR TC2 37kt UKC-USAC', 30000.00, 'usd_per_day', '2025-09-01', 'manual'),
  ('MR_TC2_TCE', 'MR TC2 37kt UKC-USAC', 36000.00, 'usd_per_day', '2025-10-01', 'manual'),
  ('MR_TC2_TCE', 'MR TC2 37kt UKC-USAC', 38000.00, 'usd_per_day', '2025-11-01', 'manual'),
  ('MR_TC2_TCE', 'MR TC2 37kt UKC-USAC', 30000.00, 'usd_per_day', '2025-12-01', 'manual'),
  ('MR_TC2_TCE', 'MR TC2 37kt UKC-USAC', 32000.00, 'usd_per_day', '2026-01-01', 'manual'),
  ('MR_TC2_TCE', 'MR TC2 37kt UKC-USAC', 24000.00, 'usd_per_day', '2026-02-01', 'manual'),
  ('MR_TC2_TCE', 'MR TC2 37kt UKC-USAC', 20000.00, 'usd_per_day', '2026-03-01', 'manual')
ON CONFLICT (index_name, rate_date) DO NOTHING;

-- SCFI (Shanghai Containerized Freight Index)
INSERT INTO shipping_market_rates (index_name, index_display_name, rate_value, rate_unit, rate_date, source)
VALUES
  ('SCFI', 'Shanghai Containerized Freight Index',  980.00, 'index_points', '2025-04-01', 'manual'),
  ('SCFI', 'Shanghai Containerized Freight Index', 1020.00, 'index_points', '2025-05-01', 'manual'),
  ('SCFI', 'Shanghai Containerized Freight Index', 1150.00, 'index_points', '2025-06-01', 'manual'),
  ('SCFI', 'Shanghai Containerized Freight Index', 1280.00, 'index_points', '2025-07-01', 'manual'),
  ('SCFI', 'Shanghai Containerized Freight Index', 1100.00, 'index_points', '2025-08-01', 'manual'),
  ('SCFI', 'Shanghai Containerized Freight Index', 1050.00, 'index_points', '2025-09-01', 'manual'),
  ('SCFI', 'Shanghai Containerized Freight Index', 1200.00, 'index_points', '2025-10-01', 'manual'),
  ('SCFI', 'Shanghai Containerized Freight Index', 1350.00, 'index_points', '2025-11-01', 'manual'),
  ('SCFI', 'Shanghai Containerized Freight Index', 1150.00, 'index_points', '2025-12-01', 'manual'),
  ('SCFI', 'Shanghai Containerized Freight Index', 1250.00, 'index_points', '2026-01-01', 'manual'),
  ('SCFI', 'Shanghai Containerized Freight Index', 1050.00, 'index_points', '2026-02-01', 'manual'),
  ('SCFI', 'Shanghai Containerized Freight Index', 1000.00, 'index_points', '2026-03-01', 'manual')
ON CONFLICT (index_name, rate_date) DO NOTHING;


-- ============================================================================
-- 8. SHIPPING PORTS — 35 major global ports
-- ============================================================================

INSERT INTO shipping_ports (unlocode, port_name, country, latitude, longitude, port_type, region)
VALUES
  -- Oil terminals
  ('SARAT', 'Ras Tanura',           'Saudi Arabia',         26.680000,   50.160000, 'crude_terminal',   'Arabian Gulf'),
  ('AEFUJ', 'Fujairah',             'UAE',                  25.120000,   56.330000, 'crude_terminal',   'Arabian Gulf'),
  ('NGBON', 'Bonny',                'Nigeria',               4.430000,    7.150000, 'crude_terminal',   'West Africa'),
  ('NLRTM', 'Rotterdam Europoort',  'Netherlands',          51.950000,    4.120000, 'crude_terminal',   'North Europe'),
  ('USHOU', 'Houston',              'USA',                  29.760000,  -95.360000, 'product_terminal', 'US Gulf'),
  ('SGSIN', 'Singapore',            'Singapore',             1.260000,  103.840000, 'product_terminal', 'SE Asia'),

  -- Dry bulk
  ('BRSSO', 'Santos',               'Brazil',              -23.960000,  -46.330000, 'dry_bulk',         'South America'),
  ('BRTUB', 'Tubarão',              'Brazil',              -20.290000,  -40.240000, 'dry_bulk',         'South America'),
  ('AUPHE', 'Port Hedland',         'Australia',           -20.310000,  118.580000, 'dry_bulk',         'Australia'),
  ('AUNTL', 'Newcastle',            'Australia',           -32.920000,  151.780000, 'dry_bulk',         'Australia'),
  ('CNQIN', 'Qingdao',              'China',                36.070000,  120.380000, 'dry_bulk',         'East Asia'),
  ('CNDLC', 'Dalian',               'China',                38.920000,  121.640000, 'dry_bulk',         'East Asia'),
  ('ZARIB', 'Richards Bay',         'South Africa',        -28.800000,   32.080000, 'dry_bulk',         'South Africa'),
  ('KRKWA', 'Gwangyang',            'South Korea',          34.930000,  127.730000, 'dry_bulk',         'East Asia'),

  -- Container
  ('DEHAM', 'Hamburg',               'Germany',              53.550000,    9.970000, 'container',        'North Europe'),
  ('BEANR', 'Antwerp',              'Belgium',              51.300000,    4.300000, 'container',        'North Europe'),
  ('MATNG', 'Tangier Med',          'Morocco',              35.890000,   -5.500000, 'container',        'Mediterranean'),
  ('CNSHA', 'Shanghai',             'China',                31.230000,  121.470000, 'container',        'East Asia'),
  ('KRPUS', 'Busan',                'South Korea',          35.100000,  129.040000, 'container',        'East Asia'),

  -- LNG / LPG
  ('QARAS', 'Ras Laffan',           'Qatar',                25.930000,   51.530000, 'lng',              'Arabian Gulf'),
  ('USCVP', 'Cove Point',           'USA',                  38.400000,  -76.400000, 'lng',              'US East Coast'),
  ('JPTBT', 'Tobata',               'Japan',                33.900000,  130.820000, 'lng',              'East Asia'),
  ('KRINC', 'Incheon',              'South Korea',          37.450000,  126.700000, 'lng',              'East Asia'),
  ('JPCHB', 'Chiba',                'Japan',                35.610000,  140.100000, 'lpg',              'East Asia'),

  -- Car / Vehicle / Multipurpose
  ('DEBRV', 'Bremerhaven',          'Germany',              53.540000,    8.580000, 'multipurpose',     'North Europe'),
  ('JPNGO', 'Nagoya',               'Japan',                35.080000,  136.880000, 'multipurpose',     'East Asia'),
  ('USJAX', 'Jacksonville',         'USA',                  30.330000,  -81.660000, 'multipurpose',     'US East Coast'),
  ('SAJED', 'Jeddah',               'Saudi Arabia',         21.480000,   39.170000, 'multipurpose',     'Red Sea'),

  -- Chemical / General
  ('CAMTR', 'Montreal',             'Canada',               45.500000,  -73.550000, 'multipurpose',     'Great Lakes'),

  -- Norwegian ports
  ('NOMON', 'Mongstad',             'Norway',               60.810000,    5.030000, 'crude_terminal',   'North Sea'),
  ('NOSTU', 'Sture',                'Norway',               60.620000,    4.840000, 'crude_terminal',   'North Sea'),
  ('NOBGO', 'Bergen',               'Norway',               60.390000,    5.320000, 'multipurpose',     'North Sea'),
  ('NOSVG', 'Stavanger',            'Norway',               58.970000,    5.730000, 'multipurpose',     'North Sea'),

  -- Indian subcontinent
  ('INMAA', 'Mumbai',               'India',                19.000000,   72.850000, 'product_terminal', 'Indian Ocean'),

  -- Additional key port for dry bulk: Ningbo
  ('CNNGB', 'Ningbo',               'China',                29.870000,  121.540000, 'dry_bulk',         'East Asia')
ON CONFLICT (unlocode) DO NOTHING;


COMMIT;
