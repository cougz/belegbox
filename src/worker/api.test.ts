import { Hono } from "hono";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api } from "./api";
import type { AppEnv, Owner } from "./types";

let miniflare: Miniflare;
let db: D1Database;
let receipts: R2Bucket;

const owner: Owner = {
  id: "463aaecd-fdc7-455d-ab85-bb9a951c90a3",
  email: "owner@example.com",
};

beforeAll(async () => {
  miniflare = new Miniflare({
    compatibilityDate: "2026-08-06",
    d1Databases: ["DB"],
    r2Buckets: ["RECEIPTS"],
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
  });
  db = await miniflare.getD1Database("DB");
  receipts = await miniflare.getR2Bucket("RECEIPTS");
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

describe("receipt upload", () => {
  it("reuses a client receipt ID when an upload response is retried", async () => {
    const receiptId = "f42b36e7-58bb-43cc-8916-9572c901c627";
    const upload = () => {
      const form = new FormData();
      form.set("receipt_id", receiptId);
      form.set("file", new File([new Uint8Array([0xff, 0xd8, 0xff, 0x00])], "receipt.jpg", { type: "image/jpeg" }));
      return app().request("https://app.example/receipts/upload", {
        method: "POST",
        body: form,
      }, {
        DB: db,
        RECEIPTS: receipts,
        AI_PREFILL_ENABLED: "false",
      } as AppEnv["Bindings"]);
    };

    const first = await upload();
    const retry = await upload();
    const count = await db.prepare("SELECT COUNT(*) AS count FROM receipts WHERE id = ?")
      .bind(receiptId).first<{ count: number }>();

    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(count?.count).toBe(1);
    await expect(retry.json()).resolves.toMatchObject({
      receipt: { id: receiptId, original_filename: "receipt.jpg" },
      ai_prefill: { status: "disabled" },
    });
  });

  it("keeps the winning original when the same upload starts concurrently", async () => {
    const receiptId = "5103acda-9fc0-48cd-a2a5-57dbdb82b3a6";
    const upload = () => {
      const form = new FormData();
      form.set("receipt_id", receiptId);
      form.set("file", new File([new Uint8Array([0xff, 0xd8, 0xff, 0x01])], "concurrent.jpg", { type: "image/jpeg" }));
      return app().request("https://app.example/receipts/upload", {
        method: "POST",
        body: form,
      }, {
        DB: db,
        RECEIPTS: receipts,
        AI_PREFILL_ENABLED: "false",
      } as AppEnv["Bindings"]);
    };

    const responses = await Promise.all([upload(), upload()]);
    const row = await db.prepare("SELECT r2_key FROM receipts WHERE id = ?")
      .bind(receiptId).first<{ r2_key: string }>();
    const objects = await receipts.list({ prefix: `receipts/${owner.id}/${receiptId}/` });

    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    expect(row?.r2_key).toBeTruthy();
    expect(await receipts.get(row!.r2_key)).not.toBeNull();
    expect(objects.objects).toHaveLength(1);
  });

  it("completes two uploaded receipts independently", async () => {
    const ids = [
      "0b6e4873-921c-444d-bf7c-0d15b20fbc83",
      "3df18cc0-93da-4d46-a135-e57c4c485eb5",
    ];
    const upload = (id: string, index: number) => {
      const form = new FormData();
      form.set("receipt_id", id);
      form.set("file", new File([new Uint8Array([0xff, 0xd8, 0xff, index])], `receipt-${index}.jpg`, { type: "image/jpeg" }));
      return app().request("https://app.example/receipts/upload", {
        method: "POST",
        body: form,
      }, {
        DB: db,
        RECEIPTS: receipts,
        AI_PREFILL_ENABLED: "false",
      } as AppEnv["Bindings"]);
    };
    const save = (id: string, index: number) => app().request(`https://app.example/receipts/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "complete",
        category: "Aufwendungen für Arbeitsmittel",
        description: `Receipt ${index}`,
        amount_cents: 1000 + index,
        business_use_pct: 100,
        expense_date: "2026-08-08",
        tax_year: 2026,
        seller_name: "Test Shop",
        seller_address: "",
        invoice_number: "",
        payment_method: "",
        notes: "",
      }),
    }, { DB: db } as AppEnv["Bindings"]);

    const uploads = await Promise.all(ids.map(upload));
    const first = await save(ids[0], 1);
    const second = await save(ids[1], 2);
    const completed = await db.prepare(
      "SELECT COUNT(*) AS count FROM receipts WHERE id IN (?, ?) AND status = 'complete'",
    ).bind(...ids).first<{ count: number }>();

    expect(uploads.map((response) => response.status)).toEqual([201, 201]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(completed?.count).toBe(2);
  });
});
