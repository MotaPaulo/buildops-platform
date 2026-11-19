---
title: 'Web dashboard: movements report with filters and Excel export'
type: feature
ticket: ''
created: '2026-11-19'
status: built
baseline_revision: '8a74ba9eabfe5cb1ed31a397f1b51a7b6289d8ed'
route: full
route_source: auto
risk: medium
review: quick
review_source: pinned
lenses_ran: [quick]
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Office staff and directors can only browse movements one by one in the phone-style history. There is no way to filter by period, company, cost center or material, and no way to take movements or balances to Excel, which is how the companies report today (Stage 1 item "Web dashboard with filters and Excel export").

**Approach:** Add a "Relatório" screen with a wide, table layout on the web. It filters movements by period, company, warehouse, cost center, material and kind, shows the total and the matching rows, and exports the filtered movements and the current stock balances to `.xlsx`. All data is read under the user's own session, so RLS decides what each profile sees.

## Boundaries & Constraints

**Always:** Every query runs with the signed-in user's token (RLS). Exported rows match the on-screen filters exactly. Quantities are signed the same way as the history (`signedQuantity`). Use English for code, docs and commits, and pt-BR on screen and for spreadsheet headers. Keep test users per access level and never wipe local data.

**Never:** No new database privileges, security definer functions or service-role use. No charts or analytics dashboards in this change. No scheduled or e-mailed reports. Never export more rows than the user can see on screen with the same filters.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Filter and export | director; period + company + material | table and `.xlsx` hold the same rows, newest first, with pt-BR headers | No error expected |
| Restricted profile | foreman of OB-001 exports with no filters | only OB-001 movements appear (RLS) | No error expected |
| Invalid period | start after end, or an unparseable date | nothing queried | "A data inicial precisa ser anterior à final." / "Data inválida." |
| Too many rows | filters match more than the export limit | export refused, user asked to narrow the period | "São N movimentações; o limite para exportar é 10.000. Reduza o período." |
| No rows | filters match nothing | empty table, export disabled | "Nenhuma movimentação encontrada." |
| Balances export | any profile with access | `.xlsx` with one row per warehouse and material the user can see, minimum and below-minimum flag | No error expected |

## Decisions

- Excel export is browser-only. On the phone the report is view-only, and the export buttons say "Exportação disponível no navegador." No new native modules.

</frozen-after-approval>

## Code Map

- `apps/mobile/app/(app)/history/index.tsx` -- current movement list: query shape (`stock_movements` + `MOVEMENT_SELECT`, `.range`, `.in('kind')`), `KIND_FILTERS` (transfers = `transfer_out`+`transfer_in`), request-id guard against stale responses. Reuse the patterns; don't change this screen.
- `apps/mobile/src/lib/movements.ts` -- `MovementRow`, `MOVEMENT_SELECT`, `movementTitle`, `formatQty`, `formatDateTime`. Add a report select that also embeds `company:companies(name)` (`stock_movements.company_id` exists) rather than changing `MOVEMENT_SELECT`.
- `apps/mobile/app/(app)/index.tsx` -- balances screen; `HeaderActions` shows "Histórico"/"Cadastros" links (add "Relatório" for users with memberships). `get_stock_balances` RPC returns `StockBalance` (`packages/shared/src/inventory.ts:214`); site and company names come from `sites`/`companies` tables as done there.
- `apps/mobile/src/components/form.tsx` -- `Chips`, `formStyles`, `ACCENT`, `Field`; reuse for filters.
- `apps/mobile/src/lib/data.ts` -- `rows()` unwraps Supabase results and throws on error.
- `apps/mobile/src/lib/access.ts` -- `useMemberships()`.
- `apps/mobile/app/(app)/_layout.tsx` -- register the new screen inside the existing protected stack (title "Relatório").
- `packages/shared/src/inventory.ts` -- `MOVEMENT_LABELS`, `signedQuantity`, `StockBalance`; `packages/shared/src/index.ts` re-exports modules.
- `docs/inventory.md` line ~21 -- checklist item to tick; also tick "User and membership management by the directors" (delivered in 622fd4b, left unchecked).
- Expo web: `Platform.OS === 'web'`; `useWindowDimensions()` for the wide layout (≥ 900 px table, else cards like the history).
- Windows note: the running Expo watcher may miss new files and write wrong typed routes; regenerate typed routes or run a separate `expo start --web --port 8082` for browser checks.

## Tasks & Acceptance

**Execution:**
- [x] `packages/shared/src/reports.ts` (+ `reports.test.ts`) -- `parseDateBR('dd/mm/aaaa')`, `validatePeriod(from, to)` (pt-BR messages from the matrix; the end date is inclusive, so the query uses `< end + 1 day`), `MOVEMENT_EXPORT_LIMIT = 10000`, `movementSheetRows(rows, labels)` and `balanceSheetRows(balances, names)` returning header + row arrays with pt-BR headers -- pure logic tested with vitest.
- [x] `apps/mobile/src/lib/movements.ts` -- `REPORT_SELECT` (= `MOVEMENT_SELECT` + `company:companies(name)`) and `MovementRow.company?` -- company column in report and export.
- [x] `apps/mobile/src/lib/excel.ts` -- `downloadXlsx(fileName, sheets)` on the web using a pure-JS xlsx writer (e.g. `write-excel-file`, pinned exact version, no native module); on native shows "Exportação disponível no navegador." -- Excel file in the browser.
- [x] `apps/mobile/app/(app)/report.tsx` -- filters (period defaulting to the last 30 days, company when > 1, warehouse and cost center limited to the chosen company, material, kind), `count: 'exact'` total, first 200 rows in a table (wide) or cards (narrow), "Exportar movimentações" (fetches all matching rows in pages of 1000, refuses above the limit) and "Exportar saldos" -- the dashboard.
- [x] `apps/mobile/app/(app)/index.tsx`, `apps/mobile/app/(app)/_layout.tsx` -- "Relatório" header link for users with memberships; register the route.
- [x] `docs/inventory.md`, `README.md` -- describe the report and export; tick both checklist items.

**Acceptance Criteria:**
- Given the director on the web, when they filter by a period and a material and export, then the downloaded `.xlsx` opens in Excel with the same rows and totals as the screen.
- Given `mestre@buildops.test`, when they open "Relatório", then only OB-001 movements and the warehouses they can see are listed and exported.
- Given `semacesso@buildops.test`, when they sign in, then no "Relatório" link is shown.
- Given a narrow phone screen, when the report opens, then it is readable (cards) and filtering works.

## Design Notes

Export fetches pages with the same filter builder the screen uses, so the screen and the file can't drift. Build the query in one function, e.g. `buildQuery(filters).range(a, b)`. The movement sheet uses signed quantities and these columns: Data, Tipo, Empresa, Depósito, Centro de custo, Material, Unidade, Quantidade, Custo unitário, Nota fiscal, Registrado por, Origem, Observações. Dates go in as real date cells.

## Verification

**Commands:**
- `pnpm typecheck && pnpm test && pnpm db:test` -- expected: all pass.

**Manual checks (if no CLI):**
- Browser e2e (headless Edge) as director, `mestre@buildops.test` and `semacesso@buildops.test`: filter, check the row count, export both files and read them back (headers, row count, signed quantities).

## Implementation Notes

- Implemented by a fresh subagent from this plan. Excel writer: `write-excel-file@4.1.1` (`/universal` entry, pure JS); `excel.web.ts` for the browser, `excel.ts` for native (message only, library never loaded).
- Step 3 (orchestrator): verification passed (typecheck, 62 unit tests, 39 pgTAP tests). Matrix audit: the over-limit refusal was decided inline in the screen with no test, so it moved into `exportLimitError()` (shared, unit-tested). The "No rows" row was checked in the browser: empty message shown and export button disabled.
- Choices left to the implementer: both dates required; "Exportar saldos" ignores the movement filters; a half-typed date shows "Data inválida."; kind labels and kind filters duplicated in shared because the history screen was out of scope.

## Plan Change Log

## Review Triage Log

### Pass 1 (quick) — 3 medium, 5 low, 0 false, 0 maybe-false; 1 low rejected

| # | Finding | Verdict | Route | Evidence / action |
| --- | --- | --- | --- | --- |
| 1 | A failed query keeps old rows on screen and hides the error | medium | patch | report.tsx catch paths set error/applied but never clear items; error shows only in ListEmptyComponent. Fix: clear items and total on error. |
| 2 | Restricted profiles get cost center chips they can never see movements for | medium | patch | cost_centers_select is company-wide, movements use has_cost_center_access. Fix: when every membership of a company is cost-center scoped, offer only those cost centers. Warehouses are fine: movements in any company warehouse can carry the user's cost center. |
| 3 | Balances export truncates at max_rows (1000) | medium | patch | get_stock_balances is set-returning; config max_rows = 1000; one unpaged call. Fix: page the RPC with range until a short page. |
| 4 | Movement export stops early if max_rows is below 1000 | low | patch | Loop ends on the first short page. Fix: keep paging until the first page's count is reached or a page is empty; fail if the totals differ. |
| 5 | On native the export buttons are replaced by a hint instead of saying the message | low | rejected | The phone shows "Exportação disponível no navegador." either way; the decision's intent (view-only, no native modules) holds. |
| 6 | Export file name built from raw input text | low | patch | " 5/3/2026 " gives spaces and no padding. Fix: build from the parsed dates. |
| 7 | Warehouse chips ambiguous across companies with "Todas" | low | patch | Same-named warehouses in two companies can't be told apart. Fix: append the company name when more than one company is listed. |
| 8 | /report opened directly by a user without access offers an export | low | patch | Fix: same "no access" text as the balances screen when memberships is empty. |

### Post-review verification

- After the patches: typecheck, 62 unit tests and 39 pgTAP tests pass.
- Browser e2e (headless Edge) on a fresh dev server: director (wide), foreman, narrow and no-access scenarios all pass. Screen totals match REST counts; xlsx rows match the screen; balances match the RPC. The foreman is offered only OB-001; a no-access user opening /report sees the no-access text; an empty period shows the message and disables export.
