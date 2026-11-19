// Movements report and Excel export: pure logic (period parsing, limits, spreadsheet rows).
// Spreadsheet headers and messages are pt-BR.
import { signedQuantity, type MovementKind, type StockBalance } from './inventory';

/** Most movements one export may hold; above it the user must narrow the filters. */
export const MOVEMENT_EXPORT_LIMIT = 10000;

/** Rows fetched per request while exporting (PostgREST's default max-rows). */
export const MOVEMENT_EXPORT_PAGE = 1000;

export const INVALID_DATE_MESSAGE = 'Data inválida.';
export const PERIOD_ORDER_MESSAGE = 'A data inicial precisa ser anterior à final.';

/** "São N movimentações; o limite para exportar é 10.000. Reduza o período." */
export function exportLimitMessage(count: number, limit = MOVEMENT_EXPORT_LIMIT): string {
  const fmt = (n: number) => n.toLocaleString('pt-BR');
  return `São ${fmt(count)} movimentações; o limite para exportar é ${fmt(limit)}. Reduza o período.`;
}

/** Refusal message when an export would exceed the limit, or null when it may proceed. */
export function exportLimitError(count: number, limit = MOVEMENT_EXPORT_LIMIT): string | null {
  return count > limit ? exportLimitMessage(count, limit) : null;
}

/** Report kind filter; transfers cover both sides. */
export const REPORT_KIND_FILTERS: { id: string; label: string; kinds: MovementKind[] }[] = [
  { id: 'all', label: 'Todos', kinds: [] },
  { id: 'in', label: 'Entradas', kinds: ['in'] },
  { id: 'out', label: 'Saídas', kinds: ['out'] },
  { id: 'transfer', label: 'Transferências', kinds: ['transfer_out', 'transfer_in'] },
  { id: 'adjustment', label: 'Ajustes', kinds: ['adjustment'] },
];

/** Parses "dd/mm/aaaa" as local midnight. Returns null for anything else (including 31/02/2026). */
export function parseDateBR(text: string): Date | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date;
}

/** Local date as "dd/mm/aaaa". */
export function formatDateBR(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

export type PeriodResult =
  | { ok: true; from: Date; toExclusive: Date }
  | { ok: false; error: string };

/**
 * Validates a "dd/mm/aaaa" period. The end date is inclusive, so the query uses
 * `occurred_at >= from` and `occurred_at < toExclusive` (the day after the end, local time).
 */
export function validatePeriod(fromText: string, toText: string): PeriodResult {
  const from = parseDateBR(fromText);
  const to = parseDateBR(toText);
  if (!from || !to) return { ok: false, error: INVALID_DATE_MESSAGE };
  if (from > to) return { ok: false, error: PERIOD_ORDER_MESSAGE };
  const toExclusive = new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1);
  return { ok: true, from, toExclusive };
}

/** Default report period: the last 30 days, today included. */
export function defaultPeriod(today = new Date()): { from: string; to: string } {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29);
  return { from: formatDateBR(start), to: formatDateBR(today) };
}

/**
 * Excel date cells carry no time zone and the writer converts with UTC, so shift the instant
 * to make the cell show the local wall-clock time.
 */
export function toSheetDate(iso: string): Date {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
}

// -----------------------------------------------------------------------------
// Spreadsheet rows
// -----------------------------------------------------------------------------

export type SheetCell = string | number | Date | null;

/** One worksheet: pt-BR header plus data rows, in the same column order. */
export interface SheetTable {
  header: string[];
  rows: SheetCell[][];
}

/** Fields of a movement read for the report (same shape as the app's MovementRow). */
export interface MovementSheetInput {
  kind: MovementKind;
  quantity: number | string;
  occurred_at: string;
  notes: string | null;
  invoice_number: string | null;
  unit_cost: number | string | null;
  source: 'app' | 'import';
  external_system: string | null;
  external_ref: string | null;
  material: { name: string; unit: string } | null;
  warehouse: { name: string } | null;
  cost_center: { code: string; name: string } | null;
  author: { full_name: string } | null;
  company?: { name: string } | null;
  transfer: { from: { name: string } | null; to: { name: string } | null } | null;
}

export const MOVEMENT_SHEET_HEADER = [
  'Data',
  'Tipo',
  'Empresa',
  'Depósito',
  'Centro de custo',
  'Material',
  'Unidade',
  'Quantidade',
  'Custo unitário',
  'Nota fiscal',
  'Registrado por',
  'Origem',
  'Observações',
];

const OTHER_COMPANY = 'outra empresa';

function movementType(m: MovementSheetInput, labels: Record<MovementKind, string>): string {
  if (m.kind === 'transfer_out') return `Transferência para ${m.transfer?.to?.name ?? OTHER_COMPANY}`;
  if (m.kind === 'transfer_in') return `Transferência de ${m.transfer?.from?.name ?? OTHER_COMPANY}`;
  return labels[m.kind];
}

function movementOrigin(m: MovementSheetInput): string {
  if (m.source !== 'import') return 'App';
  const ref = [m.external_system, m.external_ref].filter(Boolean).join(' ');
  return ref ? `Importado (${ref})` : 'Importado';
}

/** Movements sheet, rows in the given order, quantities signed like the history. */
export function movementSheetRows(
  rows: readonly MovementSheetInput[],
  labels: Record<MovementKind, string>,
): SheetTable {
  return {
    header: [...MOVEMENT_SHEET_HEADER],
    rows: rows.map((m) => [
      toSheetDate(m.occurred_at),
      movementType(m, labels),
      m.company?.name ?? '',
      m.warehouse?.name ?? OTHER_COMPANY,
      m.cost_center ? `${m.cost_center.code} · ${m.cost_center.name}` : '',
      m.material?.name ?? '',
      m.material?.unit ?? '',
      signedQuantity(m.kind, Number(m.quantity)),
      m.unit_cost == null ? null : Number(m.unit_cost),
      m.invoice_number ?? '',
      m.author?.full_name ?? '',
      movementOrigin(m),
      m.notes ?? '',
    ]),
  };
}

export const BALANCE_SHEET_HEADER = [
  'Empresa',
  'Obra',
  'Depósito',
  'Material',
  'Unidade',
  'Saldo',
  'Mínimo',
  'Abaixo do mínimo',
  'Última movimentação',
];

export interface BalanceSheetNames {
  company: (companyId: string) => string;
  /** Site label; called only for warehouses on a site. */
  site: (siteId: string) => string;
}

/** Balances sheet: one row per warehouse and material, sorted by company, warehouse and material. */
export function balanceSheetRows(balances: readonly StockBalance[], names: BalanceSheetNames): SheetTable {
  const sorted = balances
    .map((b) => ({ b, company: names.company(b.company_id) }))
    .sort(
      (x, y) =>
        x.company.localeCompare(y.company, 'pt-BR') ||
        x.b.warehouse_name.localeCompare(y.b.warehouse_name, 'pt-BR') ||
        x.b.material_name.localeCompare(y.b.material_name, 'pt-BR'),
    );
  return {
    header: [...BALANCE_SHEET_HEADER],
    rows: sorted.map(({ b, company }) => [
      company,
      b.site_id ? names.site(b.site_id) : '',
      b.warehouse_name,
      b.material_name,
      b.unit,
      Number(b.quantity),
      b.min_quantity == null ? null : Number(b.min_quantity),
      b.below_minimum ? 'Sim' : 'Não',
      b.last_movement_at ? toSheetDate(b.last_movement_at) : null,
    ]),
  };
}
