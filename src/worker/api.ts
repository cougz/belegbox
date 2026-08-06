import { Hono } from "hono";
import { CATEGORIES, type AppEnv, type Category, type ReceiptRow, type TaxYearConfig } from "./types";

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_AI_FILE_SIZE = 5 * 1024 * 1024;

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
    !CATEGORIES.includes(category as Category) ||
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

function parseAiJson(response: unknown): Record<string, unknown> | null {
  if (!response || typeof response !== "object") return null;
  const raw = (response as { response?: unknown }).response;
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function aiSuggestions(env: AppEnv["Bindings"], file: File, mimeType: string) {
  if (
    env.AI_PREFILL_ENABLED !== "true" ||
    !mimeType.startsWith("image/") ||
    mimeType === "image/heic" ||
    file.size > MAX_AI_FILE_SIZE
  ) {
    return null;
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await env.AI.run(
      "@cf/meta/llama-3.2-11b-vision-instruct",
      {
        image: [...bytes],
        prompt:
          "Lies diesen deutschen Beleg. Antworte nur als JSON mit seller_name (String), " +
          "expense_date (YYYY-MM-DD oder leer) und amount_cents (ganzzahlige Euro-Cent oder null).",
        max_tokens: 180,
      },
    );
    const parsed = parseAiJson(result);
    if (!parsed) return null;
    return {
      seller_name: text(parsed.seller_name, 300) ?? "",
      expense_date: typeof parsed.expense_date === "string" && isDate(parsed.expense_date)
        ? parsed.expense_date
        : "",
      amount_cents: Number.isInteger(parsed.amount_cents) && (parsed.amount_cents as number) >= 0
        ? parsed.amount_cents
        : null,
    };
  } catch {
    return null;
  }
}

async function configFor(db: D1Database, year: number): Promise<TaxYearConfig | null> {
  return db.prepare("SELECT * FROM tax_year_config WHERE tax_year = ?").bind(year).first<TaxYearConfig>();
}

function draftValues(filename = "Manueller Eintrag") {
  const date = new Date().toISOString().slice(0, 10);
  return {
    category: "Sonstiges" as const,
    description: filename,
    expense_date: date,
    tax_year: Number(date.slice(0, 4)),
  };
}

export const api = new Hono<AppEnv>();

api.get("/session", (c) => c.json({ email: c.get("user").email }));

api.get("/config", async (c) => {
  const result = await c.env.DB.prepare("SELECT * FROM tax_year_config ORDER BY tax_year DESC").all<TaxYearConfig>();
  return c.json({ config: result.results });
});

api.put("/config/:year", async (c) => {
  const year = Number(c.req.param("year"));
  const value = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!Number.isInteger(year) || year < 2000 || year > 2200 || !value) {
    return jsonError(c, "Ungueltiges Steuerjahr");
  }
  const fields = [
    "gwg_limit_cents",
    "homeoffice_daily_cents",
    "homeoffice_max_days",
    "distance_first_20_km_cents",
    "distance_after_20_km_cents",
  ] as const;
  if (fields.some((field) => !Number.isInteger(value[field]) || (value[field] as number) < 0)) {
    return jsonError(c, "Alle Jahreswerte muessen nichtnegative Ganzzahlen sein");
  }
  const updatedAt = new Date().toISOString();
  const updateConfig = c.env.DB.prepare(
    `INSERT INTO tax_year_config (
      tax_year, gwg_limit_cents, homeoffice_daily_cents, homeoffice_max_days,
      distance_first_20_km_cents, distance_after_20_km_cents, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tax_year) DO UPDATE SET
      gwg_limit_cents = excluded.gwg_limit_cents,
      homeoffice_daily_cents = excluded.homeoffice_daily_cents,
      homeoffice_max_days = excluded.homeoffice_max_days,
      distance_first_20_km_cents = excluded.distance_first_20_km_cents,
      distance_after_20_km_cents = excluded.distance_after_20_km_cents,
      updated_at = excluded.updated_at`,
  ).bind(year, ...fields.map((field) => value[field]), updatedAt);
  const recalculateGwg = c.env.DB.prepare(
    `UPDATE receipts SET
      gwg_flag = CASE
        WHEN category = 'Arbeitsmittel' AND amount_cents > ? THEN 1
        ELSE 0
      END,
      updated_at = ?
    WHERE tax_year = ?`,
  ).bind(value.gwg_limit_cents, updatedAt, year);
  await c.env.DB.batch([updateConfig, recalculateGwg]);
  return c.json({ config: await configFor(c.env.DB, year) });
});

api.get("/receipts", async (c) => {
  const owner = c.get("user").email;
  const year = c.req.query("tax_year");
  const category = c.req.query("category");
  const conditions = ["owner_email = ?"];
  const values: unknown[] = [owner];
  if (year) {
    const parsed = Number(year);
    if (!Number.isInteger(parsed)) return jsonError(c, "Ungueltiges Steuerjahr");
    conditions.push("tax_year = ?");
    values.push(parsed);
  }
  if (category) {
    if (!CATEGORIES.includes(category as Category)) return jsonError(c, "Ungueltige Kategorie");
    conditions.push("category = ?");
    values.push(category);
  }
  const result = await c.env.DB.prepare(
    `SELECT * FROM receipts WHERE ${conditions.join(" AND ")} ORDER BY expense_date DESC, created_at DESC`,
  ).bind(...values).all<ReceiptRow>();
  return c.json({ receipts: result.results });
});

api.get("/receipts/:id", async (c) => {
  const receipt = await c.env.DB.prepare(
    "SELECT * FROM receipts WHERE id = ? AND owner_email = ?",
  ).bind(c.req.param("id"), c.get("user").email).first<ReceiptRow>();
  return receipt ? c.json({ receipt }) : jsonError(c, "Beleg nicht gefunden", 404);
});

api.post("/receipts/manual", async (c) => {
  const draft = draftValues();
  if (!(await configFor(c.env.DB, draft.tax_year))) {
    return jsonError(c, "Fuer das aktuelle Jahr fehlt die Jahreskonfiguration", 422);
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO receipts (
      id, created_at, updated_at, owner_email, category, description, expense_date, tax_year
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    now,
    now,
    c.get("user").email,
    draft.category,
    draft.description,
    draft.expense_date,
    draft.tax_year,
  ).run();
  const receipt = await c.env.DB.prepare("SELECT * FROM receipts WHERE id = ? AND owner_email = ?")
    .bind(id, c.get("user").email).first<ReceiptRow>();
  return c.json({ receipt }, 201);
});

api.post("/receipts/upload", async (c) => {
  const form = await c.req.raw.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return jsonError(c, "Eine Datei ist erforderlich");
  if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
    return jsonError(c, `Dateien duerfen hoechstens ${MAX_FILE_SIZE / 1024 / 1024} MB gross sein`, 413);
  }
  const mimeType = fileType(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
  if (!mimeType) return jsonError(c, "Nur PDF, JPEG, PNG, WebP, GIF, AVIF und HEIC sind erlaubt", 415);

  const draft = draftValues(file.name.slice(0, 500));
  if (!(await configFor(c.env.DB, draft.tax_year))) {
    return jsonError(c, "Fuer das aktuelle Jahr fehlt die Jahreskonfiguration", 422);
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const r2Key = `receipts/${encodeURIComponent(c.get("user").email)}/${id}`;
  await c.env.RECEIPTS.put(r2Key, file.stream(), {
    httpMetadata: { contentType: mimeType },
  });
  try {
    await c.env.DB.prepare(
      `INSERT INTO receipts (
        id, created_at, updated_at, owner_email, category, description, expense_date, tax_year,
        r2_key, original_filename, mime_type, file_size
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      now,
      now,
      c.get("user").email,
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
    throw error;
  }

  const [receipt, suggestions] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM receipts WHERE id = ? AND owner_email = ?")
      .bind(id, c.get("user").email).first<ReceiptRow>(),
    aiSuggestions(c.env, file, mimeType),
  ]);
  return c.json({ receipt, suggestions }, 201);
});

api.post("/import/json", async (c) => {
  const backup = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (
    !backup ||
    backup.schema !== "belegbox-export-v1" ||
    !Number.isInteger(backup.tax_year) ||
    !Array.isArray(backup.categories) ||
    !backup.config ||
    typeof backup.config !== "object"
  ) {
    return jsonError(c, "Keine gueltige belegbox-JSON-Sicherung");
  }
  const year = backup.tax_year as number;
  const importedConfig = backup.config as Record<string, unknown>;
  const configFields = [
    "gwg_limit_cents",
    "homeoffice_daily_cents",
    "homeoffice_max_days",
    "distance_first_20_km_cents",
    "distance_after_20_km_cents",
  ] as const;
  if (
    importedConfig.tax_year !== year ||
    configFields.some((field) => !Number.isInteger(importedConfig[field]) || (importedConfig[field] as number) < 0)
  ) {
    return jsonError(c, "Die Sicherung enthaelt ungueltige Jahreswerte");
  }
  const existingConfig = await configFor(c.env.DB, year);
  if (existingConfig && configFields.some((field) => existingConfig[field] !== importedConfig[field])) {
    return jsonError(c, "Die vorhandenen Jahreswerte weichen von der Sicherung ab", 409);
  }
  const items = backup.categories.flatMap((group) => {
    if (!group || typeof group !== "object" || !Array.isArray((group as { items?: unknown }).items)) return [];
    return (group as { items: unknown[] }).items;
  });
  if (items.length > 40) return jsonError(c, "Pro Import sind hoechstens 40 Belege erlaubt");

  const parsed = items.map(parseReceiptInput);
  if (parsed.some((item) => !item || item.tax_year !== year)) {
    return jsonError(c, "Die Sicherung enthaelt ungueltige Belegdaten");
  }
  const owner = c.get("user").email;
  const now = new Date().toISOString();
  const configStatement = c.env.DB.prepare(
    `INSERT INTO tax_year_config (
      tax_year, gwg_limit_cents, homeoffice_daily_cents, homeoffice_max_days,
      distance_first_20_km_cents, distance_after_20_km_cents, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(tax_year) DO NOTHING`,
  ).bind(year, ...configFields.map((field) => importedConfig[field]), now);
  const statements = (parsed as ReceiptInput[]).map((item, index) => {
    const source = items[index] as Record<string, unknown>;
    const originalFilename = text(source.original_filename, 500);
    const mimeType = text(source.mime_type, 100);
    const fileSize = source.file_size === null || source.file_size === undefined
      ? null
      : Number.isInteger(source.file_size) && (source.file_size as number) >= 0
        ? source.file_size
        : null;
    const gwgFlag = item.category === "Arbeitsmittel" && item.amount_cents > (importedConfig.gwg_limit_cents as number) ? 1 : 0;
    return c.env.DB.prepare(
      `INSERT INTO receipts (
        id, created_at, updated_at, owner_email, status, category, description, amount_cents,
        business_use_pct, expense_date, tax_year, seller_name, seller_address, invoice_number,
        payment_method, notes, original_filename, mime_type, file_size, gwg_flag
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), now, now, owner, item.status, item.category, item.description,
      item.amount_cents, item.business_use_pct, item.expense_date, item.tax_year, item.seller_name,
      item.seller_address, item.invoice_number, item.payment_method, item.notes, originalFilename,
      mimeType, fileSize, gwgFlag,
    );
  });
  await c.env.DB.batch([configStatement, ...statements]);
  return c.json({ imported: statements.length, tax_year: year }, 201);
});

api.put("/receipts/:id", async (c) => {
  const input = parseReceiptInput(await c.req.json().catch(() => null));
  if (!input) return jsonError(c, "Belegdaten sind ungueltig");
  const config = await configFor(c.env.DB, input.tax_year);
  if (!config) return jsonError(c, "Fuer dieses Jahr fehlt die Jahreskonfiguration", 422);
  const gwgFlag = input.category === "Arbeitsmittel" && input.amount_cents > config.gwg_limit_cents ? 1 : 0;
  const updatedAt = new Date().toISOString();
  const result = await c.env.DB.prepare(
    `UPDATE receipts SET
      updated_at = ?, status = ?, category = ?, description = ?, amount_cents = ?,
      business_use_pct = ?, expense_date = ?, tax_year = ?, seller_name = ?, seller_address = ?,
      invoice_number = ?, payment_method = ?, notes = ?, gwg_flag = ?
    WHERE id = ? AND owner_email = ? RETURNING *`,
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
    gwgFlag,
    c.req.param("id"),
    c.get("user").email,
  ).first<ReceiptRow>();
  return result ? c.json({ receipt: result }) : jsonError(c, "Beleg nicht gefunden", 404);
});

api.post("/receipts/:id/duplicate", async (c) => {
  const source = await c.env.DB.prepare(
    "SELECT * FROM receipts WHERE id = ? AND owner_email = ?",
  ).bind(c.req.param("id"), c.get("user").email).first<ReceiptRow>();
  if (!source) return jsonError(c, "Beleg nicht gefunden", 404);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  let r2Key: string | null = null;
  if (source.r2_key) {
    const object = await c.env.RECEIPTS.get(source.r2_key);
    if (!object) return jsonError(c, "Originaldatei fehlt", 409);
    r2Key = `receipts/${encodeURIComponent(c.get("user").email)}/${id}`;
    await c.env.RECEIPTS.put(r2Key, object.body, { httpMetadata: object.httpMetadata });
  }
  try {
    await c.env.DB.prepare(
      `INSERT INTO receipts (
        id, created_at, updated_at, owner_email, status, category, description, amount_cents,
        business_use_pct, expense_date, tax_year, seller_name, seller_address, invoice_number,
        payment_method, notes, r2_key, original_filename, mime_type, file_size, gwg_flag
      ) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id, now, now, source.owner_email, source.category, `${source.description.slice(0, 492)} (Kopie)`,
      source.amount_cents, source.business_use_pct, source.expense_date, source.tax_year,
      source.seller_name, source.seller_address, source.invoice_number, source.payment_method,
      source.notes, r2Key, source.original_filename, source.mime_type, source.file_size, source.gwg_flag,
    ).run();
  } catch (error) {
    if (r2Key) await c.env.RECEIPTS.delete(r2Key);
    throw error;
  }
  const receipt = await c.env.DB.prepare("SELECT * FROM receipts WHERE id = ? AND owner_email = ?")
    .bind(id, c.get("user").email).first<ReceiptRow>();
  return c.json({ receipt }, 201);
});

api.delete("/receipts/:id", async (c) => {
  const receipt = await c.env.DB.prepare(
    "SELECT * FROM receipts WHERE id = ? AND owner_email = ?",
  ).bind(c.req.param("id"), c.get("user").email).first<ReceiptRow>();
  if (!receipt) return jsonError(c, "Beleg nicht gefunden", 404);
  await c.env.DB.prepare("DELETE FROM receipts WHERE id = ? AND owner_email = ?")
    .bind(receipt.id, receipt.owner_email).run();
  if (receipt.r2_key) await c.env.RECEIPTS.delete(receipt.r2_key);
  return c.body(null, 204);
});

api.get("/receipts/:id/file", async (c) => {
  const receipt = await c.env.DB.prepare(
    `SELECT r2_key, original_filename, mime_type FROM receipts
     WHERE id = ? AND owner_email = ? AND r2_key IS NOT NULL`,
  ).bind(c.req.param("id"), c.get("user").email).first<Pick<ReceiptRow, "r2_key" | "original_filename" | "mime_type">>();
  if (!receipt?.r2_key) return jsonError(c, "Datei nicht gefunden", 404);
  const object = await c.env.RECEIPTS.get(receipt.r2_key);
  if (!object) return jsonError(c, "Datei nicht gefunden", 404);
  const filename = receipt.original_filename || "beleg";
  return new Response(object.body, {
    headers: {
      "Content-Type": receipt.mime_type || "application/octet-stream",
      "Content-Disposition": `inline; filename="beleg"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "sandbox",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN",
    },
  });
});
