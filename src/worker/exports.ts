import { Hono } from "hono";
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import { CATEGORY, type AppEnv, type ReceiptRow } from "./types";

const PAGE_SIZE: [number, number] = [595.28, 841.89];
const MARGIN = 42;
const TABLE_WIDTH = PAGE_SIZE[0] - MARGIN * 2;
const EMBEDDABLE_IMAGE_TYPES = new Set(["image/jpeg", "image/png"]);

interface Column {
  key: "date" | "description" | "seller" | "order" | "payment" | "use" | "amount" | "deductible";
  label: string;
  width: number;
  align?: "left" | "right";
}

const COLUMNS: Column[] = [
  { key: "date", label: "Date", width: 48 },
  { key: "description", label: "Description", width: 118 },
  { key: "seller", label: "Seller", width: 62 },
  { key: "order", label: "Order #", width: 72 },
  { key: "payment", label: "Payment", width: 58 },
  { key: "use", label: "Use %", width: 26, align: "right" },
  { key: "amount", label: "Amount", width: 58, align: "right" },
  { key: "deductible", label: "Deductible", width: 69, align: "right" },
];

function euro(cents: number): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(cents / 100);
}

function germanDate(value: string): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("de-DE", { timeZone: "UTC" });
}

function pdfText(value: string): string {
  return value.replace(/[^\x20-\x7E -ÿ€]/g, "?");
}

function truncateLine(font: PDFFont, text: string, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let result = text;
  while (result.length > 1 && font.widthOfTextAtSize(`${result}…`, size) > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result}…`;
}

function wrapLines(font: PDFFont, text: string, size: number, maxWidth: number, maxLines: number): string[] {
  const words = pdfText(text).split(/\s+/).filter(Boolean);
  if (!words.length) return ["-"];
  const lines: string[] = [];
  let current = "";
  let index = 0;
  while (index < words.length && lines.length < maxLines) {
    const word = words[index];
    const candidate = current ? `${current} ${word}` : word;
    if (!current || font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
      index++;
    } else {
      lines.push(current);
      current = "";
    }
  }
  if (current) lines.push(current);
  if (index < words.length) {
    const remainder = `${lines[lines.length - 1]} ${words.slice(index).join(" ")}`;
    lines[lines.length - 1] = truncateLine(font, remainder, size, maxWidth);
  }
  return lines.length ? lines : ["-"];
}

async function exportData(db: D1Database, ownerId: string, year: number) {
  const result = await db.prepare(
    "SELECT * FROM receipts WHERE owner_id = ? AND tax_year = ? ORDER BY expense_date, created_at",
  ).bind(ownerId, year).all<ReceiptRow>();
  const receipts = result.results;
  return {
    generated_at: new Date().toISOString(),
    tax_year: year,
    receipts,
    total_cents: receipts.reduce((sum, receipt) => sum + receipt.deductible_cents, 0),
  };
}

async function buildPdf(bucket: R2Bucket, data: Awaited<ReturnType<typeof exportData>>): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const medium = await document.embedFont(StandardFonts.HelveticaBold);
  let page = document.addPage(PAGE_SIZE);
  let y = 798;

  const addPage = () => {
    page = document.addPage(PAGE_SIZE);
    y = 798;
  };
  const line = (value: string, size = 10, isMedium = false, color = rgb(0.15, 0.15, 0.15)) => {
    if (y < 48) addPage();
    page.drawText(pdfText(value).slice(0, 105), {
      x: MARGIN,
      y,
      size,
      font: isMedium ? medium : regular,
      color,
    });
    y -= size + 6;
  };

  const drawTableHeader = () => {
    if (y - 20 < 48) addPage();
    page.drawRectangle({ x: MARGIN, y: y - 15, width: TABLE_WIDTH, height: 18, color: rgb(0.93, 0.93, 0.93) });
    let x = MARGIN + 4;
    for (const column of COLUMNS) {
      const textWidth = medium.widthOfTextAtSize(column.label, 7.5);
      const tx = column.align === "right" ? x + column.width - textWidth - 4 : x;
      page.drawText(column.label, { x: tx, y: y - 10, size: 7.5, font: medium, color: rgb(0.3, 0.3, 0.3) });
      x += column.width;
    }
    y -= 21;
  };

  const drawTableRow = (receipt: ReceiptRow) => {
    const descriptionWidth = COLUMNS[1].width - 8;
    const sellerWidth = COLUMNS[2].width - 8;
    const descriptionLines = wrapLines(regular, receipt.description || "-", 8, descriptionWidth, 2);
    const sellerLines = wrapLines(regular, receipt.seller_name || "-", 8, sellerWidth, 2);
    const BODY_LINE_HEIGHT = 10;
    const NOTE_LINE_HEIGHT = 9;
    const bodyLineCount = Math.max(descriptionLines.length, sellerLines.length, 1);
    const noteLines = receipt.notes.trim() ? wrapLines(regular, receipt.notes, 7, TABLE_WIDTH - 8, 3) : [];
    const rowHeight = BODY_LINE_HEIGHT * (bodyLineCount + 1) + noteLines.length * NOTE_LINE_HEIGHT + 6;

    if (y - rowHeight < 48) {
      addPage();
      drawTableHeader();
    }

    const rowTop = y;
    const cellLines: Record<Column["key"], string[]> = {
      date: [germanDate(receipt.expense_date)],
      description: descriptionLines,
      seller: sellerLines,
      order: [truncateLine(regular, receipt.invoice_number || "-", 7.5, COLUMNS[3].width - 8)],
      payment: [truncateLine(regular, receipt.payment_method || "-", 7.5, COLUMNS[4].width - 8)],
      use: [`${receipt.business_use_pct}%`],
      amount: [euro(receipt.amount_cents)],
      deductible: [euro(receipt.deductible_cents)],
    };

    let x = MARGIN + 4;
    for (const column of COLUMNS) {
      const lines = cellLines[column.key];
      const size = column.key === "date" || column.key === "use" ? 7.5 : 8;
      lines.forEach((text, index) => {
        const baseline = rowTop - BODY_LINE_HEIGHT * (index + 1);
        const textWidth = regular.widthOfTextAtSize(text, size);
        const tx = column.align === "right" ? x + column.width - textWidth - 4 : x;
        page.drawText(text, { x: tx, y: baseline, size, font: regular, color: rgb(0.15, 0.15, 0.15) });
      });
      x += column.width;
    }

    let cursor = rowTop - BODY_LINE_HEIGHT * bodyLineCount;
    for (const noteLine of noteLines) {
      cursor -= NOTE_LINE_HEIGHT;
      page.drawText(noteLine, { x: MARGIN + 4, y: cursor, size: 7, font: regular, color: rgb(0.45, 0.45, 0.45) });
    }
    y = cursor - 6;

    page.drawLine({
      start: { x: MARGIN, y: y + 3 },
      end: { x: PAGE_SIZE[0] - MARGIN, y: y + 3 },
      thickness: 0.5,
      color: rgb(0.88, 0.88, 0.88),
    });
    y -= 5;
  };

  line(`Anlage N - Work equipment expenses ${data.tax_year}`, 20, true);
  line(`Created: ${new Date(data.generated_at).toLocaleString("en-GB")}`, 9, false, rgb(0.4, 0.4, 0.4));
  y -= 10;

  line(CATEGORY, 13, true);
  y -= 2;
  drawTableHeader();
  for (const receipt of data.receipts) drawTableRow(receipt);

  if (y < 60) addPage();
  y -= 4;
  line(`Grand total: ${euro(data.total_cents)}`, 14, true);

  for (const receipt of data.receipts) {
    if (!receipt.r2_key) continue;
    const object = await bucket.get(receipt.r2_key);
    if (!object) continue;
    const bytes = new Uint8Array(await object.arrayBuffer());
    const caption = `${germanDate(receipt.expense_date)}  ·  ${receipt.description || "-"}  ·  ${euro(receipt.deductible_cents)}`;

    if (receipt.mime_type === "application/pdf") {
      try {
        const source = await PDFDocument.load(bytes);
        const copied = await document.copyPages(source, source.getPageIndices());
        copied.forEach((copiedPage: PDFPage, index: number) => {
          document.addPage(copiedPage);
          if (index !== 0) return;
          const { height } = copiedPage.getSize();
          copiedPage.drawText(pdfText(caption).slice(0, 105), {
            x: 8,
            y: height - 14,
            size: 8,
            font: regular,
            color: rgb(0.4, 0.4, 0.4),
          });
        });
      } catch {
        addPage();
        line(caption, 11, true);
        y -= 4;
        line("The original PDF could not be embedded.", 10, false, rgb(0.75, 0.2, 0.08));
      }
    } else if (receipt.mime_type && EMBEDDABLE_IMAGE_TYPES.has(receipt.mime_type)) {
      addPage();
      line(caption, 11, true);
      y -= 4;
      try {
        const image = receipt.mime_type === "image/jpeg"
          ? await document.embedJpg(bytes)
          : await document.embedPng(bytes);
        const maxWidth = TABLE_WIDTH;
        const maxHeight = y - 48;
        const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
        const width = image.width * scale;
        const height = image.height * scale;
        page.drawImage(image, { x: MARGIN, y: y - height, width, height });
        y -= height + 12;
      } catch {
        line("The original image could not be embedded.", 10, false, rgb(0.75, 0.2, 0.08));
      }
    } else {
      addPage();
      line(caption, 11, true);
      y -= 4;
      line(
        `The original file (${receipt.mime_type || "unknown type"}) cannot be embedded in a PDF page; download it from the receipt directly.`,
        10,
        false,
        rgb(0.75, 0.2, 0.08),
      );
    }
  }

  return document.save();
}

export const exportsApi = new Hono<AppEnv>();

exportsApi.get("/:year", async (c) => {
  const year = Number(c.req.param("year"));
  if (!Number.isInteger(year) || year < 2000 || year > 2200) {
    return c.json({ error: "Invalid tax year" }, 400);
  }
  const data = await exportData(c.env.DB, c.get("owner").id, year);
  const bytes = await buildPdf(c.env.RECEIPTS, data);
  return new Response(Uint8Array.from(bytes).buffer, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="anlage-n-${year}.pdf"`,
    },
  });
});
