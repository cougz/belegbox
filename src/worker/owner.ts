import type { MiddlewareHandler } from "hono";
import type { AppEnv, AuthIdentity, Owner } from "./types";

interface UserRow {
  id: string;
  email: string;
}

export async function ensureOwner(db: D1Database, identity: AuthIdentity): Promise<Owner> {
  let user = await db.prepare(
    "SELECT id, email FROM users WHERE access_issuer = ? AND access_subject = ?",
  ).bind(identity.issuer, identity.subject).first<UserRow>();

  if (!user) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    user = await db.prepare(
      `INSERT INTO users (id, access_issuer, access_subject, email, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(access_issuer, access_subject) DO UPDATE SET
         email = excluded.email,
         updated_at = excluded.updated_at
       RETURNING id, email`,
    ).bind(id, identity.issuer, identity.subject, identity.email, now, now).first<UserRow>();
    if (!user) throw new Error("Could not create user");
    await db.prepare("UPDATE receipts SET owner_email = ? WHERE owner_id = ?")
      .bind(identity.email, user.id).run();
  } else if (user.email !== identity.email) {
    await db.batch([
      db.prepare("UPDATE users SET email = ?, updated_at = ? WHERE id = ?")
        .bind(identity.email, new Date().toISOString(), user.id),
      db.prepare("UPDATE receipts SET owner_email = ? WHERE owner_id = ?")
        .bind(identity.email, user.id),
    ]);
    user = { id: user.id, email: identity.email };
  }

  await db.prepare(
    `INSERT INTO tax_year_config (owner_id, tax_year, gwg_limit_cents, updated_at)
     SELECT ?, tax_year, gwg_limit_cents, updated_at FROM tax_year_defaults WHERE 1
     ON CONFLICT(owner_id, tax_year) DO NOTHING`,
  ).bind(user.id).run();

  return user;
}

export const ownerMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("owner", await ensureOwner(c.env.DB, c.get("identity")));
  await next();
};
