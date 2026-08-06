import { Hono } from "hono";
import { generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { accessMiddleware, accessToken, verifyAccessJwt } from "./auth";
import type { AppEnv } from "./types";

const teamDomain = "belegbox.cloudflareaccess.com";
const issuer = `https://${teamDomain}`;
const audience = "expected-audience";
const nowSeconds = 1_800_000_000;
let privateKey: CryptoKey;
let publicKey: CryptoKey;

beforeAll(async () => {
  ({ privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true }));
});

function token(
  claims: Record<string, unknown> = {},
  key = privateKey,
): Promise<string> {
  return new SignJWT({
    email: "owner@example.com",
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer((claims.iss as string | undefined) ?? issuer)
    .setAudience((claims.aud as string | string[] | undefined) ?? audience)
    .setSubject("access-user")
    .setIssuedAt((claims.iat as number | undefined) ?? nowSeconds - 10)
    .setNotBefore((claims.nbf as number | undefined) ?? nowSeconds - 10)
    .setExpirationTime((claims.exp as number | undefined) ?? nowSeconds + 300)
    .sign(key);
}

const verify = async (value: string) =>
  verifyAccessJwt(value, { teamDomain, audience }, publicKey, new Date(nowSeconds * 1000));

describe("Access JWT verification", () => {
  it("accepts a valid RS256 token with Cloudflare's singleton audience array", async () => {
    await expect(verify(await token({ aud: [audience] }))).resolves.toEqual({
      email: "owner@example.com",
      subject: "access-user",
    });
  });

  it.each([
    ["wrong audience", { aud: "other-audience" }],
    ["audience array with an extra tag", { aud: [audience, "other-audience"] }],
    ["wrong issuer", { iss: "https://other.cloudflareaccess.com" }],
    ["expired token", { exp: nowSeconds - 1 }],
    ["future not-before", { nbf: nowSeconds + 1 }],
    ["future issued-at", { iat: nowSeconds + 1 }],
  ])("rejects %s", async (_label, claims) => {
    await expect(verify(await token(claims))).rejects.toThrow();
  });

  it("rejects a token signed by another key", async () => {
    const other = await generateKeyPair("RS256");
    await expect(verify(await token({}, other.privateKey))).rejects.toThrow();
  });
});

describe("Access middleware", () => {
  it("rejects missing configuration", async () => {
    const app = new Hono<AppEnv>();
    app.use("*", accessMiddleware());
    app.get("/", (c) => c.text("private"));
    const response = await app.request("https://app.example/");
    expect(response.status).toBe(401);
  });

  it("rejects missing and malformed assertions", async () => {
    const app = new Hono<AppEnv>();
    app.use(
      "*",
      accessMiddleware(async (value) => {
        if (value !== "valid") throw new Error("bad token");
        return { email: "owner@example.com", subject: "owner" };
      }),
    );
    app.get("/", (c) => c.json(c.get("user")));
    const env = { ACCESS_TEAM_DOMAIN: teamDomain, ACCESS_AUD: audience };

    expect((await app.request("https://app.example/", {}, env)).status).toBe(401);
    expect(
      (
        await app.request(
          "https://app.example/",
          { headers: { "Cf-Access-Jwt-Assertion": "malformed" } },
          env,
        )
      ).status,
    ).toBe(401);
  });

  it("uses the authorization cookie and exposes the email", async () => {
    const app = new Hono<AppEnv>();
    app.use(
      "*",
      accessMiddleware(async () => ({ email: "owner@example.com", subject: "owner" })),
    );
    app.get("/", (c) => c.json(c.get("user")));
    const response = await app.request(
      "https://app.example/",
      { headers: { Cookie: "other=x; CF_Authorization=valid" } },
      { ACCESS_TEAM_DOMAIN: teamDomain, ACCESS_AUD: audience },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ email: "owner@example.com" });
  });
});

it("prefers the assertion header over the cookie", () => {
  expect(
    accessToken(
      new Request("https://app.example", {
        headers: {
          "Cf-Access-Jwt-Assertion": "header-token",
          Cookie: "CF_Authorization=cookie-token",
        },
      }),
    ),
  ).toBe("header-token");
});
