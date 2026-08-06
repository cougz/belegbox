import { describe, expect, it } from "vitest";
import { parseReceiptSuggestions } from "./ocr";

describe("receipt OCR parsing", () => {
  it("parses Moondream JSON answers", () => {
    expect(parseReceiptSuggestions({
      answer: '{"seller_name":"Büro Markt","seller_address":"Hauptstr. 1, Berlin",' +
        '"invoice_number":"RE-42","expense_date":"2026-08-06","amount_cents":12999,' +
        '"payment_method":"Visa","description":"27-inch monitor"}',
    })).toEqual({
      seller_name: "Büro Markt",
      seller_address: "Hauptstr. 1, Berlin",
      invoice_number: "RE-42",
      expense_date: "2026-08-06",
      amount_cents: 12999,
      payment_method: "Visa",
      description: "27-inch monitor",
    });
  });

  it("extracts fenced JSON and normalizes German dates", () => {
    expect(parseReceiptSuggestions({
      answer: 'Result:\n```json\n{"seller_name":"Shop","expense_date":"6.8.2026","amount_cents":"4999"}\n```',
    })).toEqual({ seller_name: "Shop", expense_date: "2026-08-06", amount_cents: 4999 });
  });

  it("normalizes common model amount formats", () => {
    expect(parseReceiptSuggestions({
      answer: '{"seller_name":"Shop","amount_cents":"1.299,95 €"}',
    })).toEqual({ seller_name: "Shop", amount_cents: 129995 });
    expect(parseReceiptSuggestions({ answer: '{"amount_cents":12.99}' }))
      .toEqual({ amount_cents: 1299 });
  });

  it("accepts the REST API's nested result envelope", () => {
    expect(parseReceiptSuggestions({
      result: { answer: '{"seller_name":"Nested Shop","amount_cents":2500}' },
    })).toEqual({ seller_name: "Nested Shop", amount_cents: 2500 });
  });

  it("rejects malformed, guessed, and incorrectly typed fields", () => {
    expect(parseReceiptSuggestions({ answer: "No receipt fields visible" })).toBeNull();
    expect(parseReceiptSuggestions({
      answer: '{"seller_name":null,"expense_date":"yesterday","amount_cents":"about twelve euros"}',
    })).toBeNull();
  });
});
