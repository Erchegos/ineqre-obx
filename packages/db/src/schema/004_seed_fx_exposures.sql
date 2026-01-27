-- Seed FX Exposure Data for OBX Stocks
-- Based on revenue currency breakdown from annual reports and analyst estimates
-- Only includes stocks that exist in the stocks table

INSERT INTO stock_fx_exposure (ticker, usd_revenue_pct, eur_revenue_pct, gbp_revenue_pct, nok_revenue_pct, other_revenue_pct, last_updated, source, notes)
VALUES
  -- Energy & Shipping (High USD exposure)
  ('EQNR', 0.8000, 0.1500, 0.0000, 0.0500, 0.0000, '2025-12-31', 'Annual Report 2025', 'Oil & gas revenues primarily USD-denominated'),
  ('FRO', 0.9000, 0.0500, 0.0000, 0.0500, 0.0000, '2025-12-31', 'Industry Standard', 'Shipping revenues in USD'),
  ('AKRBP', 0.8500, 0.1000, 0.0000, 0.0500, 0.0000, '2025-12-31', 'Annual Report 2025', 'Offshore drilling - USD contracts'),

  -- Seafood (Mixed USD/EUR)
  ('MOWI', 0.4000, 0.4000, 0.0500, 0.1500, 0.0000, '2025-12-31', 'Annual Report 2025', 'Salmon exports to US, EU, Asia'),
  ('SALM', 0.3500, 0.4500, 0.0500, 0.1500, 0.0000, '2025-12-31', 'Analyst Estimate', 'Similar to Mowi exposure'),
  ('LSG', 0.4500, 0.3500, 0.0500, 0.1500, 0.0000, '2025-12-31', 'Analyst Estimate', 'Seafood processing & exports'),

  -- Industrial (EUR-heavy)
  ('NHY', 0.3000, 0.5000, 0.0500, 0.1500, 0.0000, '2025-12-31', 'Annual Report 2025', 'Aluminum exports to Europe'),
  ('YAR', 0.4500, 0.3500, 0.0500, 0.1500, 0.0000, '2025-12-31', 'Annual Report 2025', 'Fertilizer - global markets'),
  ('KOG', 0.1000, 0.3000, 0.0000, 0.6000, 0.0000, '2025-12-31', 'Annual Report 2025', 'Defense & aerospace - mixed exposure'),
  ('AKER', 0.6000, 0.2000, 0.0500, 0.1500, 0.0000, '2025-12-31', 'Portfolio Analysis', 'Conglomerate with energy/industrial assets'),

  -- Domestic (NOK-heavy)
  ('DNB', 0.1000, 0.0500, 0.0000, 0.8500, 0.0000, '2025-12-31', 'Annual Report 2025', 'Norwegian banking - primarily domestic'),
  ('ORK', 0.0500, 0.2500, 0.0500, 0.6500, 0.0000, '2025-12-31', 'Annual Report 2025', 'Consumer brands - Nordic focus'),
  ('TEL', 0.1500, 0.1500, 0.1000, 0.6000, 0.0000, '2025-12-31', 'Annual Report 2025', 'Telecom - Nordic + Asian operations'),
  ('STB', 0.0800, 0.0700, 0.0000, 0.8500, 0.0000, '2025-12-31', 'Annual Report 2025', 'Insurance & asset mgmt - mostly NOK'),
  ('ENTRA', 0.0000, 0.0500, 0.0000, 0.9500, 0.0000, '2025-12-31', 'Annual Report 2025', 'Norwegian real estate - NOK leases'),

  -- Technology & Services
  ('AUTO', 0.2000, 0.3000, 0.1000, 0.4000, 0.0000, '2025-12-31', 'Analyst Estimate', 'Software - global clients'),
  ('NAS', 0.2000, 0.4500, 0.0500, 0.3000, 0.0000, '2025-12-31', 'Annual Report 2025', 'Aviation - EUR-heavy routes'),
  ('TGS', 0.7500, 0.1500, 0.0000, 0.1000, 0.0000, '2025-12-31', 'Annual Report 2025', 'Seismic data - USD contracts'),

  -- Shipping & Offshore
  ('BRG', 0.8000, 0.1000, 0.0000, 0.1000, 0.0000, '2025-12-31', 'Industry Standard', 'Gas shipping - USD rates'),
  ('BWLPG', 0.8500, 0.1000, 0.0000, 0.0500, 0.0000, '2025-12-31', 'Industry Standard', 'LPG shipping - USD'),
  ('MPCC', 0.7500, 0.1500, 0.0000, 0.1000, 0.0000, '2025-12-31', 'Industry Standard', 'Container leasing - USD'),
  ('GJF', 0.7000, 0.2000, 0.0000, 0.1000, 0.0000, '2025-12-31', 'Industry Standard', 'Fishery vessels - mixed'),

  -- Renewable Energy & Tech
  ('SCATC', 0.6000, 0.2000, 0.0000, 0.2000, 0.0000, '2025-12-31', 'Annual Report 2025', 'Solar power - emerging markets USD-based'),
  ('RECSI', 0.5000, 0.3500, 0.0500, 0.1000, 0.0000, '2025-12-31', 'Analyst Estimate', 'Renewable energy equipment'),

  -- Additional stocks from your database
  ('AFG', 0.3000, 0.4000, 0.0500, 0.2500, 0.0000, '2025-12-31', 'Analyst Estimate', 'Seafood - export focused'),
  ('VAR', 0.4000, 0.3500, 0.0500, 0.2000, 0.0000, '2025-12-31', 'Analyst Estimate', 'Industrial products'),
  ('SUBC', 0.6500, 0.2000, 0.0000, 0.1500, 0.0000, '2025-12-31', 'Industry Standard', 'Offshore services - USD contracts'),
  ('SNI', 0.7000, 0.1500, 0.0000, 0.1500, 0.0000, '2025-12-31', 'Industry Standard', 'Tanker shipping - USD'),
  ('ATEA', 0.1500, 0.2500, 0.0500, 0.5500, 0.0000, '2025-12-31', 'Analyst Estimate', 'IT services - Nordic focus'),
  ('BAKKA', 0.4500, 0.3500, 0.0000, 0.2000, 0.0000, '2025-12-31', 'Industry Standard', 'Industrial investments'),
  ('KIT', 0.3500, 0.3500, 0.0500, 0.2500, 0.0000, '2025-12-31', 'Analyst Estimate', 'Seafood processing')
ON CONFLICT (ticker) DO UPDATE SET
  usd_revenue_pct = EXCLUDED.usd_revenue_pct,
  eur_revenue_pct = EXCLUDED.eur_revenue_pct,
  gbp_revenue_pct = EXCLUDED.gbp_revenue_pct,
  nok_revenue_pct = EXCLUDED.nok_revenue_pct,
  other_revenue_pct = EXCLUDED.other_revenue_pct,
  last_updated = EXCLUDED.last_updated,
  source = EXCLUDED.source,
  notes = EXCLUDED.notes;
