# Architecture

## Overview

```
 Phone (Android/iOS) ─┐
                      ├─► Expo app ──► Supabase ──► Postgres (RLS per company and cost center)
 Browser (web) ───────┘                  │            Storage (invoice and material photos)
                                         │            Auth (login and profiles)
                                         ▼
                            Integrations (read from legacy systems)
```

- **One codebase, three platforms.** Site crews use their phones; the office uses the browser.
- **Read before replace.** Data from each company's current systems comes in with
  `source = 'integration'` (or `'import'` for spreadsheets), identified by
  `external_system` + `external_ref`. The legacy systems remain the source of truth for their own data.
- **Company and cost center on everything.** Every movement carries a company and a cost center.
  Access is enforced in the database through RLS policies, not only in the UI.
- **Group-owned data.** The production Supabase project lives in an account contracted in the group's name.

## Decisions

| Decision | Reason |
| --- | --- |
| Expo + React Native | One codebase for Android, iOS and web; store releases with EAS. |
| Supabase | Managed Postgres with auth, storage and RLS; no custom server to maintain. |
| Access rules in the database (RLS) | The same control applies to the app, the web dashboard and integrations. |
| Immutable movements | Traceability: corrections become adjustments, never edits to history. |
| Computed balance, not stored | A single source of truth; balance and history never diverge. If volume grows, a balance table maintained by trigger can be added. |
| pnpm monorepo | App, shared types and database versioned together. |
| English code, Portuguese UI | Code, docs and commits are in English. On-screen text is in Brazilian Portuguese for the end users. |

## Roles

| Role | UI label (pt-BR) | Scope | Can |
| --- | --- | --- | --- |
| `director` | Diretoria | Whole group | Everything, including transfers between companies and access management |
| `manager` | Gestor | Company or cost center | Master data, inventory adjustments, authorize transfers within the company |
| `storekeeper` | Almoxarife | Company or cost center | Receipts, issues, warehouses, minimum stock, materials |
| `foreman` | Mestre de obras | Company or cost center | Record issues (consumption) |

A user can have more than one membership (`memberships`), for example manager in one company and
storekeeper in another.

## Glossary

| English (code) | Portuguese (UI and business) |
| --- | --- |
| company | empresa |
| cost center | centro de custo |
| site | obra |
| warehouse | depósito / almoxarifado / canteiro |
| movement | movimentação / lançamento |
| receipt (`in`) | entrada |
| issue (`out`) | saída |
| inventory adjustment | ajuste de inventário |
| transfer | transferência |
| invoice | nota fiscal |
