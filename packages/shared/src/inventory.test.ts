import { describe, expect, it } from 'vitest';

import {
  canAccessCostCenter,
  canAuthorizeTransfer,
  canEditMasterData,
  canRegisterMovement,
  canTransfer,
  groupBalances,
  groupCostCenterBalances,
  hasRoleInCompany,
  parseDecimal,
  type BalanceGroupNames,
  type CostCenterBalance,
  type Membership,
  type StockBalance,
} from './inventory';

// Same shape as supabase/seed.sql and scripts/create-dev-users.mjs.
const A = 'company-a';
const B = 'company-b';
const OB1 = { id: 'cc-ob-001', company_id: A };
const OB2 = { id: 'cc-ob-002', company_id: A };
const ADM = { id: 'cc-adm', company_id: A };
const LT1 = { id: 'cc-lt-001', company_id: B };

const personas: Record<string, Membership[]> = {
  diretoria: [{ role: 'director', company_id: null, cost_center_id: null }],
  gestor: [{ role: 'manager', company_id: A, cost_center_id: null }],
  gestorJardim: [{ role: 'manager', company_id: A, cost_center_id: OB1.id }],
  almox: [{ role: 'storekeeper', company_id: A, cost_center_id: null }],
  mestre: [{ role: 'foreman', company_id: A, cost_center_id: OB1.id }],
  gestorUrbanismo: [{ role: 'manager', company_id: B, cost_center_id: null }],
  semAcesso: [],
};

describe('permission mirrors (must match the SQL functions and RLS)', () => {
  it('canAccessCostCenter: company-wide unless the membership names a cost center', () => {
    expect(canAccessCostCenter(personas.gestor!, OB2)).toBe(true);
    expect(canAccessCostCenter(personas.gestorJardim!, OB1)).toBe(true);
    expect(canAccessCostCenter(personas.gestorJardim!, OB2)).toBe(false);
    expect(canAccessCostCenter(personas.gestorUrbanismo!, OB1)).toBe(false);
    expect(canAccessCostCenter(personas.diretoria!, LT1)).toBe(true);
    expect(canAccessCostCenter(personas.semAcesso!, OB1)).toBe(false);
  });

  it('canRegisterMovement: receipts by managers/storekeepers, issues also by foremen, adjustments by managers', () => {
    expect(canRegisterMovement(personas.almox!, 'in', OB1)).toBe(true);
    expect(canRegisterMovement(personas.almox!, 'adjustment', OB1)).toBe(false);
    expect(canRegisterMovement(personas.mestre!, 'out', OB1)).toBe(true);
    expect(canRegisterMovement(personas.mestre!, 'out', OB2)).toBe(false);
    expect(canRegisterMovement(personas.mestre!, 'in', OB1)).toBe(false);
    expect(canRegisterMovement(personas.gestor!, 'adjustment', ADM)).toBe(true);
    expect(canRegisterMovement(personas.gestorUrbanismo!, 'out', OB1)).toBe(false);
  });

  it('canTransfer: only managers and directors', () => {
    expect(canTransfer(personas.gestor!)).toBe(true);
    expect(canTransfer(personas.diretoria!)).toBe(true);
    expect(canTransfer(personas.almox!)).toBe(false);
    expect(canTransfer(personas.mestre!)).toBe(false);
    expect(canTransfer(personas.semAcesso!)).toBe(false);
  });

  it('canAuthorizeTransfer mirrors create_transfer()', () => {
    // within a company: the manager
    expect(canAuthorizeTransfer(personas.gestor!, ADM, OB1)).toBe(true);
    // between companies: directors only
    expect(canAuthorizeTransfer(personas.gestor!, ADM, LT1)).toBe(false);
    expect(canAuthorizeTransfer(personas.diretoria!, ADM, LT1)).toBe(true);
    // a manager limited to OB-001 needs access to both cost centers
    expect(canAuthorizeTransfer(personas.gestorJardim!, OB1, OB1)).toBe(true);
    expect(canAuthorizeTransfer(personas.gestorJardim!, ADM, OB1)).toBe(false);
    expect(canAuthorizeTransfer(personas.gestorJardim!, OB1, OB2)).toBe(false);
    // other roles never
    expect(canAuthorizeTransfer(personas.almox!, ADM, OB1)).toBe(false);
    expect(canAuthorizeTransfer(personas.gestorUrbanismo!, ADM, OB1)).toBe(false);
  });

  it('hasRoleInCompany and canEditMasterData follow MASTER_DATA_ROLES', () => {
    expect(hasRoleInCompany(personas.almox!, A, ['manager', 'storekeeper'])).toBe(true);
    expect(hasRoleInCompany(personas.almox!, B, ['manager', 'storekeeper'])).toBe(false);
    expect(hasRoleInCompany(personas.diretoria!, B, ['manager'])).toBe(true);

    const can = (who: keyof typeof personas) =>
      (['materials', 'warehouses', 'sites', 'costCenters', 'minimums'] as const).filter((k) =>
        canEditMasterData(personas[who]!, k),
      );
    expect(can('diretoria')).toEqual(['materials', 'warehouses', 'sites', 'costCenters', 'minimums']);
    expect(can('gestor')).toEqual(['materials', 'warehouses', 'sites', 'costCenters', 'minimums']);
    expect(can('almox')).toEqual(['materials', 'warehouses', 'minimums']);
    expect(can('mestre')).toEqual([]);
    expect(can('semAcesso')).toEqual([]);
  });
});

describe('parseDecimal (Brazilian notation)', () => {
  it.each([
    ['1.500', 1500],
    ['1.250,5', 1250.5],
    ['2,75', 2.75],
    ['2.5', 2.5],
    ['10', 10],
    [' 3 ', 3],
    ['0', 0],
  ])('%s -> %s', (text, value) => expect(parseDecimal(text)).toBe(value));

  it.each(['', 'abc', '1,2345', '-1', '1,2,3'])('rejects %j', (text) => expect(parseDecimal(text)).toBeNull());

  it('accepts more decimals when asked (unit cost)', () => expect(parseDecimal('3,1234', 4)).toBe(3.1234));
});

describe('groupBalances', () => {
  const row = (over: Partial<StockBalance>): StockBalance => ({
    company_id: A,
    warehouse_id: 'w-central',
    warehouse_name: 'Almoxarifado central',
    site_id: null,
    material_id: 'm-cimento',
    material_name: 'Cimento',
    unit: 'sc',
    quantity: 0,
    min_quantity: null,
    below_minimum: false,
    last_movement_at: null,
    ...over,
  });
  const balances = [
    row({ quantity: 0.1, min_quantity: 5, below_minimum: true }),
    row({ warehouse_id: 'w-jardim', warehouse_name: 'Canteiro Jardim', site_id: 's-jardim', quantity: 0.2 }),
    row({ warehouse_id: 'w-jardim', warehouse_name: 'Canteiro Jardim', site_id: 's-jardim', material_id: 'm-areia', material_name: 'Areia', unit: 'm³', quantity: 3 }),
    row({ company_id: B, warehouse_id: 'w-vale', warehouse_name: 'Canteiro Vale', site_id: 's-vale', quantity: 7, below_minimum: true }),
  ];
  const names: BalanceGroupNames = {
    site: (id) => ({ 's-jardim': 'OB-001 · Jardim', 's-vale': 'LT-001 · Vale' })[id] ?? id,
    company: (id) => (id === A ? 'Construtora' : 'Urbanismo'),
    noSite: 'Almoxarifados (sem obra)',
    group: 'Total',
  };

  it('warehouse view keeps one row per warehouse, with its id and minimum', () => {
    const groups = groupBalances(balances, 'warehouse', names);
    expect(groups.map((g) => g.title)).toEqual(['Almoxarifado central', 'Canteiro Jardim', 'Canteiro Vale']);
    expect(groups[0]!.rows[0]).toMatchObject({ warehouse_id: 'w-central', min_quantity: 5, below_minimum_count: 1 });
    // materials sorted by name within a group
    expect(groups[1]!.rows.map((r) => r.material_name)).toEqual(['Areia', 'Cimento']);
  });

  it('site view puts warehouses without a site last', () => {
    const groups = groupBalances(balances, 'site', names);
    expect(groups.map((g) => g.title)).toEqual(['LT-001 · Vale', 'OB-001 · Jardim', 'Almoxarifados (sem obra)']);
  });

  it('summed views add quantities without float artifacts and drop the warehouse id', () => {
    const [construtora] = groupBalances(balances, 'company', names);
    const cimento = construtora!.rows.find((r) => r.material_id === 'm-cimento')!;
    expect(cimento.quantity).toBe(0.3);
    expect(cimento).not.toHaveProperty('warehouse_id');
    expect(cimento).not.toHaveProperty('min_quantity');
  });

  it('group view counts warehouses below minimum', () => {
    const [total] = groupBalances(balances, 'group', names);
    const cimento = total!.rows.find((r) => r.material_id === 'm-cimento')!;
    expect(cimento.quantity).toBe(7.3);
    expect(cimento.below_minimum_count).toBe(2);
  });

  it('accepts numeric values serialized as strings', () => {
    const [total] = groupBalances([row({ quantity: '1.5' as unknown as number }), row({ quantity: 2 })], 'group', names);
    expect(total!.rows[0]!.quantity).toBe(3.5);
  });
});

describe('groupCostCenterBalances', () => {
  const cc = (code: string, material: string, quantity: number): CostCenterBalance => ({
    company_id: A,
    cost_center_id: `cc-${code}`,
    cost_center_code: code,
    cost_center_name: `Centro ${code}`,
    material_id: `m-${material}`,
    material_name: material,
    unit: 'un',
    quantity,
  });

  it('groups by cost center ordered by code, materials by name', () => {
    const groups = groupCostCenterBalances([cc('OB-002', 'Tijolo', 5), cc('ADM', 'Cimento', 1), cc('OB-002', 'Areia', 2)]);
    expect(groups.map((g) => g.title)).toEqual(['ADM · Centro ADM', 'OB-002 · Centro OB-002']);
    expect(groups[1]!.rows.map((r) => r.material_name)).toEqual(['Areia', 'Tijolo']);
  });

  it('keeps negative values (more issued than received on that cost center)', () => {
    expect(groupCostCenterBalances([cc('OB-001', 'Cimento', -4)])[0]!.rows[0]!.quantity).toBe(-4);
  });
});
