# belegbox

Multi-user receipt manager for the `Aufwendungen für Arbeitsmittel` field in the German Anlage N workflow. The Worker is the source of truth for structured receipt data in D1 and private originals in R2. Exports are hand-off artifacts for manual entry and receipt upload in ELSTER; there is no ELSTER submission integration.

Production: <https://belegbox.seiffert.me>

## Architecture

- Cloudflare Worker with Hono routes and a Vite/React static asset build
- D1 for receipt rows and annual tax configuration
- Private R2 bucket for PDF/image originals
- Workers AI for optional, non-persisted OCR suggestions
- Cloudflare Access for OAuth authentication
- `jose` verification of every Access JWT in the Worker

The static asset configuration uses `run_worker_first: true`. Consequently, HTML, JavaScript, API requests, exports, and receipt previews all pass through the same JWT middleware. R2 has no public URL.

## Local development

Requirements: Node.js 22 or newer.

```sh
npm install
cp .dev.vars.example .dev.vars
npm run dev
```

The local auth identity is available only in a Vite development build, only on `localhost`/`127.0.0.1`, and only while both Access values are empty. Setting `ACCESS_AUD` or `ACCESS_TEAM_DOMAIN` makes local auth fail closed. There is no deployed auth bypass.

Useful checks:

```sh
npm run typecheck
npm test
npm run build
```

Apply local D1 migrations with:

```sh
npx wrangler d1 migrations apply belegbox --local
```

## Access security boundary

The global middleware:

1. Reads `Cf-Access-Jwt-Assertion`, falling back to the `CF_Authorization` cookie.
2. Fetches and caches `https://<team-name>.cloudflareaccess.com/cdn-cgi/access/certs`.
3. Allows only RS256 and verifies the signature with `jose`.
4. Requires exact issuer, an exact singleton audience containing only the configured tag, `exp`, `iat`, `nbf`, `email`, and `sub` claims.
5. Maps the verified issuer and subject claims to a stable internal user UUID.
6. Requires that UUID on every receipt, year-setting, file, and export query. Email is display metadata, not the authorization key.

Any failure returns HTTP 401 before routing to APIs, R2, exports, or static assets.

## Cloudflare provisioning

Never put the API token, Access values, OAuth secret, `.dev.vars`, or account ID in this repository. Export credentials in the shell that runs Wrangler:

```sh
export CLOUDFLARE_API_TOKEN="<token>"
npx wrangler whoami
export CLOUDFLARE_ACCOUNT_ID="<account-id-from-whoami>"
```

Provision in this order.

### 1. D1

Command used to create the database:

```sh
npx wrangler d1 create belegbox
```

Copy the returned `database_id` into `wrangler.jsonc`, replacing `REPLACE_AFTER_D1_CREATE`.

### 2. R2

Command used to create the private bucket:

```sh
npx wrangler r2 bucket create belegbox-belege
```

Do not enable an `r2.dev` domain or public custom domain.

### 3. Remote schema

Command used to apply checked-in migrations:

```sh
npx wrangler d1 migrations apply belegbox --remote
```

The migration seeds annual values as D1 data rather than application constants. Review these values for the relevant filing year; this project does not provide tax advice.

### 4. Access application and OAuth

Cloudflare Wrangler does not provide commands for creating Access applications or identity providers. Configure these in **Cloudflare Zero Trust**:

1. Go to **Settings -> Authentication -> Login methods** and add GitHub or Google using the OAuth client ID and secret.
2. Go to **Access -> Applications -> Add an application -> Self-hosted**.
3. Set the application hostname to the exact deployed Worker hostname, covering every path.
4. Set session duration to `24 hours`.
5. Restrict the application to the selected GitHub/Google login method.
6. Add an `Allow` policy for the SSO users or groups that should be able to sign in. The application creates a separate private workspace for each authenticated Access subject; there is currently no role-based access control or sharing.
7. Do not add Bypass policies and do not enable preflight bypass.

The hostname, owner email, OAuth credentials, and identity provider selection are operator-supplied values and are intentionally absent from source control.

After creation, find the audience at:

**Zero Trust -> Access -> Applications -> Overview -> Application Audience (AUD) Tag**

### 5. Worker-only Access configuration

Set both values through Wrangler's interactive secret prompt so they stay out of shell history, `wrangler.jsonc`, and the frontend bundle:

```sh
npx wrangler secret put ACCESS_TEAM_DOMAIN
npx wrangler secret put ACCESS_AUD
```

Enter the team domain as `https://<team-name>.cloudflareaccess.com` and the exact Application Audience tag. `keep_vars: true` preserves these remotely managed Worker values on later deploys.

AI text recognition is enabled in production through the Worker-only `AI_PREFILL_ENABLED` variable. PNG, JPEG, and WebP receipts are processed with the Workers AI Moondream 3.1 vision model. The model extracts editable seller, address, invoice number, date, gross total, payment method, and item-description suggestions.

Suggestions are returned to the edit form but never written to D1 until the user explicitly saves the record. The UI reports disabled, unsupported, oversized, empty, and provider-error states instead of silently treating them as an empty result. Local development keeps AI disabled by default in `.dev.vars.example` to avoid accidental model calls.

### 6. Deploy

Production deploys run through Cloudflare Workers Builds on pushes to `main`:

```sh
npm run check
npx wrangler deploy --config dist/belegbox/wrangler.json --keep-vars
```

The first command is the Workers Builds build command and the second is its deploy command. The Vite plugin generates the deployable Worker configuration under `dist/belegbox`; deploying the source `wrangler.jsonc` directly does not point Wrangler at the built assets. The same commands can be run locally for a manual deployment.

There is no Pages or GitHub Actions deployment configuration.

## Resource inventory

| Resource | Binding/name | Reproduction |
| --- | --- | --- |
| Worker | `belegbox` / `belegbox.seiffert.me` | `npm run build`, then `npx wrangler deploy --config dist/belegbox/wrangler.json --keep-vars` |
| Static assets | `ASSETS` | Created with the Worker deployment |
| D1 | `DB` / `belegbox` | `npx wrangler d1 create belegbox` |
| R2 | `RECEIPTS` / `belegbox-belege` | `npx wrangler r2 bucket create belegbox-belege` |
| Workers AI | `AI` | Added as a binding by Worker deployment |
| Access app | Operator-selected hostname | Zero Trust dashboard steps above |

## Data and exports

Each receipt belongs to one internal UUID owner and stores integer cents, a 0-100 professional-use percentage, and a generated deductible amount. The only annual setting is the low-value asset immediate write-off threshold (`GWG`) in `tax_year_config`.

An amount above the configured immediate write-off threshold is marked `gwg_flag`. Its computed professional share remains visible, but the dashboard and exports count it as zero and show a clear depreciation warning. The app never silently treats it as an immediate full deduction.

Access identities are keyed by exact issuer and subject claims in `users`. Receipt and annual-setting rows use `owner_id`; private R2 objects are stored below `receipts/<owner-uuid>/`. Email changes do not merge accounts, and one user cannot address another user's D1 rows or R2 keys through any API route.

Authenticated export routes produce:

- `belege-<year>.zip`: streamed original files with ELSTER-oriented names
- `anlage-n-<year>.pdf`: printable itemized work-equipment summary
- `anlage-n-<year>.csv`: stable integer-cent backup rows
- `anlage-n-<year>.json`: canonical backup that can be re-imported

JSON re-import restores structured metadata as new records. Original binaries must be retained in the ZIP and uploaded separately because they are not embedded in JSON.

## Source control

`.gitignore` excludes `.dev.vars`, `.env*`, `.wrangler/`, build output, dependencies, and logs. Before committing:

```sh
git status --short
git diff --check
npm run check
```
