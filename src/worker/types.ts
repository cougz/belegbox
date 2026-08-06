export const CATEGORIES = [
  "Arbeitsmittel",
  "Fahrtkosten/Entfernungspauschale",
  "Fortbildungskosten",
  "Bewerbungskosten",
  "Homeoffice-Pauschale",
  "Kontoführungsgebühren",
  "Gewerkschafts-/Berufsverbandsbeiträge",
  "Reisekosten",
  "Sonstiges",
] as const;

export type Category = (typeof CATEGORIES)[number];

export interface Bindings {
  DB: D1Database;
  RECEIPTS: R2Bucket;
  ASSETS: Fetcher;
  AI: Ai;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  AI_PREFILL_ENABLED?: string;
  DEV_AUTH_EMAIL?: string;
}

export interface AuthUser {
  email: string;
  subject: string;
}

export interface Variables {
  user: AuthUser;
}

export type AppEnv = {
  Bindings: Bindings;
  Variables: Variables;
};

export interface ReceiptRow {
  id: string;
  created_at: string;
  updated_at: string;
  owner_email: string;
  status: "draft" | "complete";
  category: Category;
  description: string;
  amount_cents: number;
  business_use_pct: number;
  deductible_cents: number;
  expense_date: string;
  tax_year: number;
  seller_name: string;
  seller_address: string;
  invoice_number: string;
  payment_method: string;
  notes: string;
  r2_key: string | null;
  original_filename: string | null;
  mime_type: string | null;
  file_size: number | null;
  gwg_flag: 0 | 1;
}

export interface TaxYearConfig {
  tax_year: number;
  gwg_limit_cents: number;
  homeoffice_daily_cents: number;
  homeoffice_max_days: number;
  distance_first_20_km_cents: number;
  distance_after_20_km_cents: number;
  updated_at: string;
}
