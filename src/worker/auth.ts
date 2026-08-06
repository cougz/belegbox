import type { MiddlewareHandler } from "hono";
import {
  createRemoteJWKSet,
  jwtVerify,
  type CryptoKey,
  type JWTVerifyGetKey,
} from "jose";
import type { AppEnv, AuthIdentity } from "./types";

const jwksByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

type VerificationKey = CryptoKey | JWTVerifyGetKey;

export interface AccessConfig {
  teamDomain: string;
  audience: string;
}

function issuerFor(teamDomain: string): string {
  const domain = teamDomain.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!/^[a-z0-9.-]+\.cloudflareaccess\.com$/i.test(domain)) {
    throw new Error("Invalid Access team domain");
  }
  return `https://${domain}`;
}

function remoteKeySet(issuer: string) {
  let jwks = jwksByIssuer.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    jwksByIssuer.set(issuer, jwks);
  }
  return jwks;
}

export async function verifyAccessJwt(
  token: string,
  config: AccessConfig,
  key?: VerificationKey,
  now = new Date(),
): Promise<AuthIdentity> {
  const issuer = issuerFor(config.teamDomain);
  const { payload } = await jwtVerify(token, key ?? remoteKeySet(issuer), {
    algorithms: ["RS256"],
    audience: config.audience,
    issuer,
    currentDate: now,
    requiredClaims: ["aud", "iss", "exp", "iat", "nbf", "email", "sub"],
  });

  const nowSeconds = Math.floor(now.getTime() / 1000);
  const exactAudience =
    payload.aud === config.audience ||
    (Array.isArray(payload.aud) && payload.aud.length === 1 && payload.aud[0] === config.audience);
  if (
    !exactAudience ||
    typeof payload.iat !== "number" ||
    payload.iat > nowSeconds ||
    typeof payload.email !== "string" ||
    !payload.email ||
    typeof payload.sub !== "string" ||
    !payload.sub
  ) {
    throw new Error("Invalid Access claims");
  }

  return { email: payload.email, subject: payload.sub, issuer };
}

export function accessToken(request: Request): string | null {
  const assertion = request.headers.get("Cf-Access-Jwt-Assertion")?.trim();
  if (assertion) return assertion;

  const cookies = request.headers.get("Cookie") ?? "";
  for (const part of cookies.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === "CF_Authorization" && value.length) {
      const token = value.join("=");
      try {
        return decodeURIComponent(token);
      } catch {
        return token;
      }
    }
  }
  return null;
}

type Verifier = (token: string, config: AccessConfig) => Promise<AuthIdentity>;

export function accessMiddleware(verifier: Verifier = verifyAccessJwt): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const env = c.env ?? {};
    const teamDomain = env.ACCESS_TEAM_DOMAIN?.trim() ?? "";
    const audience = env.ACCESS_AUD?.trim() ?? "";
    const hostname = new URL(c.req.url).hostname;
    const localDevelopment =
      import.meta.env.DEV &&
      (hostname === "localhost" || hostname === "127.0.0.1") &&
      !teamDomain &&
      !audience;

    if (localDevelopment) {
      c.set("identity", {
        email: env.DEV_AUTH_EMAIL?.trim() || "local@belegbox.invalid",
        subject: "local-development",
        issuer: "local-development",
      });
      await next();
      return;
    }

    if (!teamDomain || !audience) {
      return c.json({ error: "Access is not configured" }, 401);
    }

    const token = accessToken(c.req.raw);
    if (!token) return c.json({ error: "Unauthorized" }, 401);

    try {
      c.set("identity", await verifier(token, { teamDomain, audience }));
      await next();
    } catch {
      return c.json({ error: "Unauthorized" }, 401);
    }
  };
}
