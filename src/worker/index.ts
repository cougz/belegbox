import { Hono, type MiddlewareHandler } from "hono";
import { accessMiddleware } from "./auth";
import { api } from "./api";
import { exportsApi } from "./exports";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>();

app.use("*", accessMiddleware());
export const sameOriginMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method)) {
    const url = new URL(c.req.url);
    const expectedOrigin = `${url.protocol}//${url.host}`;
    if (c.req.header("Origin") !== expectedOrigin) {
      return c.json({ error: "Ungueltiger Anfrageursprung" }, 403);
    }
  }
  await next();
};
app.use("*", sameOriginMiddleware);
app.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", c.res.headers.get("Cache-Control") ?? "private, no-store");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", c.res.headers.get("X-Frame-Options") ?? "DENY");
});

app.route("/api", api);
app.route("/api/exports", exportsApi);

app.all("/api/*", (c) => c.json({ error: "API-Endpunkt nicht gefunden" }, 404));

app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

app.onError((error, c) => {
  console.error("Request failed", error instanceof Error ? error.message : "Unknown error");
  return c.json({ error: "Interner Fehler" }, 500);
});

export default app;
