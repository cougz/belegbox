import { StrictMode, useEffect, useState, type DragEvent, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const CATEGORY = "Aufwendungen für Arbeitsmittel" as const;

type Category = typeof CATEGORY;

interface Receipt {
  id: string;
  created_at: string;
  updated_at: string;
  owner_email: string;
  status: "draft" | "complete";
  category: Category;
  description: string;
  amount_cents: number;
  business_use_pct: number;
  deductible_cents: number;
  expense_date: string;
  tax_year: number;
  seller_name: string;
  seller_address: string;
  invoice_number: string;
  payment_method: string;
  notes: string;
  has_file: boolean;
  original_filename: string | null;
  mime_type: string | null;
  file_size: number | null;
  gwg_flag: 0 | 1;
}

interface YearConfig {
  tax_year: number;
  gwg_limit_cents: number;
  updated_at: string;
}

interface Suggestions {
  seller_name?: string;
  seller_address?: string;
  invoice_number?: string;
  expense_date?: string;
  amount_cents?: number;
  payment_method?: string;
  description?: string;
}

interface AiPrefillInfo {
  status: "ready" | "disabled" | "unsupported" | "too_large" | "no_fields" | "error";
  model?: string;
  fieldCount: number;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "Request failed" })) as { error?: string };
    throw new Error(body.error || `Request failed (HTTP ${response.status})`);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

function money(cents: number): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(cents / 100);
}

function applySuggestions(receipt: Receipt, suggestions: Suggestions | null): Receipt {
  if (!suggestions) return receipt;
  const expenseDate = suggestions.expense_date || receipt.expense_date;
  return {
    ...receipt,
    seller_name: suggestions.seller_name || receipt.seller_name,
    seller_address: suggestions.seller_address || receipt.seller_address,
    invoice_number: suggestions.invoice_number || receipt.invoice_number,
    expense_date: expenseDate,
    tax_year: Number(expenseDate.slice(0, 4)),
    amount_cents: suggestions.amount_cents ?? receipt.amount_cents,
    payment_method: suggestions.payment_method || receipt.payment_method,
    description: suggestions.description || receipt.description,
  };
}

function ReceiptEditor({
  receipt,
  onClose,
  onSaved,
  onDelete,
  onDuplicate,
  aiPrefill,
}: {
  receipt: Receipt;
  onClose: () => void;
  onSaved: (receipt: Receipt) => void;
  onDelete: (receipt: Receipt) => void;
  onDuplicate: (receipt: Receipt) => void;
  aiPrefill: AiPrefillInfo | null;
}) {
  const [draft, setDraft] = useState(receipt);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => setDraft(receipt), [receipt]);

  const set = <K extends keyof Receipt>(key: K, value: Receipt[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const body = {
        status: draft.status,
        category: CATEGORY,
        description: draft.description,
        amount_cents: draft.amount_cents,
        business_use_pct: draft.business_use_pct,
        expense_date: draft.expense_date,
        tax_year: draft.tax_year,
        seller_name: draft.seller_name,
        seller_address: draft.seller_address,
        invoice_number: draft.invoice_number,
        payment_method: draft.payment_method,
        notes: draft.notes,
      };
      const result = await request<{ receipt: Receipt }>(`/api/receipts/${draft.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setDraft(result.receipt);
      onSaved(result.receipt);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the receipt");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="editor-shell" role="dialog" aria-modal="true" aria-label="Edit receipt">
      <section className={`viewer-panel ${draft.has_file ? "" : "no-file"}`}>
        <div className="panel-head">
          <div>
            <span className="eyebrow">// ORIGINAL</span>
            <h2>{draft.original_filename || "No file"}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close">×</button>
        </div>
        {draft.has_file ? (
          draft.mime_type?.startsWith("image/") ? (
            <img className="receipt-image" src={`/api/receipts/${draft.id}/file`} alt="Receipt preview" />
          ) : (
            <iframe className="receipt-pdf" src={`/api/receipts/${draft.id}/file`} title="PDF receipt preview" />
          )
        ) : (
          <div className="empty-viewer">Manual entry without an original file</div>
        )}
      </section>

      <form className="editor-form" onSubmit={save}>
        <div className="panel-head sticky-head">
          <div>
            <span className="eyebrow">// OFFICIAL GERMAN TAX FORM FIELD</span>
            <h2>Receipt details</h2>
          </div>
          <span className={`tag ${draft.status === "complete" ? "tag-complete" : ""}`}>
            {draft.status === "complete" ? "Complete" : "Draft"}
          </span>
        </div>

        {error && <p className="notice notice-error" role="alert">{error}</p>}
        {aiPrefill?.status === "ready" && (
          <p className="notice notice-ai" role="status">
            AI text recognition (OCR) filled {aiPrefill.fieldCount} editable {aiPrefill.fieldCount === 1 ? "field" : "fields"}.
            Review the values before saving; no suggestion has been committed yet.
          </p>
        )}
        {aiPrefill && aiPrefill.status !== "ready" && (
          <p className="notice notice-warning" role="status">
            {aiPrefill.status === "no_fields" && "AI text recognition could not confidently identify receipt fields. Enter them manually."}
            {aiPrefill.status === "unsupported" && "AI text recognition currently supports PNG, JPEG, and WebP images. Enter this file manually."}
            {aiPrefill.status === "too_large" && "This image is too large for AI text recognition. Enter its fields manually."}
            {aiPrefill.status === "error" && "AI text recognition failed. The original is stored safely; enter its fields manually."}
            {aiPrefill.status === "disabled" && "AI text recognition is disabled. Enter the receipt fields manually."}
          </p>
        )}
        {draft.gwg_flag === 1 && (
          <p className="notice notice-warning">
            This amount exceeds the year&apos;s immediate write-off threshold. The receipt is excluded
            from the deductible total and must be reviewed separately for depreciation.
          </p>
        )}

        <div className="form-grid">
          <div className="official-field span-2">
            <span>Official German tax form field</span>
            <strong>{CATEGORY}</strong>
          </div>
          <label className="field span-2">
            <span>Description / type of work item</span>
            <input required maxLength={500} value={draft.description} onChange={(event) => set("description", event.target.value)} />
          </label>
          <label className="field">
            <span>Amount (EUR)</span>
            <input
              required
              type="number"
              min="0"
              max="9999999.99"
              step="0.01"
              value={(draft.amount_cents / 100).toFixed(2)}
              onChange={(event) => set("amount_cents", Math.max(0, Math.round(Number(event.target.value) * 100)))}
            />
          </label>
          <label className="field">
            <span>Business use (%)</span>
            <input
              required
              type="number"
              min="0"
              max="100"
              step="1"
              value={draft.business_use_pct}
              onChange={(event) => set("business_use_pct", Number(event.target.value))}
            />
          </label>
          <div className="calculated span-2">
            <span>Calculated deductible amount</span>
            <strong>{money(Math.round(draft.amount_cents * draft.business_use_pct / 100))}</strong>
            <small>{draft.gwg_flag ? "Excluded from totals; review for depreciation" : "Included in the ledger total"}</small>
          </div>
          <label className="field">
            <span>Receipt date</span>
            <input
              required
              type="date"
              value={draft.expense_date}
              onChange={(event) => {
                setDraft((current) => ({
                  ...current,
                  expense_date: event.target.value,
                  tax_year: Number(event.target.value.slice(0, 4)),
                }));
              }}
            />
          </label>
          <label className="field">
            <span>Tax year</span>
            <input readOnly value={draft.tax_year} />
          </label>
          <label className="field span-2">
            <span>Seller / vendor</span>
            <input maxLength={300} value={draft.seller_name} onChange={(event) => set("seller_name", event.target.value)} />
          </label>
          <label className="field span-2">
            <span>Seller address</span>
            <textarea rows={2} maxLength={1000} value={draft.seller_address} onChange={(event) => set("seller_address", event.target.value)} />
          </label>
          <label className="field">
            <span>Invoice number</span>
            <input maxLength={200} value={draft.invoice_number} onChange={(event) => set("invoice_number", event.target.value)} />
          </label>
          <label className="field">
            <span>Payment method</span>
            <input maxLength={100} value={draft.payment_method} onChange={(event) => set("payment_method", event.target.value)} placeholder="Card, bank transfer, cash" />
          </label>
          <label className="field span-2">
            <span>Notes</span>
            <textarea rows={4} maxLength={5000} value={draft.notes} onChange={(event) => set("notes", event.target.value)} />
          </label>
          <label className="field span-2">
            <span>Status</span>
            <select value={draft.status} onChange={(event) => set("status", event.target.value as Receipt["status"])}>
              <option value="draft">Draft</option>
              <option value="complete">Complete</option>
            </select>
          </label>
        </div>

        <div className="editor-actions">
          <button className="button button-primary" disabled={saving} type="submit">
            {saving ? "Saving..." : "Save receipt"}
          </button>
          <button className="button button-ghost" type="button" onClick={() => onDuplicate(draft)}>Duplicate</button>
          <button className="button button-danger" type="button" onClick={() => onDelete(draft)}>Delete</button>
        </div>
        <p className="owner-line">Record owner: {draft.owner_email}</p>
      </form>
    </div>
  );
}

function ManualEntry({
  year,
  onClose,
  onCreated,
}: {
  year: number;
  onClose: () => void;
  onCreated: (receipt: Receipt) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [draft, setDraft] = useState({
    description: "",
    amount: "",
    expense_date: Number(today.slice(0, 4)) === year ? today : "",
    seller_name: "",
    business_use_pct: 100,
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, saving]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const amountCents = Math.round(Number(draft.amount) * 100);
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const result = await request<{ receipt: Receipt }>("/api/receipts/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: draft.description,
          amount_cents: amountCents,
          business_use_pct: draft.business_use_pct,
          expense_date: draft.expense_date,
          seller_name: draft.seller_name,
          notes: draft.notes,
        }),
      });
      onCreated(result.receipt);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not add the receipt");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="manual-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section className="manual-card" role="dialog" aria-modal="true" aria-labelledby="manual-title">
        <div className="manual-head">
          <div>
            <span className="eyebrow">// QUICK ENTRY</span>
            <h2 id="manual-title">Add a receipt</h2>
            <p>Just the essentials. You can add invoice details later.</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} disabled={saving} aria-label="Close">×</button>
        </div>

        <form className="manual-form" onSubmit={save}>
          {error && <p className="notice notice-error" role="alert">{error}</p>}
          <div className="form-grid">
            <label className="field span-2 manual-description">
              <span>What did you buy?</span>
              <input
                autoFocus
                required
                maxLength={500}
                value={draft.description}
                onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                placeholder="e.g. Monitor arm"
              />
            </label>
            <label className="field">
              <span>How much?</span>
              <div className="money-input">
                <span aria-hidden="true">€</span>
                <input
                  required
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  max="9999999.99"
                  step="0.01"
                  value={draft.amount}
                  onChange={(event) => setDraft((current) => ({ ...current, amount: event.target.value }))}
                  placeholder="0.00"
                  aria-label="Amount in euros"
                />
              </div>
            </label>
            <label className="field">
              <span>When?</span>
              <input
                required
                type="date"
                value={draft.expense_date}
                onChange={(event) => setDraft((current) => ({ ...current, expense_date: event.target.value }))}
              />
            </label>
            <label className="field span-2">
              <span>Where did you buy it? <em>Optional</em></span>
              <input
                maxLength={300}
                value={draft.seller_name}
                onChange={(event) => setDraft((current) => ({ ...current, seller_name: event.target.value }))}
                placeholder="Shop or seller"
              />
            </label>
          </div>

          <details className="manual-more">
            <summary>
              <span>Work use and notes</span>
              <small>{draft.business_use_pct}% work use</small>
            </summary>
            <div className="manual-more-fields">
              <label className="field">
                <span>Work use (%)</span>
                <input
                  required
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={draft.business_use_pct}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    business_use_pct: Number(event.target.value),
                  }))}
                />
                <small className="field-help">Leave at 100% when the item is only used for work.</small>
              </label>
              <label className="field">
                <span>Notes <em>Optional</em></span>
                <textarea
                  rows={3}
                  maxLength={5000}
                  value={draft.notes}
                  onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
                />
              </label>
            </div>
          </details>

          <div className="manual-actions">
            <span>Filed under {CATEGORY}</span>
            <div>
              <button className="button button-ghost" type="button" onClick={onClose} disabled={saving}>Cancel</button>
              <button className="button button-primary" type="submit" disabled={saving}>
                {saving ? "Adding..." : "Add receipt"}
              </button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}

function YearSettings({ config, onSaved }: { config: YearConfig; onSaved: (config: YearConfig) => void }) {
  const [draft, setDraft] = useState(config);
  const [message, setMessage] = useState("");
  useEffect(() => setDraft(config), [config]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setMessage("");
    try {
      const result = await request<{ config: YearConfig }>(`/api/config/${draft.tax_year}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      onSaved(result.config);
      setMessage("Year settings saved.");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Could not save year settings");
    }
  };

  return (
    <details className="settings-card">
      <summary>Year settings {config.tax_year}</summary>
      <form className="settings-grid" onSubmit={save}>
        <label className="field compact-field">
          <span>Immediate write-off threshold (GWG)</span>
          <input
            aria-describedby="gwg-explanation"
            type="number"
            min="0"
            step="0.01"
            value={(draft.gwg_limit_cents / 100).toFixed(2)}
            onChange={(event) => setDraft((current) => ({
              ...current,
              gwg_limit_cents: Math.max(0, Math.round(Number(event.target.value) * 100)),
            }))}
          />
          <small className="field-help" id="gwg-explanation">
            GWG means the low-value asset immediate-write-off threshold. Amount in EUR.
          </small>
        </label>
        <button className="button button-ghost" type="submit">Save settings</button>
        {message && <span className="settings-message" role="status">{message}</span>}
      </form>
    </details>
  );
}

function App() {
  const currentYear = new Date().getFullYear();
  const [email, setEmail] = useState("");
  const [configs, setConfigs] = useState<YearConfig[]>([]);
  const [year, setYear] = useState(currentYear);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [selected, setSelected] = useState<Receipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [aiPrefill, setAiPrefill] = useState<AiPrefillInfo | null>(null);
  const [manualOpen, setManualOpen] = useState(false);

  const loadReceipts = async (targetYear: number) => {
    const result = await request<{ receipts: Receipt[] }>(`/api/receipts?tax_year=${targetYear}`);
    setReceipts(result.receipts);
  };

  useEffect(() => {
    void Promise.all([
      request<{ email: string }>("/api/session"),
      request<{ config: YearConfig[] }>("/api/config"),
      request<{ receipts: Receipt[] }>(`/api/receipts?tax_year=${currentYear}`),
    ]).then(([session, configResult, receiptResult]) => {
      setEmail(session.email);
      setConfigs(configResult.config);
      setReceipts(receiptResult.receipts);
    }).catch((reason) => {
      setError(reason instanceof Error ? reason.message : "Could not load the app");
    }).finally(() => setLoading(false));
  }, [currentYear]);

  const chooseYear = async (targetYear: number) => {
    setYear(targetYear);
    setLoading(true);
    setError("");
    try {
      await loadReceipts(targetYear);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load receipts");
    } finally {
      setLoading(false);
    }
  };

  const upload = async (file: File) => {
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.set("file", file);
      const result = await request<{
        receipt: Receipt;
        suggestions: Suggestions | null;
        ai_prefill: Omit<AiPrefillInfo, "fieldCount">;
      }>("/api/receipts/upload", {
        method: "POST",
        body: form,
      });
      const receipt = applySuggestions(result.receipt, result.suggestions);
      setAiPrefill({
        ...result.ai_prefill,
        fieldCount: Object.keys(result.suggestions ?? {}).length,
      });
      if (receipt.tax_year !== year) setYear(receipt.tax_year);
      await loadReceipts(receipt.tax_year);
      setSelected(receipt);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not upload the receipt");
    } finally {
      setUploading(false);
      setDragging(false);
    }
  };

  const importBackup = async (file: File) => {
    setError("");
    try {
      const backup = JSON.parse(await file.text()) as { tax_year?: number };
      const result = await request<{ imported: number; tax_year: number }>("/api/import/json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(backup),
      });
      setYear(result.tax_year);
      await loadReceipts(result.tax_year);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not import the backup");
    }
  };

  const createYearConfig = async () => {
    const source = configs.toSorted((a, b) => b.tax_year - a.tax_year)[0];
    if (!source) {
      setError("There are no existing year settings to copy.");
      return;
    }
    setError("");
    try {
      const result = await request<{ config: YearConfig }>(`/api/config/${year}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gwg_limit_cents: source.gwg_limit_cents,
        }),
      });
      setConfigs((values) => [...values, result.config].toSorted((a, b) => b.tax_year - a.tax_year));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create year settings");
    }
  };

  const deleteReceipt = async (receipt: Receipt) => {
    if (!window.confirm(`Permanently delete receipt "${receipt.description}"?`)) return;
    try {
      await request<void>(`/api/receipts/${receipt.id}`, { method: "DELETE" });
      setSelected(null);
      await loadReceipts(year);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not delete the receipt");
    }
  };

  const duplicateReceipt = async (receipt: Receipt) => {
    try {
      const result = await request<{ receipt: Receipt }>(`/api/receipts/${receipt.id}/duplicate`, { method: "POST" });
      await loadReceipts(year);
      setAiPrefill(null);
      setSelected(result.receipt);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not duplicate the receipt");
    }
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) void upload(file);
  };

  const total = receipts.reduce((sum, receipt) => sum + (receipt.gwg_flag ? 0 : receipt.deductible_cents), 0);
  const selectedConfig = configs.find((config) => config.tax_year === year);

  return (
    <>
      <header className="app-nav">
        <div className="nav-inner">
          <a className="brand" href="/">belegbox</a>
          <div className="nav-meta">
            <span className="auth-dot" aria-hidden="true" />
            <span className="email">{email || "Authenticated"}</span>
          </div>
        </div>
      </header>

      <main className="app-main">
        <section className="toolbar">
          <div>
            <span className="eyebrow">// WORK EQUIPMENT · OFFICIAL TAX RECORD</span>
            <h1>Work equipment receipt ledger</h1>
          </div>
          <div className="toolbar-actions">
            <label className="year-select">
              <span>Tax year</span>
              <select value={year} onChange={(event) => void chooseYear(Number(event.target.value))}>
                {Array.from(new Set([year, currentYear, ...configs.map((config) => config.tax_year)]))
                  .sort((a, b) => b - a)
                  .map((value) => <option key={value}>{value}</option>)}
              </select>
            </label>
            <button className="button button-ghost" type="button" onClick={() => setManualOpen(true)}>Add manually</button>
            <label className="button button-ghost file-button">
              Import JSON
              <input
                type="file"
                accept="application/json,.json"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importBackup(file);
                  event.target.value = "";
                }}
              />
            </label>
            <label className="button button-primary file-button">
              {uploading ? "Uploading..." : "Upload receipt"}
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic"
                disabled={uploading}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void upload(file);
                  event.target.value = "";
                }}
              />
            </label>
          </div>
        </section>

        {error && <p className="notice notice-error" role="alert">{error}</p>}

        <section className="summary-grid">
          <article className="stat-card total-card">
            <span>Total deductible amount</span>
            <strong>{money(total)}</strong>
            <small>
              {receipts.length} {receipts.length === 1 ? "receipt" : "receipts"} · Items requiring depreciation review excluded
            </small>
          </article>
          <article className="stat-card">
            <span>Complete</span>
            <strong>{receipts.filter((receipt) => receipt.status === "complete").length}</strong>
            <small>{receipts.filter((receipt) => receipt.status === "draft").length} drafts open</small>
          </article>
          <article className="stat-card warning-card">
            <span>Depreciation review</span>
            <strong>{receipts.filter((receipt) => receipt.gwg_flag).length}</strong>
            <small>Excluded from the total deductible amount</small>
          </article>
          <article className="stat-card data-card">
            <span>Exports {year}</span>
            <div className="export-links">
              {(["zip", "pdf", "csv", "json"] as const).map((format) => (
                <a key={format} href={`/api/exports/${year}/${format}`}>{format.toUpperCase()}</a>
              ))}
            </div>
            <small>For tax filing and backup</small>
          </article>
        </section>

        <label
          className={`drop-zone ${dragging ? "is-dragging" : ""}`}
          onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
          }}
          onDrop={onDrop}
        >
          <input
            className="drop-input"
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic"
            disabled={uploading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
              event.target.value = "";
            }}
          />
          <span className="drop-mark">+</span>
          <div><strong>Drop a PDF or image here, or click to browse</strong><small>The original stays in private object storage · maximum 20 MB</small></div>
        </label>

        {selectedConfig ? (
          <YearSettings
            config={selectedConfig}
            onSaved={(updated) => {
              setConfigs((values) => values.map((value) => value.tax_year === updated.tax_year ? updated : value));
              void loadReceipts(year);
            }}
          />
        ) : (
          <section className="missing-config">
            <div>
              <strong>Year settings for {year} are missing</strong>
              <small>Copy last year&apos;s immediate write-off threshold and review it before use.</small>
            </div>
            <button className="button button-ghost" type="button" onClick={() => void createYearConfig()}>
              Create year
            </button>
          </section>
        )}

        <section className="ledger" aria-busy={loading}>
          <div className="ledger-head">
            <div>
              <span className="eyebrow">// OFFICIAL GERMAN TAX FORM FIELD · {year}</span>
              <h2>{CATEGORY}</h2>
            </div>
            <div className="ledger-total">
              <span>{receipts.length} {receipts.length === 1 ? "receipt" : "receipts"}</span>
              <strong>{money(total)}</strong>
            </div>
          </div>

          {!loading && !receipts.length && (
            <div className="empty-state">
              <h3>No receipts for {year}</h3>
              <p>Upload an original or add a receipt manually.</p>
            </div>
          )}

          {!!receipts.length && (
            <div className="receipt-table" role="table">
              {receipts.map((receipt) => (
                <button
                  className="receipt-row"
                  type="button"
                  role="row"
                  key={receipt.id}
                  onClick={() => {
                    setAiPrefill(null);
                    setSelected(receipt);
                  }}
                >
                  <span className="date-cell">{new Date(`${receipt.expense_date}T00:00:00`).toLocaleDateString("en-GB")}</span>
                  <span className="description-cell">
                    <strong>{receipt.description || "No description"}</strong>
                    <small>{receipt.seller_name || receipt.original_filename || "Manual entry"}</small>
                  </span>
                  <span className="status-cell">
                    {receipt.gwg_flag ? <span className="tag tag-warning">Review depreciation</span> : (
                      <span className={`tag ${receipt.status === "complete" ? "tag-complete" : ""}`}>
                        {receipt.status === "complete" ? "Complete" : "Draft"}
                      </span>
                    )}
                  </span>
                  <span className="amount-cell">
                    <strong>{money(receipt.gwg_flag ? 0 : receipt.deductible_cents)}</strong>
                    <small>of {money(receipt.amount_cents)}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      </main>

      <footer className="app-footer">
        <span>belegbox · private receipt archive</span>
        <span>No direct tax-filing integration, automated submission, or tax advice.</span>
      </footer>

      {selected && (
        <ReceiptEditor
          receipt={selected}
          aiPrefill={aiPrefill}
          onClose={() => {
            setAiPrefill(null);
            setSelected(null);
          }}
          onSaved={(saved) => {
            setSelected(saved);
            if (saved.tax_year !== year) {
              setYear(saved.tax_year);
              void loadReceipts(saved.tax_year);
            } else {
              setReceipts((values) => values.map((value) => value.id === saved.id ? saved : value));
            }
          }}
          onDelete={(receipt) => void deleteReceipt(receipt)}
          onDuplicate={(receipt) => void duplicateReceipt(receipt)}
        />
      )}

      {manualOpen && (
        <ManualEntry
          year={year}
          onClose={() => setManualOpen(false)}
          onCreated={(receipt) => {
            setManualOpen(false);
            setYear(receipt.tax_year);
            if (receipt.tax_year === year) {
              setReceipts((values) => [receipt, ...values]);
            } else {
              setReceipts([receipt]);
            }
            void loadReceipts(receipt.tax_year).catch((reason) => {
              setError(reason instanceof Error ? reason.message : "Could not refresh receipts");
            });
          }}
        />
      )}
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
