# Sundar Bagaicha Events — POS & Management System

Restaurant POS, double-entry accounting and venue management for
**Sundar Bagaicha Events**, 12 Bhabhar, Birendranagar, Surkhet.

Next.js (App Router) + PostgreSQL, served by a custom `server.js` for
cPanel/Node hosting. Every accounting figure is derived from a single
double-entry journal — no stored balances.

See **[SYSTEM_OVERVIEW.md](SYSTEM_OVERVIEW.md)** for the full module-by-module
map, and **[docs/](docs/)** for deployment, schema and QA references.

---

## Quick start

```bash
npm install

# PostgreSQL (production and any shared environment)
export DATABASE_URL=postgresql://user:pass@localhost:5432/dbname
npm run db:migrate      # apply migrations/*.sql in order
npm run db:seed         # chart of accounts, settings, menu, tables

npm run dev             # http://localhost:3002
```

Without `DATABASE_URL` the app falls back to a local SQLite file seeded with
demo data — development only, never production.

## NPM scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Development server on port 3002 |
| `npm run build` | Production build |
| `npm start` | Production server (`server.js`) |
| `npm run lint` | ESLint |
| `npm run test:unit` | Node test runner (`tests/unit`) |
| `npm run test:e2e` | Playwright acceptance tests |
| `npm run db:migrate` | Apply SQL migrations |
| `npm run db:seed` | Seed a fresh PostgreSQL database |
| `npm run health` | Environment/DB health check |
| `npm run import:menu` | Sync the menu into an existing database |

## Roles

PIN-based sign-in with four roles — **admin**, **cashier**, **waiter**,
**kitchen** — plus a public customer surface (landing page, menu, QR table
ordering). Route access is role-gated; a curated set of sensitive actions
(void, refund, discount, cancel) is admin-configurable under
Admin → Staff Permissions.

## Menu data

`data/menu/sundar-bagaicha-menu.json` is the single source of truth for the
menu, transcribed verbatim from the venue's own printed food and liquors
cards. It drives two consumers:

- `node scripts/menu/build-menu-seed.mjs` — regenerates the menu block of
  `deploy/production_seed.sql` for fresh installs.
- `npm run import:menu` — idempotent upsert into an existing database, keyed
  by `source_ref`. `--dry-run` diffs without writing; `--deactivate-unmanaged`
  hides (never deletes) rows outside the import.

Price conflicts between the two printed cards are recorded in the JSON's
`conflicts` block and repeated in the generated seed, so they can be
confirmed with the venue rather than silently resolved.

## Branding

Business identity lives in two places:

- `lib/restaurant-info.js` — build-time defaults for page titles, metadata,
  Open Graph and print fallbacks.
- `system_settings` rows (Admin → Settings) — the values that actually print
  on receipts and invoices at runtime.

Public website copy is editable under Admin → Website CMS; defaults come from
`lib/cms.js`.

## Deployment

`deploy/INSTALL.md` covers a fresh cPanel/Node install:
`deploy/production_schema.sql`, then `deploy/production_seed.sql`, then
`npm run db:migrate` for anything newer. Copy `.env.example` to `.env` and
fill in real values — never commit credentials.
