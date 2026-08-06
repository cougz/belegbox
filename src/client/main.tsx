import { StrictMode, useEffect, useState, type DragEvent, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const CATEGORIES = [
  "Arbeitsmittel",
  "Fahrtkosten/Entfernungspauschale",
  "Fortbildungskosten",
  "Bewerbungskosten",
  "Homeoffice-Pauschale",
  "Kontoführungsgebühren",
  "Gewerkschafts-/Berufsverbandsbeiträge",
  "Reisekosten",
  "Sonstiges",
] as const;

type Category = (typeof CATEGORIES)[number];

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
  r2_key: string | null;
  original_filename: string | null;
  mime_type: string | null;
  file_size: number | null;
  gwg_flag: 0 | 1;
}

interface YearConfig {
  tax_year: number;
  gwg_limit_cents: number;
  homeoffice_daily_cents: number;
  homeoffice_max_days: number;
  distance_first_20_km_cents: number;
  distance_after_20_km_cents: number;
  updated_at: string;
}

interface Suggestions {
  seller_name?: string;
  expense_date?: string;
  amount_cents?: number | null;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "Anfrage fehlgeschlagen" })) as { error?: string };
    throw new Error(body.error || `HTTP ${response.status}`);
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
    expense_date: expenseDate,
    tax_year: Number(expenseDate.slice(0, 4)),
    amount_cents: suggestions.amount_cents ?? receipt.amount_cents,
  };
}

function ReceiptEditor({
  receipt,
  onClose,
  onSaved,
  onDelete,
  onDuplicate,
}: {
  receipt: Receipt;
  onClose: () => void;
  onSaved: (receipt: Receipt) => void;
  onDelete: (receipt: Receipt) => void;
  onDuplicate: (receipt: Receipt) => void;
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
        category: draft.category,
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
      setError(reason instanceof Error ? reason.message : "Speichern fehlgeschlagen");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="editor-shell" role="dialog" aria-modal="true" aria-label="Beleg bearbeiten">
      <section className={`viewer-panel ${draft.r2_key ? "" : "no-file"}`}>
        <div className="panel-head">
          <div>
            <span className="eyebrow">// ORIGINAL</span>
            <h2>{draft.original_filename || "Ohne Datei"}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Schliessen">×</button>
        </div>
        {draft.r2_key ? (
          draft.mime_type?.startsWith("image/") ? (
            <img className="receipt-image" src={`/api/receipts/${draft.id}/file`} alt="Belegvorschau" />
          ) : (
            <iframe className="receipt-pdf" src={`/api/receipts/${draft.id}/file`} title="PDF-Belegvorschau" />
          )
        ) : (
          <div className="empty-viewer">Manueller Eintrag ohne Originaldatei</div>
        )}
      </section>

      <form className="editor-form" onSubmit={save}>
        <div className="panel-head sticky-head">
          <div>
            <span className="eyebrow">// ANLAGE N</span>
            <h2>Belegdaten</h2>
          </div>
          <span className={`tag ${draft.status === "complete" ? "tag-complete" : ""}`}>
            {draft.status === "complete" ? "Vollstaendig" : "Entwurf"}
          </span>
        </div>

        {error && <p className="notice notice-error" role="alert">{error}</p>}
        {draft.gwg_flag === 1 && (
          <p className="notice notice-warning">
            Betrag oberhalb der Jahres-GWG-Grenze. Dieser Beleg wird nicht in die Abzugssumme
            aufgenommen; eine AfA muss separat geprueft werden.
          </p>
        )}

        <div className="form-grid">
          <label className="field span-2">
            <span>Kategorie</span>
            <select value={draft.category} onChange={(event) => set("category", event.target.value as Category)}>
              {CATEGORIES.map((category) => <option key={category}>{category}</option>)}
            </select>
          </label>
          <label className="field span-2">
            <span>Beschreibung / Art des Arbeitsmittels</span>
            <input required maxLength={500} value={draft.description} onChange={(event) => set("description", event.target.value)} />
          </label>
          <label className="field">
            <span>Betrag (EUR)</span>
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
            <span>Berufliche Nutzung (%)</span>
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
            <span>Berechneter Anteil</span>
            <strong>{money(Math.round(draft.amount_cents * draft.business_use_pct / 100))}</strong>
            <small>{draft.gwg_flag ? "Nicht in Summen, AfA pruefen" : "Wird in der Kategoriesumme verwendet"}</small>
          </div>
          <label className="field">
            <span>Belegdatum</span>
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
            <span>Steuerjahr</span>
            <input readOnly value={draft.tax_year} />
          </label>
          <label className="field span-2">
            <span>Verkaeufer / Anbieter</span>
            <input maxLength={300} value={draft.seller_name} onChange={(event) => set("seller_name", event.target.value)} />
          </label>
          <label className="field span-2">
            <span>Verkaeuferadresse</span>
            <textarea rows={2} maxLength={1000} value={draft.seller_address} onChange={(event) => set("seller_address", event.target.value)} />
          </label>
          <label className="field">
            <span>Rechnungsnummer</span>
            <input maxLength={200} value={draft.invoice_number} onChange={(event) => set("invoice_number", event.target.value)} />
          </label>
          <label className="field">
            <span>Zahlungsart</span>
            <input maxLength={100} value={draft.payment_method} onChange={(event) => set("payment_method", event.target.value)} placeholder="Karte, Ueberweisung, bar" />
          </label>
          <label className="field span-2">
            <span>Notizen</span>
            <textarea rows={4} maxLength={5000} value={draft.notes} onChange={(event) => set("notes", event.target.value)} />
          </label>
          <label className="field span-2">
            <span>Status</span>
            <select value={draft.status} onChange={(event) => set("status", event.target.value as Receipt["status"])}>
              <option value="draft">Entwurf</option>
              <option value="complete">Vollstaendig</option>
            </select>
          </label>
        </div>

        <div className="editor-actions">
          <button className="button button-primary" disabled={saving} type="submit">
            {saving ? "Speichert..." : "Beleg speichern"}
          </button>
          <button className="button button-ghost" type="button" onClick={() => onDuplicate(draft)}>Duplizieren</button>
          <button className="button button-danger" type="button" onClick={() => onDelete(draft)}>Loeschen</button>
        </div>
        <p className="owner-line">Datensatzinhaber: {draft.owner_email}</p>
      </form>
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
      setMessage("Jahreswerte gespeichert.");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Speichern fehlgeschlagen");
    }
  };

  const number = (key: keyof YearConfig, label: string, cents = false) => (
    <label className="field compact-field">
      <span>{label}{cents ? " (Cent)" : ""}</span>
      <input
        type="number"
        min="0"
        step="1"
        value={draft[key]}
        onChange={(event) => setDraft((current) => ({ ...current, [key]: Number(event.target.value) }))}
      />
    </label>
  );

  return (
    <details className="settings-card">
      <summary>Jahreswerte {config.tax_year}</summary>
      <form className="settings-grid" onSubmit={save}>
        {number("gwg_limit_cents", "GWG-Grenze", true)}
        {number("homeoffice_daily_cents", "Homeoffice je Tag", true)}
        {number("homeoffice_max_days", "Homeoffice max. Tage")}
        {number("distance_first_20_km_cents", "Entfernung km 1-20", true)}
        {number("distance_after_20_km_cents", "Entfernung ab km 21", true)}
        <button className="button button-ghost" type="submit">Werte speichern</button>
        {message && <span className="settings-message">{message}</span>}
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
      setError(reason instanceof Error ? reason.message : "App konnte nicht geladen werden");
    }).finally(() => setLoading(false));
  }, [currentYear]);

  const chooseYear = async (targetYear: number) => {
    setYear(targetYear);
    setLoading(true);
    setError("");
    try {
      await loadReceipts(targetYear);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Belege konnten nicht geladen werden");
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
      const result = await request<{ receipt: Receipt; suggestions: Suggestions | null }>("/api/receipts/upload", {
        method: "POST",
        body: form,
      });
      const receipt = applySuggestions(result.receipt, result.suggestions);
      if (result.receipt.tax_year !== year) setYear(result.receipt.tax_year);
      await loadReceipts(result.receipt.tax_year);
      setSelected(receipt);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Upload fehlgeschlagen");
    } finally {
      setUploading(false);
      setDragging(false);
    }
  };

  const createManual = async () => {
    setError("");
    try {
      const result = await request<{ receipt: Receipt }>("/api/receipts/manual", { method: "POST" });
      if (result.receipt.tax_year !== year) setYear(result.receipt.tax_year);
      await loadReceipts(result.receipt.tax_year);
      setSelected(result.receipt);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Eintrag konnte nicht erstellt werden");
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
      setError(reason instanceof Error ? reason.message : "Import fehlgeschlagen");
    }
  };

  const createYearConfig = async () => {
    const source = configs.toSorted((a, b) => b.tax_year - a.tax_year)[0];
    if (!source) {
      setError("Es gibt keine vorhandenen Jahreswerte als Ausgangspunkt.");
      return;
    }
    setError("");
    try {
      const result = await request<{ config: YearConfig }>(`/api/config/${year}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gwg_limit_cents: source.gwg_limit_cents,
          homeoffice_daily_cents: source.homeoffice_daily_cents,
          homeoffice_max_days: source.homeoffice_max_days,
          distance_first_20_km_cents: source.distance_first_20_km_cents,
          distance_after_20_km_cents: source.distance_after_20_km_cents,
        }),
      });
      setConfigs((values) => [...values, result.config].toSorted((a, b) => b.tax_year - a.tax_year));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Jahreswerte konnten nicht angelegt werden");
    }
  };

  const deleteReceipt = async (receipt: Receipt) => {
    if (!window.confirm(`Beleg "${receipt.description}" unwiderruflich loeschen?`)) return;
    try {
      await request<void>(`/api/receipts/${receipt.id}`, { method: "DELETE" });
      setSelected(null);
      await loadReceipts(year);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Loeschen fehlgeschlagen");
    }
  };

  const duplicateReceipt = async (receipt: Receipt) => {
    try {
      const result = await request<{ receipt: Receipt }>(`/api/receipts/${receipt.id}/duplicate`, { method: "POST" });
      await loadReceipts(year);
      setSelected(result.receipt);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Duplizieren fehlgeschlagen");
    }
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) void upload(file);
  };

  const grouped = CATEGORIES.map((category) => ({
    category,
    items: receipts.filter((receipt) => receipt.category === category),
  })).filter((group) => group.items.length);
  const total = receipts.reduce((sum, receipt) => sum + (receipt.gwg_flag ? 0 : receipt.deductible_cents), 0);
  const selectedConfig = configs.find((config) => config.tax_year === year);

  return (
    <>
      <header className="app-nav">
        <div className="nav-inner">
          <a className="brand" href="/">belegbox</a>
          <div className="nav-meta">
            <span className="auth-dot" aria-hidden="true" />
            <span className="email">{email || "Authentifiziert"}</span>
          </div>
        </div>
      </header>

      <main className="app-main">
        <section className="toolbar">
          <div>
            <span className="eyebrow">// WERBUNGSKOSTEN · ANLAGE N</span>
            <h1>Belege und ELSTER-Summen</h1>
          </div>
          <div className="toolbar-actions">
            <label className="year-select">
              <span>Steuerjahr</span>
              <select value={year} onChange={(event) => void chooseYear(Number(event.target.value))}>
                {Array.from(new Set([year, currentYear, ...configs.map((config) => config.tax_year)]))
                  .sort((a, b) => b - a)
                  .map((value) => <option key={value}>{value}</option>)}
              </select>
            </label>
            <button className="button button-ghost" type="button" onClick={() => void createManual()}>Manuell</button>
            <label className="button button-ghost file-button">
              JSON importieren
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
              {uploading ? "Laedt hoch..." : "Beleg hochladen"}
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
            <span>Abziehbare Gesamtsumme</span>
            <strong>{money(total)}</strong>
            <small>{receipts.length} Belege · GWG/AfA-Prueffaelle ausgenommen</small>
          </article>
          <article className="stat-card">
            <span>Vollstaendig</span>
            <strong>{receipts.filter((receipt) => receipt.status === "complete").length}</strong>
            <small>{receipts.filter((receipt) => receipt.status === "draft").length} Entwuerfe offen</small>
          </article>
          <article className="stat-card warning-card">
            <span>AfA pruefen</span>
            <strong>{receipts.filter((receipt) => receipt.gwg_flag).length}</strong>
            <small>Nicht in der Gesamtsumme enthalten</small>
          </article>
          <article className="stat-card data-card">
            <span>Export {year}</span>
            <div className="export-links">
              {(["zip", "pdf", "csv", "json"] as const).map((format) => (
                <a key={format} href={`/api/exports/${year}/${format}`}>{format.toUpperCase()}</a>
              ))}
            </div>
            <small>Hand-off fuer ELSTER und Backup</small>
          </article>
        </section>

        <section
          className={`drop-zone ${dragging ? "is-dragging" : ""}`}
          onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
          }}
          onDrop={onDrop}
        >
          <span className="drop-mark">+</span>
          <div><strong>PDF oder Bild hier ablegen</strong><small>Original bleibt privat in R2 · maximal 20 MB</small></div>
        </section>

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
              <strong>Jahreswerte fuer {year} fehlen</strong>
              <small>Werte des letzten Jahres uebernehmen und vor Verwendung pruefen.</small>
            </div>
            <button className="button button-ghost" type="button" onClick={() => void createYearConfig()}>
              Jahr anlegen
            </button>
          </section>
        )}

        <section className="ledger" aria-busy={loading}>
          <div className="ledger-head">
            <div>
              <span className="eyebrow">// ELSTER-STRUKTUR</span>
              <h2>Kategorien {year}</h2>
            </div>
            <span className="tag">{grouped.length} Kategorien</span>
          </div>

          {!loading && !receipts.length && (
            <div className="empty-state">
              <h3>Noch keine Belege fuer {year}</h3>
              <p>Lade ein Original hoch oder lege eine Pauschale als manuellen Eintrag an.</p>
            </div>
          )}

          {grouped.map((group) => {
            const categoryTotal = group.items.reduce((sum, receipt) => sum + (receipt.gwg_flag ? 0 : receipt.deductible_cents), 0);
            return (
              <article className="category-block" key={group.category}>
                <header className="category-head">
                  <div>
                    <h3>{group.category}</h3>
                    <span>{group.items.length} {group.items.length === 1 ? "Beleg" : "Belege"}</span>
                  </div>
                  <div className="category-total"><span>Summe</span><strong>{money(categoryTotal)}</strong></div>
                </header>
                <div className="receipt-table" role="table">
                  {group.items.map((receipt) => (
                    <button className="receipt-row" type="button" role="row" key={receipt.id} onClick={() => setSelected(receipt)}>
                      <span className="date-cell">{new Date(`${receipt.expense_date}T00:00:00`).toLocaleDateString("de-DE")}</span>
                      <span className="description-cell">
                        <strong>{receipt.description || "Ohne Beschreibung"}</strong>
                        <small>{receipt.seller_name || receipt.original_filename || "Manueller Eintrag"}</small>
                      </span>
                      <span className="status-cell">
                        {receipt.gwg_flag ? <span className="tag tag-warning">AfA pruefen</span> : (
                          <span className={`tag ${receipt.status === "complete" ? "tag-complete" : ""}`}>
                            {receipt.status === "complete" ? "Fertig" : "Entwurf"}
                          </span>
                        )}
                      </span>
                      <span className="amount-cell">
                        <strong>{money(receipt.gwg_flag ? 0 : receipt.deductible_cents)}</strong>
                        <small>von {money(receipt.amount_cents)}</small>
                      </span>
                    </button>
                  ))}
                </div>
              </article>
            );
          })}
        </section>
      </main>

      <footer className="app-footer">
        <span>belegbox · private Belegablage</span>
        <span>Keine ELSTER-API, keine automatisierte Abgabe, keine Steuerberatung.</span>
      </footer>

      {selected && (
        <ReceiptEditor
          receipt={selected}
          onClose={() => setSelected(null)}
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
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
