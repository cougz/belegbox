CREATE TABLE receipts_exact_labels (
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
    'Kontoführungsgebühren',
    'Gewerkschafts-/Berufsverbandsbeiträge',
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

INSERT INTO receipts_exact_labels (
  id, created_at, updated_at, owner_email, status, category, description, amount_cents,
  business_use_pct, expense_date, tax_year, seller_name, seller_address, invoice_number,
  payment_method, notes, r2_key, original_filename, mime_type, file_size, gwg_flag
)
SELECT
  id, created_at, updated_at, owner_email, status,
  CASE category
    WHEN 'Kontofuehrungsgebuehren' THEN 'Kontoführungsgebühren'
    WHEN 'Gewerkschafts-/Berufsverbandsbeitraege' THEN 'Gewerkschafts-/Berufsverbandsbeiträge'
    ELSE category
  END,
  description, amount_cents, business_use_pct, expense_date, tax_year, seller_name,
  seller_address, invoice_number, payment_method, notes, r2_key, original_filename,
  mime_type, file_size, gwg_flag
FROM receipts;

DROP TABLE receipts;
ALTER TABLE receipts_exact_labels RENAME TO receipts;

CREATE INDEX receipts_owner_year_category
  ON receipts(owner_email, tax_year, category, expense_date DESC);
