import { StrictMode, useEffect, useEffectEvent, useRef, useState, type DragEvent, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const CATEGORY = "Aufwendungen für Arbeitsmittel" as const;

type Category = typeof CATEGORY;
type Language = "de" | "en";

const EN = {
  authenticated: "Authenticated",
  language: "Language",
  editReceipt: "Edit receipt",
  original: "Original",
  noFile: "No file",
  close: "Close",
  receiptPreview: "Receipt preview",
  pdfReceiptPreview: "PDF receipt preview",
  manualNoOriginal: "Manual entry without an original file",
  officialFieldEyebrow: "Official German tax form field",
  complete: "Complete",
  draft: "Draft",
  ocrReadyStart: "AI text recognition (OCR) filled",
  editableField: "editable field",
  editableFields: "editable fields",
  ocrReadyEnd: "Review the values before saving; no suggestion has been committed yet.",
  ocrNoFields: "AI text recognition could not confidently identify receipt fields. Enter them manually.",
  ocrUnsupported: "AI text recognition currently supports PNG, JPEG, and WebP images. Enter this file manually.",
  ocrTooLarge: "This image is too large for AI text recognition. Enter its fields manually.",
  ocrError: "AI text recognition failed. The original is stored safely; enter its fields manually.",
  ocrDisabled: "AI text recognition is disabled. Enter the receipt fields manually.",
  description: "Description / type of work item",
  amountEur: "Amount (EUR)",
  workUsePct: "Work use (%)",
  deductibleAmount: "Calculated deductible amount",
  includedLedger: "Included in the ledger total",
  receiptDate: "Receipt date",
  taxYear: "Tax year",
  seller: "Seller / vendor",
  invoiceNumber: "Invoice number",
  paymentMethod: "Payment method",
  paymentPlaceholder: "Card, bank transfer, cash",
  notes: "Notes",
  saving: "Saving...",
  saveReceipt: "Save receipt",
  reviewReceipt: "Review receipt",
  reviewIntro: "Check the essentials, then continue straight to the next receipt.",
  moreDetails: "Invoice details and notes",
  completeReceipt: "Complete receipt",
  completeAndNext: "Complete & next",
  preparingReceipt: "Preparing your receipt",
  preparingReceiptHelp: "The original is being stored and read with OCR. Review starts as soon as it is ready.",
  retry: "Try again",
  skip: "Skip file",
  stopQueueTitle: "Stop reviewing this batch?",
  stopQueueBody: "Uploaded receipts will remain saved as drafts.",
  stopQueueConfirmAction: "Stop reviewing",
  stopQueueCancelAction: "Keep reviewing",
  queueUploadError: "This file could not be prepared",
  receiptFieldsError: "Enter a description, an amount above zero, and a valid receipt date.",
  delete: "Delete",
  cancel: "Cancel",
  deleteConfirmTitle: "Delete receipt?",
  deleteConfirmUndo: "This cannot be undone.",
  saveReceiptError: "Could not save the receipt",
  workUse: "work use",
  workUseHelp: "Leave at 100% when the item is only used for work.",
  filedUnder: "Filed under",
  loadAppError: "Could not load the app",
  loadReceiptsError: "Could not load receipts",
  deleteConfirmStart: "Permanently delete receipt",
  deleteError: "Could not delete the receipt",
  refreshError: "Could not refresh receipts",
  workEquipmentEyebrow: "Work equipment · official tax record",
  ledgerTitle: "Work equipment receipt ledger",
  totalDeductible: "Total deductible amount",
  receipt: "receipt",
  receipts: "receipts",
  draftsOpen: "drafts open",
  exportPdf: "Export PDF",
  exportHelp: "Includes every uploaded receipt image or PDF",
  dropTitle: "Drop all receipt images or PDFs here",
  dropHelp: "Choose one or many. OCR starts immediately, then you review each receipt in order · maximum 20 MB each",
  noReceiptsStart: "No receipts for",
  noReceiptsHelp: "Drop one or more receipts above to get started.",
  noDescription: "No description",
  manualEntry: "Manual entry",
  of: "of",
  privateArchive: "private receipt archive",
  githubLabel: "belegbox source code on GitHub",
} as const;

type Copy = { [Key in keyof typeof EN]: string };

const TEXT: Record<Language, Copy> = {
  en: EN,
  de: {
    authenticated: "Angemeldet",
    language: "Sprache",
    editReceipt: "Beleg bearbeiten",
    original: "Original",
    noFile: "Keine Datei",
    close: "Schließen",
    receiptPreview: "Belegvorschau",
    pdfReceiptPreview: "PDF-Belegvorschau",
    manualNoOriginal: "Manueller Eintrag ohne Originaldatei",
    officialFieldEyebrow: "Feld der deutschen Steuererklärung",
    complete: "Vollständig",
    draft: "Entwurf",
    ocrReadyStart: "Die KI-Texterkennung (OCR) hat",
    editableField: "bearbeitbares Feld",
    editableFields: "bearbeitbare Felder",
    ocrReadyEnd: "Bitte vor dem Speichern prüfen; die Vorschläge wurden noch nicht übernommen.",
    ocrNoFields: "Die KI-Texterkennung konnte keine Belegdaten sicher erkennen. Bitte manuell eingeben.",
    ocrUnsupported: "Die KI-Texterkennung unterstützt derzeit PNG-, JPEG- und WebP-Bilder. Bitte diese Datei manuell erfassen.",
    ocrTooLarge: "Dieses Bild ist zu groß für die KI-Texterkennung. Bitte die Daten manuell eingeben.",
    ocrError: "Die KI-Texterkennung ist fehlgeschlagen. Das Original wurde sicher gespeichert; bitte die Daten manuell eingeben.",
    ocrDisabled: "Die KI-Texterkennung ist deaktiviert. Bitte die Belegdaten manuell eingeben.",
    description: "Beschreibung / Art des Arbeitsmittels",
    amountEur: "Betrag (EUR)",
    workUsePct: "Berufliche Nutzung (%)",
    deductibleAmount: "Berechneter abziehbarer Betrag",
    includedLedger: "In der Belegsumme enthalten",
    receiptDate: "Belegdatum",
    taxYear: "Steuerjahr",
    seller: "Verkäufer / Anbieter",
    invoiceNumber: "Rechnungsnummer",
    paymentMethod: "Zahlungsart",
    paymentPlaceholder: "Karte, Überweisung, Barzahlung",
    notes: "Notizen",
    saving: "Wird gespeichert...",
    saveReceipt: "Beleg speichern",
    reviewReceipt: "Beleg prüfen",
    reviewIntro: "Das Wesentliche prüfen und direkt mit dem nächsten Beleg weitermachen.",
    moreDetails: "Rechnungsdetails und Notizen",
    completeReceipt: "Beleg abschließen",
    completeAndNext: "Abschließen & weiter",
    preparingReceipt: "Beleg wird vorbereitet",
    preparingReceiptHelp: "Das Original wird gespeichert und per OCR ausgelesen. Sobald es bereit ist, kann es geprüft werden.",
    retry: "Erneut versuchen",
    skip: "Datei überspringen",
    stopQueueTitle: "Stapelbearbeitung beenden?",
    stopQueueBody: "Bereits hochgeladene Belege bleiben als Entwürfe gespeichert.",
    stopQueueConfirmAction: "Beenden",
    stopQueueCancelAction: "Weiter prüfen",
    queueUploadError: "Diese Datei konnte nicht vorbereitet werden",
    receiptFieldsError: "Bitte Beschreibung, einen Betrag größer als null und ein gültiges Belegdatum eingeben.",
    delete: "Löschen",
    cancel: "Abbrechen",
    deleteConfirmTitle: "Beleg löschen?",
    deleteConfirmUndo: "Dies kann nicht rückgängig gemacht werden.",
    saveReceiptError: "Der Beleg konnte nicht gespeichert werden",
    workUse: "beruflich genutzt",
    workUseHelp: "Bei ausschließlich beruflicher Nutzung auf 100 % belassen.",
    filedUnder: "Zugeordnet zu",
    loadAppError: "Die Anwendung konnte nicht geladen werden",
    loadReceiptsError: "Die Belege konnten nicht geladen werden",
    deleteConfirmStart: "Beleg endgültig löschen",
    deleteError: "Der Beleg konnte nicht gelöscht werden",
    refreshError: "Die Belege konnten nicht aktualisiert werden",
    workEquipmentEyebrow: "Arbeitsmittel · offizieller Steuernachweis",
    ledgerTitle: "Belegübersicht für Arbeitsmittel",
    totalDeductible: "Gesamter abziehbarer Betrag",
    receipt: "Beleg",
    receipts: "Belege",
    draftsOpen: "offene Entwürfe",
    exportPdf: "PDF exportieren",
    exportHelp: "Enthält jedes hochgeladene Belegbild oder PDF",
    dropTitle: "Alle Belegbilder oder PDFs hier ablegen",
    dropHelp: "Einen oder mehrere auswählen. OCR startet sofort, danach werden die Belege der Reihe nach geprüft · jeweils maximal 20 MB",
    noReceiptsStart: "Keine Belege für",
    noReceiptsHelp: "Zum Start einen oder mehrere Belege oben ablegen.",
    noDescription: "Keine Beschreibung",
    manualEntry: "Manueller Eintrag",
    of: "von",
    privateArchive: "privates Belegarchiv",
    githubLabel: "belegbox-Quellcode auf GitHub",
  },
};

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

interface ReceiptQueueItem {
  id: string;
  file: File;
  position: number;
  status: "uploading" | "ready" | "error";
  receipt?: Receipt;
  aiPrefill?: AiPrefillInfo;
  error?: string;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "Request failed" })) as { error?: string };
    throw new Error(body.error || `Request failed (HTTP ${response.status})`);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

function money(cents: number, language: Language): string {
  return new Intl.NumberFormat(language === "de" ? "de-DE" : "en-IE", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}

function initialLanguage(): Language {
  const saved = window.localStorage.getItem("belegbox-language");
  if (saved === "de" || saved === "en") return saved;
  return window.navigator.language.toLowerCase().startsWith("de") ? "de" : "en";
}

function initialTaxYear(fallback: number): number {
  const saved = Number(window.localStorage.getItem("belegbox-tax-year"));
  return Number.isInteger(saved) && saved >= 2000 && saved <= 2200 ? saved : fallback;
}

function useModalFocus(onClose: () => void, closeDisabled = false) {
  const modalRef = useRef<HTMLElement>(null);
  const close = useEffectEvent(() => {
    if (!closeDisabled) onClose();
  });

  useEffect(() => {
    const modal = modalRef.current;
    if (!modal) return;

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const background = Array.from(document.getElementById("root")?.children ?? [])
      .filter((element): element is HTMLElement => element instanceof HTMLElement && !element.contains(modal));
    const backgroundState = background.map((element) => ({
      element,
      inert: element.inert,
      ariaHidden: element.getAttribute("aria-hidden"),
    }));
    background.forEach((element) => {
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    });

    const focusableSelector = [
      "button:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "summary",
      "[href]",
      "[tabindex]:not([tabindex='-1'])",
    ].join(",");
    const focusable = () => Array.from(modal.querySelectorAll<HTMLElement>(focusableSelector));
    (modal.querySelector<HTMLElement>("[data-initial-focus]") ?? focusable()[0] ?? modal).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;

      const elements = focusable();
      if (!elements.length) {
        event.preventDefault();
        modal.focus();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      backgroundState.forEach(({ element, inert, ariaHidden }) => {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      });
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return modalRef;
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
  copy,
  language,
  onClose,
  onSaved,
  onDelete,
  aiPrefill,
  queueProgress,
}: {
  receipt: Receipt;
  copy: Copy;
  language: Language;
  onClose: () => void;
  onSaved: (receipt: Receipt) => void | Promise<void>;
  onDelete: (receipt: Receipt) => void;
  aiPrefill: AiPrefillInfo | null;
  queueProgress: { current: number; total: number } | null;
}) {
  const [draft, setDraft] = useState(receipt);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [amountText, setAmountText] = useState(() => (receipt.amount_cents / 100).toFixed(2));
  const modalRef = useModalFocus(onClose, saving);

  useEffect(() => {
    setDraft(receipt);
    setAmountText((receipt.amount_cents / 100).toFixed(2));
  }, [receipt]);

  const set = <K extends keyof Receipt>(key: K, value: Receipt[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!event.currentTarget.checkValidity()) {
      setError(copy.receiptFieldsError);
      event.currentTarget.reportValidity();
      return;
    }
    setSaving(true);
    setError("");
    try {
      const body = {
        status: "complete",
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
      await onSaved(result.receipt);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.saveReceiptError);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="receipt-overlay" role="presentation">
      <section ref={modalRef} className="receipt-card" role="dialog" aria-modal="true" aria-label={copy.editReceipt} tabIndex={-1}>
        <header className="receipt-head">
          <div>
            <span className="eyebrow">// {copy.reviewReceipt.toUpperCase()}</span>
            <h2>{copy.reviewReceipt}</h2>
            <p>{copy.reviewIntro}</p>
          </div>
          <div className="receipt-head-actions">
            {queueProgress && (
              <span className="queue-count" aria-label={`${queueProgress.current} ${copy.of} ${queueProgress.total}`}>
                {queueProgress.current} / {queueProgress.total}
              </span>
            )}
            <button className="icon-button" type="button" onClick={onClose} disabled={saving} aria-label={copy.close}>×</button>
          </div>
        </header>

        <div className="receipt-workspace">
          <section className={`receipt-viewer ${draft.has_file ? "" : "no-file"}`}>
            <div className="receipt-filename">
              <span>{copy.original}</span>
              <strong>{draft.original_filename || copy.noFile}</strong>
            </div>
            {draft.has_file ? (
              draft.mime_type?.startsWith("image/") ? (
                <img className="receipt-image" src={`/api/receipts/${draft.id}/file`} alt={copy.receiptPreview} />
              ) : (
                <iframe className="receipt-pdf" src={`/api/receipts/${draft.id}/file`} title={copy.pdfReceiptPreview} />
              )
            ) : (
              <div className="empty-viewer">{copy.manualNoOriginal}</div>
            )}
          </section>

          <form className="receipt-form" onSubmit={save} noValidate>
            {error && <p className="notice notice-error" role="alert">{error}</p>}
            {aiPrefill?.status === "ready" && (
              <p className="notice notice-ai" role="status">
                {copy.ocrReadyStart} {aiPrefill.fieldCount} {aiPrefill.fieldCount === 1 ? copy.editableField : copy.editableFields}. {copy.ocrReadyEnd}
              </p>
            )}
            {aiPrefill && aiPrefill.status !== "ready" && (
              <p className="notice notice-warning" role="status">
                {aiPrefill.status === "no_fields" && copy.ocrNoFields}
                {aiPrefill.status === "unsupported" && copy.ocrUnsupported}
                {aiPrefill.status === "too_large" && copy.ocrTooLarge}
                {aiPrefill.status === "error" && copy.ocrError}
                {aiPrefill.status === "disabled" && copy.ocrDisabled}
              </p>
            )}

            <div className="form-grid">
              <label className="field span-2 receipt-description">
                <span>{copy.description}</span>
                <input data-initial-focus required maxLength={500} value={draft.description} onChange={(event) => set("description", event.target.value)} />
              </label>
              <label className="field">
                <span>{copy.amountEur}</span>
                <input
                  required
                  type="text"
                  inputMode="decimal"
                  pattern="^\d{1,7}([.,]\d{1,2})?$"
                  value={amountText}
                  onChange={(event) => {
                    const raw = event.target.value;
                    setAmountText(raw);
                    const parsed = Number(raw.replace(",", "."));
                    const valid = /^\d{1,7}([.,]\d{1,2})?$/.test(raw) && parsed >= 0.01 && parsed <= 9999999.99;
                    event.target.setCustomValidity(valid ? "" : copy.receiptFieldsError);
                    if (valid) set("amount_cents", Math.round(parsed * 100));
                  }}
                  onBlur={() => setAmountText((draft.amount_cents / 100).toFixed(2))}
                />
              </label>
              <label className="field">
                <span>{copy.receiptDate}</span>
                <input
                  required
                  type="date"
                  defaultValue={draft.expense_date}
                  onChange={(event) => {
                    setDraft((current) => ({
                      ...current,
                      expense_date: event.target.value,
                      tax_year: Number(event.target.value.slice(0, 4)),
                    }));
                  }}
                />
              </label>
              <label className="field span-2">
                <span>{copy.seller}</span>
                <input maxLength={300} value={draft.seller_name} onChange={(event) => set("seller_name", event.target.value)} />
              </label>
            </div>

            <details className="receipt-more">
              <summary>
                <span>{copy.moreDetails}</span>
                <small>{draft.business_use_pct}% {copy.workUse}</small>
              </summary>
              <div className="form-grid receipt-more-fields">
                <label className="field">
                  <span>{copy.invoiceNumber}</span>
                  <input maxLength={200} value={draft.invoice_number} onChange={(event) => set("invoice_number", event.target.value)} />
                </label>
                <label className="field">
                  <span>{copy.paymentMethod}</span>
                  <input maxLength={100} value={draft.payment_method} onChange={(event) => set("payment_method", event.target.value)} placeholder={copy.paymentPlaceholder} />
                </label>
                <label className="field">
                  <span>{copy.workUsePct}</span>
                  <input
                    required
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={draft.business_use_pct}
                    onChange={(event) => set("business_use_pct", Number(event.target.value))}
                  />
                  <small className="field-help">{copy.workUseHelp}</small>
                </label>
                <label className="field">
                  <span>{copy.notes}</span>
                  <textarea rows={3} maxLength={5000} value={draft.notes} onChange={(event) => set("notes", event.target.value)} />
                </label>
              </div>
            </details>

            <div className="calculated">
              <span>{copy.deductibleAmount}</span>
              <strong>{money(Math.round(draft.amount_cents * draft.business_use_pct / 100), language)}</strong>
              <small>{copy.includedLedger}</small>
            </div>

            <div className="receipt-actions">
              <span>{copy.filedUnder} {CATEGORY}</span>
              <div>
                {!queueProgress && (
                  <button className="button button-danger" type="button" onClick={() => onDelete(draft)}>{copy.delete}</button>
                )}
                <button className="button button-primary" disabled={saving} type="submit">
                  {saving
                    ? copy.saving
                    : queueProgress && queueProgress.current < queueProgress.total
                      ? copy.completeAndNext
                      : draft.status === "complete"
                        ? copy.saveReceipt
                        : copy.completeReceipt}
                </button>
              </div>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}

function ReceiptQueueStatus({
  item,
  total,
  copy,
  onClose,
  onRetry,
  onSkip,
}: {
  item: ReceiptQueueItem;
  total: number;
  copy: Copy;
  onClose: () => void;
  onRetry: () => void;
  onSkip: () => void;
}) {
  const modalRef = useModalFocus(onClose);

  return (
    <div className="receipt-overlay" role="presentation">
      <section ref={modalRef} className="queue-card" role="dialog" aria-modal="true" aria-label={copy.preparingReceipt} tabIndex={-1}>
        <header className="receipt-head">
          <div>
            <span className="eyebrow">// {copy.reviewReceipt.toUpperCase()}</span>
            <h2>{copy.preparingReceipt}</h2>
          </div>
          <div className="receipt-head-actions">
            <span className="queue-count">{item.position} / {total}</span>
            <button className="icon-button" type="button" onClick={onClose} aria-label={copy.close}>×</button>
          </div>
        </header>
        <div className="queue-state">
          {item.status === "uploading" ? <span className="queue-spinner" aria-hidden="true" /> : <span className="queue-error-mark" aria-hidden="true">!</span>}
          <strong>{item.file.name}</strong>
          {item.status === "uploading" ? (
            <p>{copy.preparingReceiptHelp}</p>
          ) : (
            <p className="queue-error" role="alert">{item.error || copy.queueUploadError}</p>
          )}
          {item.status === "error" && (
            <div className="queue-actions">
              <button className="button button-ghost" type="button" onClick={onSkip}>{copy.skip}</button>
              <button className="button button-primary" type="button" onClick={onRetry}>{copy.retry}</button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const modalRef = useModalFocus(onCancel);

  return (
    <div className="receipt-overlay" role="presentation">
      <section ref={modalRef} className="confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" tabIndex={-1}>
        <h2 id="confirm-title">{title}</h2>
        <p className="confirm-message">{message}</p>
        <div className="confirm-actions">
          <button className="button button-ghost" type="button" onClick={onCancel} data-initial-focus>{cancelLabel}</button>
          <button className={`button ${danger ? "button-danger-solid" : "button-primary"}`} type="button" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}

function App() {
  const currentYear = new Date().getFullYear();
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const copy = TEXT[language];
  const [email, setEmail] = useState("");
  const [taxYears, setTaxYears] = useState<number[]>([]);
  const [year, setYear] = useState(() => initialTaxYear(currentYear));
  const startupYear = useRef(year).current;
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [selected, setSelected] = useState<Receipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [aiPrefill, setAiPrefill] = useState<AiPrefillInfo | null>(null);
  const [receiptQueue, setReceiptQueue] = useState<ReceiptQueueItem[]>([]);
  const [queueTotal, setQueueTotal] = useState(0);
  const [confirmState, setConfirmState] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel: string;
    danger?: boolean;
    onConfirm: () => void;
  } | null>(null);
  const pendingUploads = useRef<Set<Promise<void>>>(new Set());
  const currentYearRef = useRef(year);
  const receiptLoadSequence = useRef(0);
  const receiptInputRef = useRef<HTMLInputElement>(null);
  const queueReturnFocus = useRef<HTMLElement | null>(null);
  const queueWasOpen = useRef(false);

  useEffect(() => {
    document.documentElement.lang = language;
    window.localStorage.setItem("belegbox-language", language);
  }, [language]);

  useEffect(() => {
    currentYearRef.current = year;
    window.localStorage.setItem("belegbox-tax-year", String(year));
  }, [year]);

  useEffect(() => {
    if (receiptQueue.length) {
      queueWasOpen.current = true;
      return;
    }
    if (!queueWasOpen.current) return;
    queueWasOpen.current = false;
    const frame = requestAnimationFrame(() => {
      const target = queueReturnFocus.current;
      (target?.isConnected && !(target instanceof HTMLInputElement && target.disabled)
        ? target
        : receiptInputRef.current)?.focus();
      queueReturnFocus.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [receiptQueue.length]);

  const loadReceipts = async (targetYear: number) => {
    const sequence = ++receiptLoadSequence.current;
    const result = await request<{ receipts: Receipt[] }>(`/api/receipts?tax_year=${targetYear}`);
    if (sequence !== receiptLoadSequence.current || targetYear !== currentYearRef.current) return;
    setReceipts(result.receipts);
  };

  useEffect(() => {
    void Promise.all([
      request<{ email: string }>("/api/session"),
      request<{ tax_years: number[] }>("/api/tax-years"),
      loadReceipts(startupYear),
    ]).then(([session, taxYearsResult]) => {
      setEmail(session.email);
      setTaxYears(taxYearsResult.tax_years);
    }).catch((reason) => {
      setError(reason instanceof Error ? reason.message : copy.loadAppError);
    }).finally(() => setLoading(false));
  }, [startupYear]);

  const chooseYear = async (targetYear: number) => {
    currentYearRef.current = targetYear;
    setYear(targetYear);
    setLoading(true);
    setError("");
    try {
      await loadReceipts(targetYear);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.loadReceiptsError);
    } finally {
      setLoading(false);
    }
  };

  const uploadQueueItem = async (item: ReceiptQueueItem) => {
    try {
      const form = new FormData();
      form.set("file", item.file);
      form.set("receipt_id", item.id);
      form.set("tax_year_hint", String(currentYearRef.current));
      const result = await request<{
        receipt: Receipt;
        suggestions: Suggestions | null;
        ai_prefill: Omit<AiPrefillInfo, "fieldCount">;
      }>("/api/receipts/upload", {
        method: "POST",
        body: form,
      });
      const receipt = applySuggestions(result.receipt, result.suggestions);
      const itemAiPrefill = {
        ...result.ai_prefill,
        fieldCount: Object.keys(result.suggestions ?? {}).length,
      };
      setReceiptQueue((items) => items.map((queued) => queued.id === item.id ? {
        ...queued,
        status: "ready",
        receipt,
        aiPrefill: itemAiPrefill,
        error: undefined,
      } : queued));
    } catch (reason) {
      setReceiptQueue((items) => items.map((queued) => queued.id === item.id ? {
        ...queued,
        status: "error",
        error: reason instanceof Error ? reason.message : copy.queueUploadError,
      } : queued));
    }
  };

  const startQueueUpload = (item: ReceiptQueueItem) => {
    const upload = uploadQueueItem(item);
    pendingUploads.current.add(upload);
    void upload.finally(() => pendingUploads.current.delete(upload));
  };

  const enqueueReceipts = (files: FileList | File[]) => {
    const selectedFiles = Array.from(files);
    if (!selectedFiles.length) return;

    const items: ReceiptQueueItem[] = selectedFiles.map((file, index) => ({
      id: crypto.randomUUID(),
      file,
      position: index + 1,
      status: "uploading",
    }));

    setError("");
    setDragging(false);
    queueReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelected(null);
    setAiPrefill(null);
    setQueueTotal(items.length);
    setReceiptQueue(items);
    items.forEach(startQueueUpload);
  };

  const closeReceiptQueue = () => {
    setConfirmState({
      title: copy.stopQueueTitle,
      message: copy.stopQueueBody,
      confirmLabel: copy.stopQueueConfirmAction,
      cancelLabel: copy.stopQueueCancelAction,
      onConfirm: () => {
        setConfirmState(null);
        const uploads = Array.from(pendingUploads.current);
        const closedYear = year;
        setReceiptQueue([]);
        setQueueTotal(0);
        void Promise.allSettled(uploads).then(() => {
          if (currentYearRef.current !== closedYear) return;
          return loadReceipts(closedYear).catch((reason) => {
            setError(reason instanceof Error ? reason.message : copy.refreshError);
          });
        });
      },
    });
  };

  const retryQueueItem = (item: ReceiptQueueItem) => {
    const retry = { ...item, status: "uploading" as const, error: undefined };
    setReceiptQueue((items) => items.map((queued) => queued.id === item.id ? retry : queued));
    startQueueUpload(retry);
  };

  const saveReceiptInLedger = async (saved: Receipt) => {
    if (saved.tax_year !== currentYearRef.current) {
      currentYearRef.current = saved.tax_year;
      setYear(saved.tax_year);
      setTaxYears((years) => years.includes(saved.tax_year) ? years : [...years, saved.tax_year]);
      setReceipts([saved]);
      await loadReceipts(saved.tax_year).catch((reason) => {
        setError(reason instanceof Error ? reason.message : copy.refreshError);
      });
      return;
    }

    receiptLoadSequence.current += 1;
    setReceipts((values) => values.some((value) => value.id === saved.id)
      ? values.map((value) => value.id === saved.id ? saved : value)
      : [saved, ...values]);
  };

  const deleteReceipt = (receipt: Receipt) => {
    setConfirmState({
      title: copy.deleteConfirmTitle,
      message: `${copy.deleteConfirmStart} "${receipt.description}"? ${copy.deleteConfirmUndo}`,
      confirmLabel: copy.delete,
      cancelLabel: copy.cancel,
      danger: true,
      onConfirm: async () => {
        setConfirmState(null);
        try {
          await request<void>(`/api/receipts/${receipt.id}`, { method: "DELETE" });
          setSelected(null);
          await loadReceipts(year);
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : copy.deleteError);
        }
      },
    });
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    enqueueReceipts(event.dataTransfer.files);
  };

  const total = receipts.reduce((sum, receipt) => sum + receipt.deductible_cents, 0);
  const currentQueueItem = receiptQueue[0];

  return (
    <>
      <header className="app-nav">
        <div className="nav-inner">
          <a className="brand" href="/">belegbox</a>
          <div className="nav-meta">
            <span className="auth-dot" aria-hidden="true" />
            <span className="email">{email || copy.authenticated}</span>
            <div className="language-toggle" data-language={language} role="group" aria-label={copy.language}>
              <button type="button" aria-pressed={language === "de"} onClick={() => setLanguage("de")}>DE</button>
              <button type="button" aria-pressed={language === "en"} onClick={() => setLanguage("en")}>EN</button>
            </div>
          </div>
        </div>
      </header>

      <main className="app-main">
        <section className="toolbar">
          <div>
            <span className="eyebrow">// {copy.workEquipmentEyebrow.toUpperCase()}</span>
            <h1>{copy.ledgerTitle}</h1>
          </div>
          <div className="toolbar-actions">
            <label className="year-select">
              <span>{copy.taxYear}</span>
              <select value={year} onChange={(event) => void chooseYear(Number(event.target.value))}>
                {Array.from(new Set([year, currentYear, ...taxYears]))
                  .sort((a, b) => b - a)
                  .map((value) => <option key={value}>{value}</option>)}
              </select>
            </label>
          </div>
        </section>

        {error && <p className="notice notice-error" role="alert">{error}</p>}

        <section className="summary-grid">
          <article className="stat-card total-card">
            <span>{copy.totalDeductible}</span>
            <strong>{money(total, language)}</strong>
            <small>{receipts.length} {receipts.length === 1 ? copy.receipt : copy.receipts}</small>
          </article>
          <article className="stat-card">
            <span>{copy.complete}</span>
            <strong>{receipts.filter((receipt) => receipt.status === "complete").length}</strong>
            <small>{receipts.filter((receipt) => receipt.status === "draft").length} {copy.draftsOpen}</small>
          </article>
          <article className="stat-card data-card">
            <span>{copy.exportPdf} {year}</span>
            <div className="export-links">
              <a href={`/api/exports/${year}`}>PDF</a>
            </div>
            <small>{copy.exportHelp}</small>
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
            ref={receiptInputRef}
            className="drop-input"
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic"
            multiple
            disabled={receiptQueue.length > 0}
            onChange={(event) => {
              if (event.target.files) enqueueReceipts(event.target.files);
              event.target.value = "";
            }}
          />
          <span className="drop-mark">+</span>
          <div><strong>{copy.dropTitle}</strong><small>{copy.dropHelp}</small></div>
        </label>

        <section className="ledger" aria-busy={loading}>
          <div className="ledger-head">
            <div>
              <span className="eyebrow">// {copy.officialFieldEyebrow.toUpperCase()} · {year}</span>
              <h2>{CATEGORY}</h2>
            </div>
            <div className="ledger-total">
              <span>{receipts.length} {receipts.length === 1 ? copy.receipt : copy.receipts}</span>
              <strong>{money(total, language)}</strong>
            </div>
          </div>

          {!loading && !receipts.length && (
            <div className="empty-state">
              <h3>{copy.noReceiptsStart} {year}</h3>
              <p>{copy.noReceiptsHelp}</p>
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
                  <span className="date-cell">{new Date(`${receipt.expense_date}T00:00:00`).toLocaleDateString(language === "de" ? "de-DE" : "en-GB")}</span>
                  <span className="description-cell">
                    <strong>{receipt.description || copy.noDescription}</strong>
                    <small>{receipt.seller_name || receipt.original_filename || copy.manualEntry}</small>
                  </span>
                  <span className="status-cell">
                    <span className={`tag ${receipt.status === "complete" ? "tag-complete" : ""}`}>
                      {receipt.status === "complete" ? copy.complete : copy.draft}
                    </span>
                  </span>
                  <span className="amount-cell">
                    <strong>{money(receipt.deductible_cents, language)}</strong>
                    <small>{copy.of} {money(receipt.amount_cents, language)}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      </main>

      <footer className="app-footer">
        <span>belegbox · {copy.privateArchive}</span>
        <a
          className="footer-github"
          href="https://github.com/cougz/belegbox"
          target="_blank"
          rel="noopener noreferrer"
          aria-label={copy.githubLabel}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z" />
          </svg>
          cougz/belegbox
        </a>
      </footer>

      {selected && (
        <ReceiptEditor
          receipt={selected}
          copy={copy}
          language={language}
          aiPrefill={aiPrefill}
          onClose={() => {
            setAiPrefill(null);
            setSelected(null);
          }}
          onSaved={(saved) => {
            setAiPrefill(null);
            setSelected(null);
            return saveReceiptInLedger(saved);
          }}
          onDelete={deleteReceipt}
          queueProgress={null}
        />
      )}

      {currentQueueItem?.status === "ready" && currentQueueItem.receipt && (
        <ReceiptEditor
          key={currentQueueItem.id}
          receipt={currentQueueItem.receipt}
          copy={copy}
          language={language}
          aiPrefill={currentQueueItem.aiPrefill ?? null}
          onClose={closeReceiptQueue}
          onSaved={async (saved) => {
            await saveReceiptInLedger(saved);
            setReceiptQueue((items) => items.filter((item) => item.id !== saved.id));
          }}
          onDelete={() => undefined}
          queueProgress={{ current: currentQueueItem.position, total: queueTotal }}
        />
      )}

      {currentQueueItem && currentQueueItem.status !== "ready" && (
        <ReceiptQueueStatus
          key={currentQueueItem.id}
          item={currentQueueItem}
          total={queueTotal}
          copy={copy}
          onClose={closeReceiptQueue}
          onRetry={() => retryQueueItem(currentQueueItem)}
          onSkip={() => setReceiptQueue((items) => items.filter((item) => item.id !== currentQueueItem.id))}
        />
      )}

      {confirmState && (
        <ConfirmDialog
          title={confirmState.title}
          message={confirmState.message}
          confirmLabel={confirmState.confirmLabel}
          cancelLabel={confirmState.cancelLabel}
          danger={confirmState.danger}
          onConfirm={confirmState.onConfirm}
          onCancel={() => setConfirmState(null)}
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
