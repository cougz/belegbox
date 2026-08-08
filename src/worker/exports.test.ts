import { Hono } from "hono";
import { Miniflare } from "miniflare";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exportsApi } from "./exports";
import type { AppEnv, Owner } from "./types";

const PNG_1X1 = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="),
  (char) => char.charCodeAt(0),
);

let miniflare: Miniflare;
let db: D1Database;
let receipts: Awaited<ReturnType<Miniflare["getR2Bucket"]>>;

const owner: Owner = {
  id: "6a3d7c9e-8f0c-4a4a-9c0f-6b7e5e6c9d10",
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
      file_size INTEGER
    ) STRICT`),
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
  instance.route("/", exportsApi);
  return instance;
}

async function samplePdfBytes(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.addPage([200, 200]);
  return document.save();
}

describe("PDF export", () => {
  it("embeds an uploaded image and PDF original inline and skips unsupported types", async () => {
    const pdfBytes = await samplePdfBytes();
    await db.batch([
      db.prepare(
        `INSERT INTO receipts (
          id, created_at, updated_at, owner_id, owner_email, status, category, description, amount_cents,
          business_use_pct, expense_date, tax_year, r2_key, original_filename, mime_type, file_size
        ) VALUES (?, ?, ?, ?, ?, 'complete', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        "receipt-image", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", owner.id, owner.email,
        "Aufwendungen für Arbeitsmittel", "Monitor", 12999, 100, "2026-03-01", 2026,
        "originals/image.png", "image.png", "image/png", PNG_1X1.length,
      ),
      db.prepare(
        `INSERT INTO receipts (
          id, created_at, updated_at, owner_id, owner_email, status, category, description, amount_cents,
          business_use_pct, expense_date, tax_year, r2_key, original_filename, mime_type, file_size
        ) VALUES (?, ?, ?, ?, ?, 'complete', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        "receipt-pdf", "2026-01-02T00:00:00Z", "2026-01-02T00:00:00Z", owner.id, owner.email,
        "Aufwendungen für Arbeitsmittel", "Invoice scan", 5000, 100, "2026-03-02", 2026,
        "originals/scan.pdf", "scan.pdf", "application/pdf", pdfBytes.length,
      ),
      db.prepare(
        `INSERT INTO receipts (
          id, created_at, updated_at, owner_id, owner_email, status, category, description, amount_cents,
          business_use_pct, expense_date, tax_year, r2_key, original_filename, mime_type, file_size
        ) VALUES (?, ?, ?, ?, ?, 'complete', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        "receipt-heic", "2026-01-03T00:00:00Z", "2026-01-03T00:00:00Z", owner.id, owner.email,
        "Aufwendungen für Arbeitsmittel", "Phone photo", 2000, 100, "2026-03-03", 2026,
        "originals/photo.heic", "photo.heic", "image/heic", 10,
      ),
    ]);
    await receipts.put("originals/image.png", PNG_1X1);
    await receipts.put("originals/scan.pdf", pdfBytes);
    await receipts.put("originals/photo.heic", new Uint8Array([0, 1, 2, 3]));

    const response = await app().request(
      "https://app.example/2026",
      {},
      { DB: db, RECEIPTS: receipts } as AppEnv["Bindings"],
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe("%PDF-");

    const resultDoc = await PDFDocument.load(bytes);
    // 1 summary page + 1 image page + 1 copied PDF page (captioned in place) + 1 note page for the unsupported HEIC.
    expect(resultDoc.getPageCount()).toBe(4);
  });

  it("rejects an invalid tax year", async () => {
    const response = await app().request(
      "https://app.example/not-a-year",
      {},
      { DB: db, RECEIPTS: receipts } as AppEnv["Bindings"],
    );
    expect(response.status).toBe(400);
  });
});
