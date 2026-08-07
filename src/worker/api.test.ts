import { Hono } from "hono";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api } from "./api";
import type { AppEnv, Owner } from "./types";

let miniflare: Miniflare;
let db: D1Database;

const owner: Owner = {
  id: "463aaecd-fdc7-455d-ab85-bb9a951c90a3",
  email: "owner@example.com",
};

beforeAll(async () => {
  miniflare = new Miniflare({
    compatibilityDate: "2026-08-06",
    d1Databases: ["DB"],
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
  });
  db = await miniflare.getD1Database("DB");
  await db.batch([
    db.prepare(`CREATE TABLE tax_year_config (
      owner_id TEXT NOT NULL,
      tax_year INTEGER NOT NULL,
      gwg_limit_cents INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (owner_id, tax_year)
    ) STRICT`),
    db.prepare(`CREATE TABLE receipts (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      owner_email TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      category TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      amount_cents INTEGER NOT NULL DEFAULT 0,
      business_use_pct INTEGER NOT NULL DEFAULT 100,
      deductible_cents INTEGER GENERATED ALWAYS AS ((amount_cents * business_use_pct + 50) / 100) STORED,
      expense_date TEXT NOT NULL,
      tax_year INTEGER NOT NULL,
      seller_name TEXT NOT NULL DEFAULT '',
      seller_address TEXT NOT NULL DEFAULT '',
      invoice_number TEXT NOT NULL DEFAULT '',
      payment_method TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      r2_key TEXT,
      original_filename TEXT,
      mime_type TEXT,
      file_size INTEGER,
      gwg_flag INTEGER NOT NULL DEFAULT 0
    ) STRICT`),
    db.prepare("INSERT INTO tax_year_config VALUES (?, 2026, 80000, '2026-01-01T00:00:00.000Z')").bind(owner.id),
  ]);
});

afterAll(async () => {
  await miniflare.dispose();
});

function app() {
  const instance = new Hono<AppEnv>();
  instance.use("*", async (c, next) => {
    c.set("owner", owner);
    await next();
  });
  instance.route("/", api);
  return instance;
}

describe("manual receipt entry", () => {
  it("creates a complete receipt from the quick-entry fields", async () => {
    const response = await app().request("https://app.example/receipts/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: "Monitor arm",
        amount_cents: 12999,
        business_use_pct: 80,
        expense_date: "2026-07-15",
        seller_name: "Office Shop",
        notes: "Home office",
      }),
    }, { DB: db } as AppEnv["Bindings"]);

    expect(response.status).toBe(201);
    const body = await response.json() as { receipt: Record<string, unknown> };
    expect(body.receipt).toMatchObject({
      status: "complete",
      category: "Aufwendungen für Arbeitsmittel",
      description: "Monitor arm",
      amount_cents: 12999,
      business_use_pct: 80,
      deductible_cents: 10399,
      expense_date: "2026-07-15",
      tax_year: 2026,
      seller_name: "Office Shop",
      seller_address: "",
      invoice_number: "",
      payment_method: "",
      notes: "Home office",
      has_file: false,
    });
  });

  it("does not persist an incomplete quick entry", async () => {
    const response = await app().request("https://app.example/receipts/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: "",
        amount_cents: 0,
        business_use_pct: 100,
        expense_date: "2026-07-15",
        seller_name: "",
        notes: "",
      }),
    }, { DB: db } as AppEnv["Bindings"]);
    const count = await db.prepare("SELECT COUNT(*) AS count FROM receipts").first<{ count: number }>();

    expect(response.status).toBe(400);
    expect(count?.count).toBe(1);
  });
});
