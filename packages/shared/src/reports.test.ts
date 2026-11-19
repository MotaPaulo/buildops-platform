import { describe, expect, it } from 'vitest';

import { MOVEMENT_LABELS, type StockBalance } from './inventory';
import {
  balanceSheetRows,
  defaultPeriod,
  exportLimitError,
  exportLimitMessage,
  formatDateBR,
  MOVEMENT_EXPORT_LIMIT,
  MOVEMENT_SHEET_HEADER,
  movementSheetRows,
  parseDateBR,
  toSheetDate,
  validatePeriod,
  type MovementSheetInput,
} from './reports';

describe('parseDateBR', () => {
  it('parses dd/mm/aaaa as local midnight', () => {
    const d = parseDateBR('05/03/2026');
    expect(d && [d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 2, 5, 0]);
    expect(parseDateBR(' 5/3/2026 ')?.getDate()).toBe(5);
  });

  it('rejects malformed and impossible dates', () => {
    for (const t of ['', '2026-03-05', '31/02/2026', '00/01/2026', '12/13/2026', '1/1/26', 'abc']) {
      expect(parseDateBR(t)).toBeNull();
    }
  });

  it('round-trips with formatDateBR', () => {
    expect(formatDateBR(parseDateBR('29/02/2028')!)).toBe('29/02/2028');
  });
});

describe('validatePeriod', () => {
  it('makes the end date inclusive', () => {
    const r = validatePeriod('01/11/2026', '30/11/2026');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.from).toEqual(new Date(2026, 10, 1));
    expect(r.toExclusive).toEqual(new Date(2026, 11, 1));
  });

  it('accepts a single day', () => {
    const r = validatePeriod('19/11/2026', '19/11/2026');
    expect(r.ok && r.toExclusive).toEqual(new Date(2026, 10, 20));
  });

  it('rejects a start after the end', () => {
    expect(validatePeriod('02/11/2026', '01/11/2026')).toEqual({
      ok: false,
      error: 'A data inicial precisa ser anterior à final.',
    });
  });

  it('rejects unparseable dates', () => {
    expect(validatePeriod('32/11/2026', '01/12/2026')).toEqual({ ok: false, error: 'Data inválida.' });
    expect(validatePeriod('01/11/2026', '')).toEqual({ ok: false, error: 'Data inválida.' });
  });
});

describe('defaultPeriod', () => {
  it('covers the last 30 days, today included', () => {
    expect(defaultPeriod(new Date(2026, 10, 19, 15))).toEqual({ from: '21/10/2026', to: '19/11/2026' });
  });
});

describe('exportLimitMessage', () => {
  it('formats counts the pt-BR way', () => {
    expect(MOVEMENT_EXPORT_LIMIT).toBe(10000);
    expect(exportLimitMessage(12345)).toBe(
      'São 12.345 movimentações; o limite para exportar é 10.000. Reduza o período.',
    );
  });
});

describe('toSheetDate', () => {
  it('keeps the local wall-clock time in UTC fields', () => {
    const iso = '2026-11-19T13:45:00Z';
    const local = new Date(iso);
    const cell = toSheetDate(iso);
    expect([cell.getUTCDate(), cell.getUTCHours(), cell.getUTCMinutes()]).toEqual([
      local.getDate(),
      local.getHours(),
      local.getMinutes(),
    ]);
  });
});

const base: MovementSheetInput = {
  kind: 'in',
  quantity: 10,
  occurred_at: '2026-11-19T13:00:00Z',
  notes: null,
  invoice_number: null,
  unit_cost: null,
  source: 'app',
  external_system: null,
  external_ref: null,
  material: { name: 'Cimento CP-II', unit: 'sc' },
  warehouse: { name: 'Almoxarifado Central' },
  cost_center: { code: 'OB-001', name: 'Residencial Jardim' },
  author: { full_name: 'Ana Almoxarife' },
  company: { name: 'Construtora Exemplo' },
  transfer: null,
};

describe('movementSheetRows', () => {
  it('uses the pt-BR header and one row per movement, in order', () => {
    const sheet = movementSheetRows(
      [
        { ...base, quantity: '12.5', unit_cost: '32.9', invoice_number: 'NF 123', notes: 'obs' },
        { ...base, kind: 'out', quantity: 3 },
      ],
      MOVEMENT_LABELS,
    );
    expect(sheet.header).toEqual(MOVEMENT_SHEET_HEADER);
    expect(sheet.header[0]).toBe('Data');
    expect(sheet.rows).toHaveLength(2);
    expect(sheet.rows[0]).toEqual([
      toSheetDate(base.occurred_at),
      'Entrada',
      'Construtora Exemplo',
      'Almoxarifado Central',
      'OB-001 · Residencial Jardim',
      'Cimento CP-II',
      'sc',
      12.5,
      32.9,
      'NF 123',
      'Ana Almoxarife',
      'App',
      'obs',
    ]);
    expect(sheet.rows[1]?.[7]).toBe(-3);
    expect(sheet.rows[1]?.[8]).toBeNull();
  });

  it('signs transfers and names the other side', () => {
    const transfer = { from: { name: 'Obra A' }, to: null };
    const sheet = movementSheetRows(
      [
        { ...base, kind: 'transfer_out', quantity: 4, transfer },
        { ...base, kind: 'transfer_in', quantity: 4, transfer },
        { ...base, kind: 'adjustment', quantity: -2 },
      ],
      MOVEMENT_LABELS,
    );
    expect(sheet.rows.map((r) => [r[1], r[7]])).toEqual([
      ['Transferência para outra empresa', -4],
      ['Transferência de Obra A', 4],
      ['Ajuste de inventário', -2],
    ]);
  });

  it('fills missing embeds and describes imports', () => {
    const [row] = movementSheetRows(
      [
        {
          ...base,
          warehouse: null,
          cost_center: null,
          author: null,
          company: undefined,
          source: 'import',
          external_system: 'ERP',
          external_ref: '42',
        },
      ],
      MOVEMENT_LABELS,
    ).rows;
    expect(row?.slice(2, 5)).toEqual(['', 'outra empresa', '']);
    expect(row?.slice(10, 12)).toEqual(['', 'Importado (ERP 42)']);
  });
});

describe('balanceSheetRows', () => {
  const balance = (over: Partial<StockBalance>): StockBalance => ({
    company_id: 'a',
    warehouse_id: 'w1',
    warehouse_name: 'Almoxarifado',
    site_id: null,
    material_id: 'm1',
    material_name: 'Areia',
    unit: 'm³',
    quantity: 5,
    min_quantity: null,
    below_minimum: false,
    last_movement_at: null,
    ...over,
  });

  it('sorts by company, warehouse and material and flags minimums', () => {
    const sheet = balanceSheetRows(
      [
        balance({ company_id: 'b', material_name: 'Brita' }),
        balance({ warehouse_name: 'Depósito Obra', site_id: 's1', material_name: 'Cimento', quantity: 2, min_quantity: 10, below_minimum: true, last_movement_at: '2026-11-19T13:00:00Z' }),
        balance({}),
      ],
      { company: (id) => (id === 'a' ? 'Construtora' : 'Loteadora'), site: () => 'OB-001 · Jardim' },
    );
    expect(sheet.header).toEqual([
      'Empresa',
      'Obra',
      'Depósito',
      'Material',
      'Unidade',
      'Saldo',
      'Mínimo',
      'Abaixo do mínimo',
      'Última movimentação',
    ]);
    expect(sheet.rows).toEqual([
      ['Construtora', '', 'Almoxarifado', 'Areia', 'm³', 5, null, 'Não', null],
      ['Construtora', 'OB-001 · Jardim', 'Depósito Obra', 'Cimento', 'm³', 2, 10, 'Sim', toSheetDate('2026-11-19T13:00:00Z')],
      ['Loteadora', '', 'Almoxarifado', 'Brita', 'm³', 5, null, 'Não', null],
    ]);
  });
});

describe('exportLimitError', () => {
  it('allows up to the limit and refuses above it', () => {
    expect(exportLimitError(0)).toBeNull();
    expect(exportLimitError(10000)).toBeNull();
    expect(exportLimitError(10001)).toBe('São 10.001 movimentações; o limite para exportar é 10.000. Reduza o período.');
  });
});
