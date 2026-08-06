export const CATEGORY = "Aufwendungen für Arbeitsmittel" as const;
export type Category = typeof CATEGORY;

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

export interface AuthIdentity {
  email: string;
  subject: string;
  issuer: string;
}

export interface Owner {
  id: string;
  email: string;
}

export interface Variables {
  identity: AuthIdentity;
  owner: Owner;
}

export type AppEnv = {
  Bindings: Bindings;
  Variables: Variables;
};

export interface ReceiptRow {
  id: string;
  created_at: string;
  updated_at: string;
  owner_id: string;
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
  owner_id: string;
  tax_year: number;
  gwg_limit_cents: number;
  updated_at: string;
}
