INSERT INTO stocks (ticker, name, sector, exchange, currency)
VALUES
  ('EQNR.OL', 'Equinor', 'Energy', 'OSE', 'NOK'),
  ('DNB.OL', 'DNB', 'Financials', 'OSE', 'NOK'),
  ('NHY.OL', 'Norsk Hydro', 'Materials', 'OSE', 'NOK'),
  ('MOWI.OL', 'Mowi', 'Consumer Staples', 'OSE', 'NOK'),
  ('FRO.OL', 'Frontline', 'Shipping', 'OSE', 'NOK')
ON CONFLICT (ticker) DO NOTHING;
