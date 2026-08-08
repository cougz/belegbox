import { Hono } from "hono";
import { extractReceiptSuggestions } from "./ocr";
import { receiptObjectKey } from "./storage";
import { CATEGORY, type AppEnv, type Category, type ReceiptRow } from "./types";

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const RECEIPT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ReceiptInput {
  status: "draft" | "complete";
  category: Category;
  description: string;
  amount_cents: number;
  business_use_pct: number;
  expense_date: string;
  tax_year: number;
  seller_name: string;
  seller_address: string;
  invoice_number: string;
  payment_method: string;
  notes: string;
}

interface ManualReceiptInput {
  description: string;
  amount_cents: number;
  business_use_pct: number;
  expense_date: string;
  tax_year: number;
  seller_name: string;
  notes: string;
}

function receiptForClient(receipt: ReceiptRow) {
  const { owner_id: _ownerId, r2_key: _r2Key, ...publicReceipt } = receipt;
  return {
    ...publicReceipt,
    has_file: Boolean(receipt.r2_key),
  };
}

function jsonError(c: { json: (body: unknown, status: 400 | 404 | 409 | 413 | 415 | 422) => Response }, message: string, status: 400 | 404 | 409 | 413 | 415 | 422 = 400) {
  return c.json({ error: message }, status);
}

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length <= max ? value.trim() : null;
}

function parseReceiptInput(value: unknown): ReceiptInput | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const category = input.category;
  const status = input.status;
  const description = text(input.description, 500);
  const sellerName = text(input.seller_name, 300);
  const sellerAddress = text(input.seller_address, 1000);
  const invoiceNumber = text(input.invoice_number, 200);
  const paymentMethod = text(input.payment_method, 100);
  const notes = text(input.notes, 5000);
  if (
    (status !== "draft" && status !== "complete") ||
    category !== CATEGORY ||
    description === null ||
    sellerName === null ||
    sellerAddress === null ||
    invoiceNumber === null ||
    paymentMethod === null ||
    notes === null ||
    !Number.isInteger(input.amount_cents) ||
    (input.amount_cents as number) < 0 ||
    (input.amount_cents as number) > 999_999_999 ||
    !Number.isInteger(input.business_use_pct) ||
    (input.business_use_pct as number) < 0 ||
    (input.business_use_pct as number) > 100 ||
    typeof input.expense_date !== "string" ||
    !isDate(input.expense_date) ||
    !Number.isInteger(input.tax_year) ||
    (input.tax_year as number) !== Number(input.expense_date.slice(0, 4))
  ) {
    return null;
  }

  return {
    status,
    category: category as Category,
    description,
    amount_cents: input.amount_cents as number,
    business_use_pct: input.business_use_pct as number,
    expense_date: input.expense_date,
    tax_year: input.tax_year as number,
    seller_name: sellerName,
    seller_address: sellerAddress,
    invoice_number: invoiceNumber,
    payment_method: paymentMethod,
    notes,
  };
}

function parseManualReceiptInput(value: unknown): ManualReceiptInput | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const description = text(input.description, 500);
  const sellerName = text(input.seller_name, 300);
  const notes = text(input.notes, 5000);
  if (
    !description ||
    sellerName === null ||
    notes === null ||
    !Number.isInteger(input.amount_cents) ||
    (input.amount_cents as number) <= 0 ||
    (input.amount_cents as number) > 999_999_999 ||
    !Number.isInteger(input.business_use_pct) ||
    (input.business_use_pct as number) < 0 ||
    (input.business_use_pct as number) > 100 ||
    typeof input.expense_date !== "string" ||
    !isDate(input.expense_date)
  ) {
    return null;
  }

  return {
    description,
    amount_cents: input.amount_cents as number,
    business_use_pct: input.business_use_pct as number,
    expense_date: input.expense_date,
    tax_year: Number(input.expense_date.slice(0, 4)),
    seller_name: sellerName,
    notes,
  };
}

function fileType(bytes: Uint8Array): string | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (ascii(0, 5) === "%PDF-") return "application/pdf";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(0, 4) === "GIF8") return "image/gif";
  if (ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (brand === "avif") return "image/avif";
    if (["heic", "heix", "hevc", "mif1"].includes(brand)) return "image/heic";
  }
  return null;
}

function draftValues(filename = "Manual entry") {
  const date = new Date().toISOString().slice(0, 10);
  return {
    category: CATEGORY,
    description: filename,
    expense_date: date,
    tax_year: Number(date.slice(0, 4)),
  };
}

export const api = new Hono<AppEnv>();

api.get("/session", (c) => c.json({ email: c.get("owner").email }));

api.get("/tax-years", async (c) => {
  const result = await c.env.DB.prepare(
    "SELECT DISTINCT tax_year FROM receipts WHERE owner_id = ? ORDER BY tax_year DESC",
  ).bind(c.get("owner").id).all<{ tax_year: number }>();
  return c.json({ tax_years: result.results.map((row) => row.tax_year) });
});

api.get("/receipts", async (c) => {
  const owner = c.get("owner");
  const year = c.req.query("tax_year");
  const conditions = ["r.owner_id = ?"];
  const values: unknown[] = [owner.id];
  if (year) {
    const parsed = Number(year);
    if (!Number.isInteger(parsed)) return jsonError(c, "Invalid tax year");
    conditions.push("r.tax_year = ?");
    values.push(parsed);
  }
  const result = await c.env.DB.prepare(
    `SELECT * FROM receipts r
     WHERE ${conditions.join(" AND ")} ORDER BY r.expense_date DESC, r.created_at DESC`,
  ).bind(...values).all<ReceiptRow>();
  return c.json({ receipts: result.results.map(receiptForClient) });
});

api.get("/receipts/:id", async (c) => {
  const receipt = await c.env.DB.prepare(
    "SELECT * FROM receipts WHERE id = ? AND owner_id = ?",
  ).bind(c.req.param("id"), c.get("owner").id).first<ReceiptRow>();
  return receipt ? c.json({ receipt: receiptForClient(receipt) }) : jsonError(c, "Receipt not found", 404);
});

api.post("/receipts/manual", async (c) => {
  const input = parseManualReceiptInput(await c.req.json().catch(() => null));
  if (!input) return jsonError(c, "Manual receipt data is invalid");
  const owner = c.get("owner");
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO receipts (
      id, created_at, updated_at, owner_id, owner_email, status, category, description, amount_cents,
      business_use_pct, expense_date, tax_year, seller_name, notes
    ) VALUES (?, ?, ?, ?, ?, 'complete', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    now,
    now,
    owner.id,
    owner.email,
    CATEGORY,
    input.description,
    input.amount_cents,
    input.business_use_pct,
    input.expense_date,
    input.tax_year,
    input.seller_name,
    input.notes,
  ).run();
  const receipt = await c.env.DB.prepare("SELECT * FROM receipts WHERE id = ? AND owner_id = ?")
    .bind(id, owner.id).first<ReceiptRow>();
  return c.json({ receipt: receipt ? receiptForClient(receipt) : null }, 201);
});

api.post("/receipts/upload", async (c) => {
  const form = await c.req.raw.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return jsonError(c, "A file is required");
  if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
    return jsonError(c, `Files may be at most ${MAX_FILE_SIZE / 1024 / 1024} MB`, 413);
  }
  const mimeType = fileType(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
  if (!mimeType) return jsonError(c, "Only PDF, JPEG, PNG, WebP, GIF, AVIF, and HEIC files are allowed", 415);

  const requestedId = form?.get("receipt_id");
  if (requestedId !== null && (typeof requestedId !== "string" || !RECEIPT_ID.test(requestedId))) {
    return jsonError(c, "Receipt ID is invalid");
  }
  const taxYearHintRaw = Number(form?.get("tax_year_hint"));
  const taxYearHint = Number.isInteger(taxYearHintRaw) && taxYearHintRaw >= 2000 && taxYearHintRaw <= 2200
    ? taxYearHintRaw
    : undefined;
  const id = requestedId ?? crypto.randomUUID();
  const owner = c.get("owner");
  const existing = await c.env.DB.prepare("SELECT * FROM receipts WHERE id = ?").bind(id).first<ReceiptRow>();
  if (existing) {
    if (existing.owner_id !== owner.id) return jsonError(c, "Receipt ID is already in use", 409);
    const aiPrefill = await extractReceiptSuggestions(c.env, file, mimeType, taxYearHint);
    return c.json({
      receipt: receiptForClient(existing),
      suggestions: aiPrefill.suggestions,
      ai_prefill: { status: aiPrefill.status, model: aiPrefill.model },
    });
  }

  const draft = draftValues(file.name.slice(0, 500));
  const now = new Date().toISOString();
  const r2Key = `${receiptObjectKey(owner.id, id)}/${crypto.randomUUID()}`;
  await c.env.RECEIPTS.put(r2Key, file, {
    httpMetadata: { contentType: mimeType },
  });
  let receipt: ReceiptRow | null = null;
  let created = true;
  try {
    await c.env.DB.prepare(
      `INSERT INTO receipts (
        id, created_at, updated_at, owner_id, owner_email, category, description, expense_date, tax_year,
        r2_key, original_filename, mime_type, file_size
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      now,
      now,
      owner.id,
      owner.email,
      draft.category,
      draft.description,
      draft.expense_date,
      draft.tax_year,
      r2Key,
      file.name.slice(0, 500),
      mimeType,
      file.size,
    ).run();
  } catch (error) {
    await c.env.RECEIPTS.delete(r2Key);
    receipt = await c.env.DB.prepare("SELECT * FROM receipts WHERE id = ?").bind(id).first<ReceiptRow>();
    if (!receipt) throw error;
    if (receipt.owner_id !== owner.id) return jsonError(c, "Receipt ID is already in use", 409);
    created = false;
  }

  const [storedReceipt, aiPrefill] = await Promise.all([
    receipt
      ? Promise.resolve(receipt)
      : c.env.DB.prepare("SELECT * FROM receipts WHERE id = ? AND owner_id = ?")
        .bind(id, owner.id).first<ReceiptRow>(),
    extractReceiptSuggestions(c.env, file, mimeType, taxYearHint),
  ]);
  return c.json({
    receipt: storedReceipt ? receiptForClient(storedReceipt) : null,
    suggestions: aiPrefill.suggestions,
    ai_prefill: { status: aiPrefill.status, model: aiPrefill.model },
  }, created ? 201 : 200);
});

api.put("/receipts/:id", async (c) => {
  const input = parseReceiptInput(await c.req.json().catch(() => null));
  if (!input) return jsonError(c, "Receipt data is invalid");
  const owner = c.get("owner");
  const updatedAt = new Date().toISOString();
  const result = await c.env.DB.prepare(
    `UPDATE receipts SET
      updated_at = ?, status = ?, category = ?, description = ?, amount_cents = ?,
      business_use_pct = ?, expense_date = ?, tax_year = ?, seller_name = ?, seller_address = ?,
      invoice_number = ?, payment_method = ?, notes = ?
    WHERE id = ? AND owner_id = ? RETURNING *`,
  ).bind(
    updatedAt,
    input.status,
    input.category,
    input.description,
    input.amount_cents,
    input.business_use_pct,
    input.expense_date,
    input.tax_year,
    input.seller_name,
    input.seller_address,
    input.invoice_number,
    input.payment_method,
    input.notes,
    c.req.param("id"),
    owner.id,
  ).first<ReceiptRow>();
  return result ? c.json({ receipt: receiptForClient(result) }) : jsonError(c, "Receipt not found", 404);
});

api.post("/receipts/:id/duplicate", async (c) => {
  const source = await c.env.DB.prepare(
    "SELECT * FROM receipts WHERE id = ? AND owner_id = ?",
  ).bind(c.req.param("id"), c.get("owner").id).first<ReceiptRow>();
  if (!source) return jsonError(c, "Receipt not found", 404);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  let r2Key: string | null = null;
  if (source.r2_key) {
    const object = await c.env.RECEIPTS.get(source.r2_key);
    if (!object) return jsonError(c, "Original file is missing", 409);
    r2Key = receiptObjectKey(c.get("owner").id, id);
    await c.env.RECEIPTS.put(r2Key, object.body, { httpMetadata: object.httpMetadata });
  }
  try {
    await c.env.DB.prepare(
      `INSERT INTO receipts (
        id, created_at, updated_at, owner_id, owner_email, status, category, description, amount_cents,
        business_use_pct, expense_date, tax_year, seller_name, seller_address, invoice_number,
        payment_method, notes, r2_key, original_filename, mime_type, file_size
      ) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id, now, now, source.owner_id, source.owner_email, source.category, `${source.description.slice(0, 493)} (copy)`,
      source.amount_cents, source.business_use_pct, source.expense_date, source.tax_year,
      source.seller_name, source.seller_address, source.invoice_number, source.payment_method,
      source.notes, r2Key, source.original_filename, source.mime_type, source.file_size,
    ).run();
  } catch (error) {
    if (r2Key) await c.env.RECEIPTS.delete(r2Key);
    throw error;
  }
  const receipt = await c.env.DB.prepare("SELECT * FROM receipts WHERE id = ? AND owner_id = ?")
    .bind(id, c.get("owner").id).first<ReceiptRow>();
  return c.json({ receipt: receipt ? receiptForClient(receipt) : null }, 201);
});

api.delete("/receipts/:id", async (c) => {
  const receipt = await c.env.DB.prepare(
    "SELECT * FROM receipts WHERE id = ? AND owner_id = ?",
  ).bind(c.req.param("id"), c.get("owner").id).first<ReceiptRow>();
  if (!receipt) return jsonError(c, "Receipt not found", 404);
  await c.env.DB.prepare("DELETE FROM receipts WHERE id = ? AND owner_id = ?")
    .bind(receipt.id, receipt.owner_id).run();
  if (receipt.r2_key) await c.env.RECEIPTS.delete(receipt.r2_key);
  return c.body(null, 204);
});

api.get("/receipts/:id/file", async (c) => {
  const receipt = await c.env.DB.prepare(
    `SELECT r2_key, original_filename, mime_type FROM receipts
     WHERE id = ? AND owner_id = ? AND r2_key IS NOT NULL`,
  ).bind(c.req.param("id"), c.get("owner").id).first<Pick<ReceiptRow, "r2_key" | "original_filename" | "mime_type">>();
  if (!receipt?.r2_key) return jsonError(c, "File not found", 404);
  const object = await c.env.RECEIPTS.get(receipt.r2_key);
  if (!object) return jsonError(c, "File not found", 404);
  const filename = receipt.original_filename || "receipt";
  return new Response(object.body, {
    headers: {
      "Content-Type": receipt.mime_type || "application/octet-stream",
      "Content-Disposition": `inline; filename="receipt"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "sandbox",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN",
    },
  });
});
