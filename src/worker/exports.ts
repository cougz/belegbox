import { Zip, ZipPassThrough } from "fflate";
import { Hono } from "hono";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { CATEGORY, type AppEnv, type ReceiptRow, type TaxYearConfig } from "./types";

function euro(cents: number): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(cents / 100);
}

function safeText(value: string, fallback = "unknown"): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/(?:^[-.]|[-.]$)/g, "")
    .slice(0, 80);
  return normalized || fallback;
}

function extension(receipt: ReceiptRow): string {
  const byMime: Record<string, string> = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif",
    "image/heic": "heic",
  };
  return byMime[receipt.mime_type ?? ""] ?? "bin";
}

function exportFilename(receipt: ReceiptRow): string {
  const amount = (receipt.amount_cents / 100).toFixed(2).replace(".", ",");
  return [
    "Aufwendungen-fuer-Arbeitsmittel",
    receipt.expense_date,
    safeText(receipt.seller_name),
    `${amount}EUR`,
  ].join("_") + `.${extension(receipt)}`;
}

function claimable(receipt: ReceiptRow): number {
  return receipt.gwg_flag ? 0 : receipt.deductible_cents;
}

async function exportData(db: D1Database, ownerId: string, year: number) {
  const [receiptResult, config] = await Promise.all([
    db.prepare(
      "SELECT * FROM receipts WHERE owner_id = ? AND tax_year = ? ORDER BY expense_date, created_at",
    ).bind(ownerId, year).all<ReceiptRow>(),
    db.prepare("SELECT * FROM tax_year_config WHERE owner_id = ? AND tax_year = ?")
      .bind(ownerId, year).first<TaxYearConfig>(),
  ]);
  if (!config) return null;
  const receipts = receiptResult.results.map((receipt): ReceiptRow => ({
    ...receipt,
    gwg_flag: receipt.amount_cents > config.gwg_limit_cents ? 1 : 0,
  }));
  const { owner_id: _ownerId, ...publicConfig } = config;
  const categories = [{
    category: CATEGORY,
    total_cents: receipts.reduce((sum, item) => sum + claimable(item), 0),
    items: receipts.map((receipt) => {
      const {
        r2_key: _r2Key,
        owner_id: _ownerId,
        owner_email: _ownerEmail,
        ...item
      } = receipt;
      return {
        ...item,
        claimable_cents: claimable(receipt),
        warning: receipt.gwg_flag
          ? "Above the immediate write-off threshold: excluded from the total; review for depreciation."
          : null,
      };
    }),
  }];
  return {
    schema: "belegbox-export-v1",
    generated_at: new Date().toISOString(),
    tax_year: year,
    config: publicConfig,
    categories,
    grand_total_cents: categories.reduce((sum, category) => sum + category.total_cents, 0),
    receipts,
  };
}

function csvCell(value: unknown): string {
  let cell = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
  return `"${cell.replace(/"/g, '""')}"`;
}

function csv(data: NonNullable<Awaited<ReturnType<typeof exportData>>>): string {
  const header = [
    "id", "category", "description", "amount_cents", "business_use_pct", "deductible_cents",
    "claimable_cents", "expense_date", "tax_year", "seller_name", "seller_address",
    "invoice_number", "payment_method", "notes", "original_filename", "mime_type", "file_size",
    "status", "gwg_flag",
  ];
  const rows = data.receipts.map((receipt) => [
    receipt.id,
    receipt.category,
    receipt.description,
    receipt.amount_cents,
    receipt.business_use_pct,
    receipt.deductible_cents,
    claimable(receipt),
    receipt.expense_date,
    receipt.tax_year,
    receipt.seller_name,
    receipt.seller_address,
    receipt.invoice_number,
    receipt.payment_method,
    receipt.notes,
    receipt.original_filename,
    receipt.mime_type,
    receipt.file_size,
    receipt.status,
    receipt.gwg_flag,
  ]);
  return `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function pdfText(value: string): string {
  return value.replace(/[^\x20-\x7E\u00A0-\u00FF\u20AC]/g, "?");
}

async function pdf(data: NonNullable<Awaited<ReturnType<typeof exportData>>>) {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const medium = await document.embedFont(StandardFonts.HelveticaBold);
  let page = document.addPage([595.28, 841.89]);
  let y = 798;

  const addPage = () => {
    page = document.addPage([595.28, 841.89]);
    y = 798;
  };
  const line = (value: string, size = 10, isMedium = false, color = rgb(0.15, 0.15, 0.15)) => {
    if (y < 48) addPage();
    page.drawText(pdfText(value).slice(0, 105), {
      x: 42,
      y,
      size,
      font: isMedium ? medium : regular,
      color,
    });
    y -= size + 6;
  };

  line(`Anlage N - Work equipment expenses ${data.tax_year}`, 20, true);
  line(`Created: ${new Date(data.generated_at).toLocaleString("en-GB")}`, 9, false, rgb(0.4, 0.4, 0.4));
  line("Items above the immediate write-off threshold are excluded from totals.", 9, false, rgb(0.75, 0.2, 0.08));
  y -= 10;

  for (const group of data.categories) {
    if (!group.items.length) continue;
    line(group.category, 13, true);
    for (const item of group.items) {
      const warning = item.gwg_flag ? " [Review for depreciation; EUR 0 in total]" : "";
      line(`${item.expense_date} | ${item.description} | ${item.seller_name || "-"} | ${euro(item.claimable_cents)}${warning}`);
    }
    line(`Total ${group.category}: ${euro(group.total_cents)}`, 10, true);
    y -= 8;
  }
  line(`Grand total: ${euro(data.grand_total_cents)}`, 14, true);
  y -= 8;
  line(`Immediate write-off threshold (GWG): ${euro(data.config.gwg_limit_cents)}.`, 9);
  line("Handoff only; no automated submission to ELSTER, Germany's online tax portal, or tax advice.", 9, false, rgb(0.4, 0.4, 0.4));
  return document.save();
}

function zipStream(bucket: R2Bucket, receipts: ReceiptRow[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const zip = new Zip((error, chunk, final) => {
        if (error) {
          controller.error(error);
          return;
        }
        if (chunk.length) controller.enqueue(chunk);
        if (final) controller.close();
      });

      void (async () => {
        const names = new Map<string, number>();
        for (const receipt of receipts) {
          if (!receipt.r2_key) continue;
          const object = await bucket.get(receipt.r2_key);
          if (!object) throw new Error(`Missing R2 object for receipt ${receipt.id}`);
          const baseName = exportFilename(receipt);
          const count = (names.get(baseName) ?? 0) + 1;
          names.set(baseName, count);
          const dot = baseName.lastIndexOf(".");
          const name = count === 1
            ? baseName
            : `${baseName.slice(0, dot)}_${count}${baseName.slice(dot)}`;
          const entry = new ZipPassThrough(name);
          zip.add(entry);
          const reader = object.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            entry.push(value, false);
          }
          entry.push(new Uint8Array(), true);
        }
        zip.end();
      })().catch((error) => controller.error(error));
    },
  });
}

export const exportsApi = new Hono<AppEnv>();

exportsApi.get("/:year/:format", async (c) => {
  const year = Number(c.req.param("year"));
  const format = c.req.param("format");
  if (!Number.isInteger(year) || year < 2000 || year > 2200) {
    return c.json({ error: "Invalid tax year" }, 400);
  }
  const data = await exportData(c.env.DB, c.get("owner").id, year);
  if (!data) return c.json({ error: "Year settings are missing" }, 422);
  const headers = { "Cache-Control": "private, no-store" };

  if (format === "json") {
    return new Response(JSON.stringify({
      schema: data.schema,
      generated_at: data.generated_at,
      tax_year: data.tax_year,
      config: data.config,
      categories: data.categories,
      grand_total_cents: data.grand_total_cents,
    }, null, 2), {
      headers: {
        ...headers,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="anlage-n-${year}.json"`,
      },
    });
  }
  if (format === "csv") {
    return new Response(csv(data), {
      headers: {
        ...headers,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="anlage-n-${year}.csv"`,
      },
    });
  }
  if (format === "pdf") {
    return new Response(Uint8Array.from(await pdf(data)).buffer, {
      headers: {
        ...headers,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="anlage-n-${year}.pdf"`,
      },
    });
  }
  if (format === "zip") {
    return new Response(zipStream(c.env.RECEIPTS, data.receipts), {
      headers: {
        ...headers,
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="belege-${year}.zip"`,
      },
    });
  }
  return c.json({ error: "Export format not found" }, 404);
});
