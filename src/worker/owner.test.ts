import { Hono } from "hono";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api } from "./api";
import { ensureOwner } from "./owner";
import { receiptObjectKey } from "./storage";
import type { AppEnv, Owner } from "./types";

let miniflare: Miniflare;
let db: D1Database;

beforeAll(async () => {
  miniflare = new Miniflare({
    compatibilityDate: "2026-08-06",
    d1Databases: ["DB"],
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
  });
  db = await miniflare.getD1Database("DB");
  await db.batch([
    db.prepare(`CREATE TABLE users (
      id TEXT PRIMARY KEY,
      access_issuer TEXT NOT NULL,
      access_subject TEXT NOT NULL,
      email TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (access_issuer, access_subject)
    ) STRICT`),
    db.prepare(`CREATE TABLE tax_year_defaults (
      tax_year INTEGER PRIMARY KEY,
      gwg_limit_cents INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT`),
    db.prepare("INSERT INTO tax_year_defaults VALUES (2026, 80000, '2026-01-01T00:00:00.000Z')"),
    db.prepare(`CREATE TABLE tax_year_config (
      owner_id TEXT NOT NULL,
      tax_year INTEGER NOT NULL,
      gwg_limit_cents INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (owner_id, tax_year)
    ) STRICT`),
    db.prepare(`CREATE TABLE receipts (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      owner_email TEXT NOT NULL,
      tax_year INTEGER NOT NULL,
      expense_date TEXT NOT NULL,
      created_at TEXT NOT NULL,
      description TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      gwg_flag INTEGER NOT NULL,
      r2_key TEXT,
      original_filename TEXT,
      mime_type TEXT
    ) STRICT`),
  ]);
});

afterAll(async () => {
  await miniflare.dispose();
});

describe("UUID owner isolation", () => {
  let first: Owner;
  let second: Owner;

  it("maps each Access subject to a stable, distinct backend UUID", async () => {
    first = await ensureOwner(db, {
      issuer: "https://cougz.cloudflareaccess.com",
      subject: "subject-a",
      email: "first@example.com",
    });
    second = await ensureOwner(db, {
      issuer: "https://cougz.cloudflareaccess.com",
      subject: "subject-b",
      email: "second@example.com",
    });
    const firstAgain = await ensureOwner(db, {
      issuer: "https://cougz.cloudflareaccess.com",
      subject: "subject-a",
      email: "first@example.com",
    });

    expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.id).not.toBe(first.id);
    expect(firstAgain.id).toBe(first.id);
  });

  it("creates separate year settings and R2 prefixes", async () => {
    const configs = await db.prepare(
      "SELECT owner_id FROM tax_year_config ORDER BY owner_id",
    ).all<{ owner_id: string }>();
    expect(configs.results.map((row) => row.owner_id).sort()).toEqual([first.id, second.id].sort());
    expect(receiptObjectKey(first.id, "receipt-id")).toBe(`receipts/${first.id}/receipt-id`);
    expect(receiptObjectKey(second.id, "receipt-id")).not.toBe(receiptObjectKey(first.id, "receipt-id"));
  });

  it("returns only rows belonging to the resolved owner", async () => {
    await db.batch([
      db.prepare("INSERT INTO receipts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind("receipt-a", first.id, first.email, 2026, "2026-01-01", "2026-01-01", "First receipt", 1000, 0, null, null, null),
      db.prepare("INSERT INTO receipts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind("receipt-b", second.id, second.email, 2026, "2026-01-02", "2026-01-02", "Second receipt", 2000, 0, null, null, null),
    ]);

    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      c.set("owner", first);
      await next();
    });
    app.route("/", api);
    const env = { DB: db } as AppEnv["Bindings"];
    const list = await app.request("https://app.example/receipts?tax_year=2026", {}, env);
    const foreign = await app.request("https://app.example/receipts/receipt-b", {}, env);

    expect(list.status).toBe(200);
    const body = await list.json() as { receipts: Array<Record<string, unknown>> };
    expect(body.receipts).toMatchObject([{ id: "receipt-a" }]);
    expect(body.receipts[0]).not.toHaveProperty("owner_id");
    expect(body.receipts[0]).not.toHaveProperty("r2_key");
    expect(foreign.status).toBe(404);

    const foreignDelete = await app.request("https://app.example/receipts/receipt-b", { method: "DELETE" }, env);
    const foreignDuplicate = await app.request(
      "https://app.example/receipts/receipt-b/duplicate",
      { method: "POST" },
      env,
    );
    const foreignFile = await app.request("https://app.example/receipts/receipt-b/file", {}, env);
    expect(foreignDelete.status).toBe(404);
    expect(foreignDuplicate.status).toBe(404);
    expect(foreignFile.status).toBe(404);
  });
});
