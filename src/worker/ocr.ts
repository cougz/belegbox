import type { Bindings } from "./types";

const MODEL = "@cf/moondream/moondream3.1-9B-A2B";
const MAX_AI_FILE_SIZE = 5 * 1024 * 1024;
const SUPPORTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export interface ReceiptSuggestions {
  seller_name?: string;
  seller_address?: string;
  invoice_number?: string;
  expense_date?: string;
  amount_cents?: number;
  payment_method?: string;
  description?: string;
}

export interface AiPrefillResult {
  status: "ready" | "disabled" | "unsupported" | "too_large" | "no_fields" | "error";
  suggestions: ReceiptSuggestions | null;
  model?: string;
}

function cleanText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim();
  return cleaned && cleaned.length <= maxLength ? cleaned : undefined;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function normalizeDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (validDate(trimmed)) return trimmed;
  const german = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(trimmed);
  if (!german) return undefined;
  const normalized = `${german[3]}-${german[2].padStart(2, "0")}-${german[1].padStart(2, "0")}`;
  return validDate(normalized) ? normalized : undefined;
}

function normalizeCents(value: unknown): number | undefined {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return undefined;
    return Number.isSafeInteger(value) ? value : Math.round(value * 100);
  }
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const cents = Number(trimmed);
    return Number.isSafeInteger(cents) ? cents : undefined;
  }
  const numeric = trimmed.replace(/EUR|€/gi, "").replace(/\s/g, "");
  const comma = numeric.lastIndexOf(",");
  const dot = numeric.lastIndexOf(".");
  let normalized = numeric;
  if (comma >= 0 && dot >= 0) {
    normalized = comma > dot
      ? numeric.replace(/\./g, "").replace(",", ".")
      : numeric.replace(/,/g, "");
  } else if (comma >= 0) {
    normalized = numeric.replace(",", ".");
  }
  if (!/^\d+\.\d{1,2}$/.test(normalized)) return undefined;
  const euros = Number(normalized);
  return Number.isFinite(euros) ? Math.round(euros * 100) : undefined;
}

function responseText(response: unknown): string | null {
  if (typeof response === "string") return response;
  if (!response || typeof response !== "object") return null;
  const result = response as { answer?: unknown; response?: unknown; result?: unknown };
  if (typeof result.answer === "string") return result.answer;
  if (typeof result.response === "string") return result.response;
  return result.result === response ? null : responseText(result.result);
}

function jsonObject(raw: string): Record<string, unknown> | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw)?.[1];
  const candidate = fenced ?? raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  if (!candidate) return null;
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function parseReceiptSuggestions(response: unknown): ReceiptSuggestions | null {
  const raw = responseText(response);
  const parsed = raw ? jsonObject(raw) : null;
  if (!parsed) return null;

  const suggestions: ReceiptSuggestions = {
    seller_name: cleanText(parsed.seller_name, 300),
    seller_address: cleanText(parsed.seller_address, 1000),
    invoice_number: cleanText(parsed.invoice_number, 200),
    expense_date: normalizeDate(parsed.expense_date),
    amount_cents: normalizeCents(parsed.amount_cents),
    payment_method: cleanText(parsed.payment_method, 100),
    description: cleanText(parsed.description, 500),
  };
  for (const key of Object.keys(suggestions) as Array<keyof ReceiptSuggestions>) {
    if (suggestions[key] === undefined) delete suggestions[key];
  }
  return Object.keys(suggestions).length ? suggestions : null;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

export async function extractReceiptSuggestions(
  env: Bindings,
  file: File,
  mimeType: string,
): Promise<AiPrefillResult> {
  if (env.AI_PREFILL_ENABLED !== "true") return { status: "disabled", suggestions: null };
  if (!SUPPORTED_TYPES.has(mimeType)) return { status: "unsupported", suggestions: null };
  if (file.size > MAX_AI_FILE_SIZE) return { status: "too_large", suggestions: null };

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const image = `data:${mimeType};base64,${toBase64(bytes)}`;
    const result = await env.AI.run(MODEL, {
      task: "query",
      image,
      question:
        "Extract fields from this German purchase receipt. Return exactly one JSON object and no prose. " +
        "Use null when a field is not clearly visible. Return these exact keys: " +
        '{"seller_name":null,"seller_address":null,"invoice_number":null,' +
        '"expense_date":null,"amount_cents":null,"payment_method":null,"description":null}. ' +
        "Format expense_date as YYYY-MM-DD. amount_cents must be the final gross total as an integer number of euro cents. " +
        "description is the purchased work item, not a generic receipt label.",
      reasoning: false,
      temperature: 0,
      max_tokens: 512,
      stream: false,
    });
    const suggestions = parseReceiptSuggestions(result);
    return suggestions
      ? { status: "ready", suggestions, model: MODEL }
      : { status: "no_fields", suggestions: null, model: MODEL };
  } catch (error) {
    console.error("AI OCR failed", error instanceof Error ? error.message : "Unknown provider error");
    return { status: "error", suggestions: null, model: MODEL };
  }
}
