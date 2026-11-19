// Inventory domain types. They mirror the enums in supabase/migrations.
// With the database running, `pnpm db:types` generates the full table types.

export const APP_ROLES = ['director', 'manager', 'storekeeper', 'foreman'] as const;
export type AppRole = (typeof APP_ROLES)[number];

/** On-screen labels (pt-BR). */
export const ROLE_LABELS: Record<AppRole, string> = {
  director: 'Diretoria',
  manager: 'Gestor',
  storekeeper: 'Almoxarife',
  foreman: 'Mestre de obras',
};

export const MOVEMENT_KINDS = ['in', 'out', 'transfer_out', 'transfer_in', 'adjustment'] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

/** On-screen labels (pt-BR). */
export const MOVEMENT_LABELS: Record<MovementKind, string> = {
  in: 'Entrada',
  out: 'Saída',
  transfer_out: 'Transferência (saída)',
  transfer_in: 'Transferência (entrada)',
  adjustment: 'Ajuste de inventário',
};

/** Signed quantity: positive increases the balance, negative decreases it. */
export function signedQuantity(kind: MovementKind, quantity: number): number {
  return kind === 'out' || kind === 'transfer_out' ? -quantity : quantity;
}

/** A user's membership (memberships table). Directors have no company. */
export interface Membership {
  role: AppRole;
  company_id: string | null;
  cost_center_id: string | null;
}

/** Movements recorded manually. Transfers have their own flow. */
export const MANUAL_MOVEMENT_KINDS = ['in', 'out', 'adjustment'] as const;
export type ManualMovementKind = (typeof MANUAL_MOVEMENT_KINDS)[number];

/** Roles allowed to record each kind. Directors always can. Mirrors can_register_movement(). */
const KIND_ROLES: Record<ManualMovementKind, readonly AppRole[]> = {
  in: ['manager', 'storekeeper'],
  out: ['manager', 'storekeeper', 'foreman'],
  adjustment: ['manager'],
};

interface CostCenterRef {
  id: string;
  company_id: string;
}

/** Mirrors has_cost_center_access(): a membership without a cost center covers the whole company. */
export function canAccessCostCenter(memberships: readonly Membership[], cc: CostCenterRef): boolean {
  return memberships.some(
    (m) =>
      m.role === 'director' ||
      (m.company_id === cc.company_id && (m.cost_center_id === null || m.cost_center_id === cc.id)),
  );
}

/** Mirrors can_register_movement(). The database decides; this only guides the UI. */
export function canRegisterMovement(
  memberships: readonly Membership[],
  kind: ManualMovementKind,
  cc: CostCenterRef,
): boolean {
  return (
    canAccessCostCenter(memberships, cc) &&
    memberships.some(
      (m) => m.role === 'director' || (m.company_id === cc.company_id && KIND_ROLES[kind].includes(m.role)),
    )
  );
}

/**
 * Parses a number typed in Brazilian notation: "1.250,5", "1500", "2,75".
 * Without a comma, a dot followed by groups of 3 digits is a thousands separator ("1.500" = 1500);
 * otherwise the dot is a decimal point ("2.5" = 2.5).
 * Returns null if invalid or if it has more decimal places than the database stores.
 */
export function parseDecimal(text: string, maxDecimals = 3): number | null {
  const t = text.trim().replace(/\s/g, '');
  if (!t) return null;
  const normalized = t.includes(',')
    ? t.replace(/\./g, '').replace(',', '.')
    : /^\d{1,3}(\.\d{3})+$/.test(t)
      ? t.replace(/\./g, '')
      : t;
  if (!new RegExp(`^\\d+(\\.\\d{1,${maxDecimals}})?$`).test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/** Row returned by the get_stock_balances RPC. */
export interface StockBalance {
  company_id: string;
  warehouse_id: string;
  warehouse_name: string;
  site_id: string | null;
  material_id: string;
  material_name: string;
  unit: string;
  quantity: number;
  min_quantity: number | null;
  below_minimum: boolean;
  last_movement_at: string | null;
}
