import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { sameOriginMiddleware } from "./index";
import type { AppEnv } from "./types";

describe("same-origin mutation protection", () => {
  const app = new Hono<AppEnv>();
  app.use("*", sameOriginMiddleware);
  app.post("/write", (c) => c.json({ ok: true }));

  it("accepts a same-origin mutation", async () => {
    const response = await app.request("https://app.example/write", {
      method: "POST",
      headers: { Origin: "https://app.example" },
    });
    expect(response.status).toBe(200);
  });

  it("rejects cross-origin and missing-origin mutations", async () => {
    const crossOrigin = await app.request("https://app.example/write", {
      method: "POST",
      headers: { Origin: "https://attacker.example" },
    });
    const missingOrigin = await app.request("https://app.example/write", { method: "POST" });
    expect(crossOrigin.status).toBe(403);
    expect(missingOrigin.status).toBe(403);
  });
});
