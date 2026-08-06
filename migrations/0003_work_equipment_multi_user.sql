-- Production had no receipt rows when this narrowing migration was created.
-- Keep yearly thresholds as data while making each user's configuration private.
CREATE TABLE work_equipment_migration_guard (
  receipt_count INTEGER NOT NULL CHECK (receipt_count = 0)
) STRICT;

INSERT INTO work_equipment_migration_guard
SELECT COUNT(*) FROM receipts;

CREATE TABLE tax_year_defaults_new (
  tax_year INTEGER PRIMARY KEY CHECK (tax_year BETWEEN 2000 AND 2200),
  gwg_limit_cents INTEGER NOT NULL CHECK (gwg_limit_cents >= 0),
  updated_at TEXT NOT NULL
) STRICT;

INSERT INTO tax_year_defaults_new (tax_year, gwg_limit_cents, updated_at)
SELECT tax_year, gwg_limit_cents, updated_at
FROM tax_year_config;

DROP TABLE receipts;
DROP TABLE tax_year_config;
DROP TABLE work_equipment_migration_guard;
ALTER TABLE tax_year_defaults_new RENAME TO tax_year_defaults;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  access_issuer TEXT NOT NULL,
  access_subject TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (access_issuer, access_subject)
) STRICT;

CREATE TABLE tax_year_config (
  owner_id TEXT NOT NULL,
  tax_year INTEGER NOT NULL CHECK (tax_year BETWEEN 2000 AND 2200),
  gwg_limit_cents INTEGER NOT NULL CHECK (gwg_limit_cents >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, tax_year),
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) STRICT;

CREATE TABLE receipts (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'complete')),
  category TEXT NOT NULL DEFAULT 'Aufwendungen für Arbeitsmittel'
    CHECK (category = 'Aufwendungen für Arbeitsmittel'),
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
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, tax_year) REFERENCES tax_year_config(owner_id, tax_year)
) STRICT;

CREATE INDEX receipts_owner_year
  ON receipts(owner_id, tax_year, expense_date DESC);
