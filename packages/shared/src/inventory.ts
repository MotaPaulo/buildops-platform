// Tipos de domínio do estoque. Espelham os enums de supabase/migrations.
// Quando o banco estiver rodando, `pnpm db:types` gera os tipos completos das tabelas.

export const APP_ROLES = ['director', 'manager', 'storekeeper', 'foreman'] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const ROLE_LABELS: Record<AppRole, string> = {
  director: 'Diretoria',
  manager: 'Gestor',
  storekeeper: 'Almoxarife',
  foreman: 'Mestre de obras',
};

export const MOVEMENT_KINDS = ['in', 'out', 'transfer_out', 'transfer_in', 'adjustment'] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

export const MOVEMENT_LABELS: Record<MovementKind, string> = {
  in: 'Entrada',
  out: 'Saída',
  transfer_out: 'Transferência (saída)',
  transfer_in: 'Transferência (entrada)',
  adjustment: 'Ajuste de inventário',
};

/** Quantidade com sinal: positiva aumenta o saldo, negativa reduz. */
export function signedQuantity(kind: MovementKind, quantity: number): number {
  return kind === 'out' || kind === 'transfer_out' ? -quantity : quantity;
}

/** Vínculo do usuário (tabela memberships). Diretoria não tem empresa. */
export interface Membership {
  role: AppRole;
  company_id: string | null;
  cost_center_id: string | null;
}

/** Movimentações lançadas manualmente. Transferências têm fluxo próprio. */
export const MANUAL_MOVEMENT_KINDS = ['in', 'out', 'adjustment'] as const;
export type ManualMovementKind = (typeof MANUAL_MOVEMENT_KINDS)[number];

/** Papéis que podem lançar cada tipo. A diretoria sempre pode. Espelha can_register_movement(). */
const KIND_ROLES: Record<ManualMovementKind, readonly AppRole[]> = {
  in: ['manager', 'storekeeper'],
  out: ['manager', 'storekeeper', 'foreman'],
  adjustment: ['manager'],
};

interface CostCenterRef {
  id: string;
  company_id: string;
}

/** Espelha has_cost_center_access(): vínculo sem centro de custo vale para a empresa toda. */
export function canAccessCostCenter(memberships: readonly Membership[], cc: CostCenterRef): boolean {
  return memberships.some(
    (m) =>
      m.role === 'director' ||
      (m.company_id === cc.company_id && (m.cost_center_id === null || m.cost_center_id === cc.id)),
  );
}

/** Espelha can_register_movement(). O banco é quem decide; isto só orienta a tela. */
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
 * Lê número digitado no padrão brasileiro: "1.250,5", "1500", "2,75".
 * Sem vírgula, ponto seguido de grupos de 3 dígitos é milhar ("1.500" = 1500);
 * nos demais casos o ponto é decimal ("2.5" = 2,5).
 * Retorna null se inválido ou com mais casas decimais que o banco guarda.
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

/** Linha retornada pela RPC get_stock_balances. */
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
