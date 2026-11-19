# BuildOps Platform

Internal management platform for a group of construction, urban development and real estate companies.
A single app for **Android, iOS and web**, built in stages.

| Stage | Module | Status |
| --- | --- | --- |
| 0 | Discovery: access to current systems and data mapping | planned |
| 1 | **Inventory control** | in development |
| 2 | Daily site report (audio, photos and AI) | planned |
| 3 | Schedule linked to the site report and inventory | planned |

## What the platform will deliver

### Integrations with current systems

Each company in the group runs its own legacy system today.
BuildOps does not replace them on day one — it reads from them first.

- **Read before replace.** Data from legacy systems is pulled in with `source = 'integration'`
  (or `'import'` for spreadsheets) and tagged with `external_system` + `external_ref`, so the same
  record is never imported twice. The legacy systems remain the source of truth for their own data.
- **One consolidated view.** Materials, cost centers and job sites from all companies land in a single
  database, so leadership sees the whole group while each manager sees only their own scope.
- **Same access rules everywhere.** Permissions are enforced in the database (Row Level Security),
  so the mobile app, the web dashboard and the integrations all follow the same rules.
- Stage 0 maps what each system exposes (API, database or exports) before any integration is built.

### AI assistant for the site foreman

The foreman (*mestre de obras*) is the person on site all day, and the one with the least time for
typing into forms. The AI is there to turn what they say and photograph into structured data.

- **Daily site report by voice.** The foreman records the day by audio, text and photos — also
  offline. The AI transcribes and organizes it into a standard report: work performed, crew,
  weather, incidents and open issues. The office receives it the same day.
- **Inventory from the report.** Materials mentioned in the report ("used 40 bags of cement on
  slab 3") are matched to the catalog and suggested as stock withdrawals for the right job site and
  cost center, instead of being entered by hand.
- **Low-stock and shortage alerts.** The AI cross-checks consumption against current balances and
  minimum levels and warns when a material is running out — and, once the schedule is in place
  (Stage 3), when the next task is missing material.
- **Human in the loop.** Nothing the AI produces becomes an official record until a person reviews
  and confirms it. Stock movements stay immutable and fully traceable.

## Stack

- **App**: [Expo](https://expo.dev) + React Native + TypeScript, with Expo Router. One codebase for Android, iOS and web.
- **Backend**: [Supabase](https://supabase.com): Postgres, authentication, photo storage and Row Level Security (RLS) per company and cost center.
- **Monorepo**: pnpm workspaces.

## Structure

```
apps/
  mobile/            Expo app (Android, iOS and web)
packages/
  shared/            Shared types and domain rules
supabase/
  migrations/        Database schema (versioned SQL)
  functions/         Edge Functions (admin-users: create and block accounts)
  tests/             Database tests (pgTAP)
  seed.sql           Sample data for development
docs/
  architecture.md    Architecture overview, technical decisions and glossary
  inventory.md       Inventory module scope and rules
```

## Getting started

Prerequisites: Node.js 20+, pnpm 12+ and Docker Desktop (for local Supabase).
The Supabase CLI is a project dependency and runs via `pnpm supabase`.

```bash
pnpm install

# local database with schema and sample data
pnpm db:start            # first run downloads the Docker images
pnpm db:reset            # reapplies migrations + seed (wipes local data)
pnpm db:users            # test users for each access level (see below)

# app
cp apps/mobile/.env.example apps/mobile/.env   # set the PUBLISHABLE_KEY from `pnpm supabase status`
pnpm dev                  # QR code for Expo Go; press "w" to open in the browser
```

After pulling new migrations into an existing local database, apply them without wiping your data
with `pnpm supabase migration up`, then run `pnpm db:users` again: it only creates the test users
that are missing.

Changes to `supabase/config.toml` (such as closing public sign-up for user management) only take
effect after restarting the stack: `pnpm supabase stop` then `pnpm db:start`. This keeps your local
data; never add `--no-backup` to `stop`. The restart also starts the Edge Functions runtime that
serves `supabase/functions/admin-users`.

### User management

Public sign-up is disabled. Directors create users in the app under Cadastros > Usuários, with an
initial password the user must change on first login; they also grant and remove access and block
or unblock logins. See [User management](docs/inventory.md#user-management).

Tests: `pnpm test` (shared logic), `pnpm db:test` (database rules) and `pnpm test:functions` (the
admin-users Edge Function). The last two need the local stack running; `test:functions` also needs
`pnpm db:users`.

To test on a phone with Expo Go, set `EXPO_PUBLIC_SUPABASE_URL` in `apps/mobile/.env` to the
computer's LAN IP (e.g. `http://192.168.1.9:54321`) instead of `127.0.0.1`, and keep the Wi-Fi
network profile as Private so the firewall lets the phone in.

On Windows, a running `pnpm dev` may write wrong typed routes for newly added screens (e.g.
`/master-data/cost-centers/index` instead of `/master-data/cost-centers`), which breaks
`pnpm typecheck`. Restarting `pnpm dev` regenerates them correctly.

### Test users

All with password `buildops123`. Companies and cost centers come from `supabase/seed.sql`.

| Email | Role | Scope | What to try |
| --- | --- | --- | --- |
| `diretoria@buildops.test` | Director | Whole group | Everything, including transfers between companies, the "Empresa" balance view and user management |
| `gestor@buildops.test` | Manager | Construtora Exemplo | Adjustments, transfers within the company, sites and cost centers |
| `gestor.jardim@buildops.test` | Manager | Construtora Exemplo, OB-001 only | Can't move stock charged to other cost centers |
| `almox@buildops.test` | Storekeeper | Construtora Exemplo | Receipts and issues, materials, warehouses and minimum stock; no transfers or cost centers |
| `mestre@buildops.test` | Foreman | Construtora Exemplo, OB-001 | Issues only, charged to Residencial Jardim; history shows only OB-001 |
| `mestre.central@buildops.test` | Foreman | Construtora Exemplo, OB-002 | Issues only, charged to Edifício Central; history shows only OB-002 |
| `gestor.urbanismo@buildops.test` | Manager | Urbanismo Exemplo | Sees only the other company's stock |
| `almox.urbanismo@buildops.test` | Storekeeper | Urbanismo Exemplo | Same, as storekeeper |
| `semacesso@buildops.test` | None | Nothing | Empty screens; no actions offered |

When upgrading the Expo SDK, run `pnpm --filter mobile exec expo install --fix` to align dependencies.

## Documentation

- [Architecture](docs/architecture.md)
- [Inventory module](docs/inventory.md)

Code, documentation and commit messages are in English. The app's on-screen text is in Brazilian
Portuguese for its end users; see the glossary in the architecture doc.
