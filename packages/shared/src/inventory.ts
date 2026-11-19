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
