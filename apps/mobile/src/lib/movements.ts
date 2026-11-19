import type { MovementKind } from '@buildops/shared';

/** Movement row as read by the history screens (with embedded names). */
export interface MovementRow {
  id: string;
  kind: MovementKind;
  quantity: number;
  occurred_at: string;
  notes: string | null;
  invoice_number: string | null;
  unit_cost: number | null;
  photo_path: string | null;
  source: 'app' | 'import';
  external_system: string | null;
  external_ref: string | null;
  warehouse_id: string;
  material_id: string;
  material: { name: string; unit: string } | null;
  warehouse: { name: string } | null;
  cost_center: { code: string; name: string } | null;
  author: { full_name: string } | null;
  transfer: {
    from: { name: string } | null;
    to: { name: string } | null;
    authorizer: { full_name: string } | null;
  } | null;
}

/**
 * PostgREST select for MovementRow. Warehouses of another company come back as null when the user
 * can't see them (RLS), so screens show "outra empresa" instead.
 */
export const MOVEMENT_SELECT = `
  id, kind, quantity, occurred_at, notes, invoice_number, unit_cost, photo_path, source,
  external_system, external_ref, warehouse_id, material_id,
  material:materials(name, unit),
  warehouse:warehouses(name),
  cost_center:cost_centers(code, name),
  author:profiles!created_by(full_name),
  transfer:transfers(
    from:warehouses!from_warehouse_id(name),
    to:warehouses!to_warehouse_id(name),
    authorizer:profiles!authorized_by(full_name)
  )
`;

const OTHER_COMPANY = 'outra empresa';

/** "Transferência para X" / "Transferência de X", or the plain kind label. */
export function movementTitle(m: MovementRow, labels: Record<MovementKind, string>): string {
  if (m.kind === 'transfer_out') return `Transferência para ${m.transfer?.to?.name ?? OTHER_COMPANY}`;
  if (m.kind === 'transfer_in') return `Transferência de ${m.transfer?.from?.name ?? OTHER_COMPANY}`;
  return labels[m.kind];
}

export const formatQty = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
