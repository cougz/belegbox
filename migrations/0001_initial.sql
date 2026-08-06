PRAGMA foreign_keys = ON;

CREATE TABLE tax_year_config (
  tax_year INTEGER PRIMARY KEY CHECK (tax_year BETWEEN 2000 AND 2200),
  gwg_limit_cents INTEGER NOT NULL CHECK (gwg_limit_cents >= 0),
  homeoffice_daily_cents INTEGER NOT NULL CHECK (homeoffice_daily_cents >= 0),
  homeoffice_max_days INTEGER NOT NULL CHECK (homeoffice_max_days >= 0),
  distance_first_20_km_cents INTEGER NOT NULL CHECK (distance_first_20_km_cents >= 0),
  distance_after_20_km_cents INTEGER NOT NULL CHECK (distance_after_20_km_cents >= 0),
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE receipts (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'complete')),
  category TEXT NOT NULL CHECK (category IN (
    'Arbeitsmittel',
    'Fahrtkosten/Entfernungspauschale',
    'Fortbildungskosten',
    'Bewerbungskosten',
    'Homeoffice-Pauschale',
    'Kontofuehrungsgebuehren',
    'Gewerkschafts-/Berufsverbandsbeitraege',
    'Reisekosten',
    'Sonstiges'
  )),
  description TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  business_use_pct INTEGER NOT NULL DEFAULT 100 CHECK (business_use_pct BETWEEN 0 AND 100),
  deductible_cents INTEGER GENERATED ALWAYS AS ((amount_cents * business_use_pct + 50) / 100) STORED,
  expense_date TEXT NOT NULL,
  tax_year INTEGER NOT NULL CHECK (tax_year BETWEEN 2000 AND 2200),
  seller_name TEXT NOT NULL DEFAULT '',
  seller_address TEXT NOT NULL DEFAULT '',
  invoice_number TEXT NOT NULL DEFAULT '',
  payment_method TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  r2_key TEXT UNIQUE,
  original_filename TEXT,
  mime_type TEXT,
  file_size INTEGER CHECK (file_size IS NULL OR file_size >= 0),
  gwg_flag INTEGER NOT NULL DEFAULT 0 CHECK (gwg_flag IN (0, 1)),
  FOREIGN KEY (tax_year) REFERENCES tax_year_config(tax_year)
) STRICT;

CREATE INDEX receipts_owner_year_category
  ON receipts(owner_email, tax_year, category, expense_date DESC);

-- Annual values live in data, not application code. Review them before using
-- an export for a tax return and add future years through the app settings.
INSERT INTO tax_year_config VALUES
  (2024, 80000, 600, 210, 30, 38, '2026-08-06T00:00:00.000Z'),
  (2025, 80000, 600, 210, 30, 38, '2026-08-06T00:00:00.000Z'),
  (2026, 80000, 600, 210, 38, 38, '2026-08-06T00:00:00.000Z');
