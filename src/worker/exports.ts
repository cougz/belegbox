import { Hono } from "hono";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { CATEGORY, type AppEnv, type ReceiptRow } from "./types";

const PAGE_SIZE: [number, number] = [595.28, 841.89];
const MARGIN = 42;
const EMBEDDABLE_IMAGE_TYPES = new Set(["image/jpeg", "image/png"]);

function euro(cents: number): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(cents / 100);
}

function pdfText(value: string): string {
  return value.replace(/[^\x20-\x7E -ÿ€]/g, "?");
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

  line(`Anlage N - Work equipment expenses ${data.tax_year}`, 20, true);
  line(`Created: ${new Date(data.generated_at).toLocaleString("en-GB")}`, 9, false, rgb(0.4, 0.4, 0.4));
  y -= 10;

  line(CATEGORY, 13, true);
  for (const receipt of data.receipts) {
    line(`${receipt.expense_date} | ${receipt.description || "-"} | ${receipt.seller_name || "-"} | ${euro(receipt.deductible_cents)}`);
  }
  line(`Total ${CATEGORY}: ${euro(data.total_cents)}`, 10, true);
  y -= 8;
  line(`Grand total: ${euro(data.total_cents)}`, 14, true);

  for (const receipt of data.receipts) {
    if (!receipt.r2_key) continue;
    const object = await bucket.get(receipt.r2_key);
    if (!object) continue;
    const bytes = new Uint8Array(await object.arrayBuffer());
    const caption = `${receipt.expense_date}  ·  ${receipt.description || "-"}  ·  ${euro(receipt.deductible_cents)}`;

    if (receipt.mime_type === "application/pdf") {
      try {
        const source = await PDFDocument.load(bytes);
        const copied = await document.copyPages(source, source.getPageIndices());
        copied.forEach((copiedPage, index) => {
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
        const maxWidth = PAGE_SIZE[0] - MARGIN * 2;
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
