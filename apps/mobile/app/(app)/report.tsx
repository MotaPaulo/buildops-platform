import {
  balanceSheetRows,
  defaultPeriod,
  exportLimitError,
  formatDateBR,
  MOVEMENT_EXPORT_LIMIT,
  MOVEMENT_EXPORT_PAGE,
  MOVEMENT_LABELS,
  movementSheetRows,
  REPORT_KIND_FILTERS,
  signedQuantity,
  validatePeriod,
  type MovementKind,
  type StockBalance,
} from '@buildops/shared';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { ACCENT, Chips, Field, formStyles as s } from '@/components/form';
import { useMemberships } from '@/lib/access';
import { rows } from '@/lib/data';
import { canExportXlsx, downloadXlsx, EXPORT_WEB_ONLY } from '@/lib/excel';
import { formatDateTime, formatQty, movementTitle, REPORT_SELECT, type MovementRow } from '@/lib/movements';
import { supabase } from '@/lib/supabase';

/** Rows shown on screen; the export fetches every matching row up to MOVEMENT_EXPORT_LIMIT. */
const SCREEN_ROWS = 200;
/** Table layout from this width; narrower screens get cards like the history. */
const WIDE = 900;
const ALL = 'all';
const MATERIAL_MATCHES = 20;
/** get_stock_balances is capped by PostgREST max_rows, so the balance export pages it. */
const BALANCE_PAGE = 1000;
const NO_ACCESS = 'Seu usuário ainda não tem acesso a nenhuma empresa. Peça à diretoria para liberar.';

type Company = { id: string; name: string };
type Warehouse = { id: string; name: string; company_id: string };
type CostCenter = { id: string; code: string; name: string; company_id: string };
type Material = { id: string; name: string; unit: string };
type SiteRef = { id: string; name: string; cost_center: { code: string } | null };

/** Filters of one query. The screen and the export both go through buildQuery, so they can't drift. */
interface ReportFilters {
  fromDate: Date; // first day, local
  toDate: Date; // last day, local
  from: string; // ISO, inclusive
  to: string; // ISO, exclusive (day after the end date)
  companyId: string | null;
  warehouseId: string | null;
  costCenterId: string | null;
  materialId: string | null;
  kinds: MovementKind[];
}

/** Movements matching the filters, newest first. Runs under the user's session, so RLS applies. */
function buildQuery(f: ReportFilters, withCount = false) {
  let q = supabase
    .from('stock_movements')
    .select(REPORT_SELECT, withCount ? { count: 'exact' } : undefined)
    .gte('occurred_at', f.from)
    .lt('occurred_at', f.to);
  if (f.companyId) q = q.eq('company_id', f.companyId);
  if (f.warehouseId) q = q.eq('warehouse_id', f.warehouseId);
  if (f.costCenterId) q = q.eq('cost_center_id', f.costCenterId);
  if (f.materialId) q = q.eq('material_id', f.materialId);
  if (f.kinds.length) q = q.in('kind', f.kinds);
  return q.order('occurred_at', { ascending: false }).order('id');
}

/** yyyy-mm-dd for file names. */
const fileDate = (d: Date) => formatDateBR(d).split('/').reverse().join('-');
const optional = (id: string) => (id === ALL ? null : id);

export default function ReportScreen() {
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;
  const { memberships } = useMemberships();

  // Options (all read under RLS).
  const [companies, setCompanies] = useState<Company[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [optionsError, setOptionsError] = useState<string | null>(null);

  // Filters.
  const initial = useMemo(() => defaultPeriod(), []);
  const [fromText, setFromText] = useState(initial.from);
  const [toText, setToText] = useState(initial.to);
  const [companyId, setCompanyId] = useState(ALL);
  const [warehouseId, setWarehouseId] = useState(ALL);
  const [costCenterId, setCostCenterId] = useState(ALL);
  const [material, setMaterial] = useState<Material | null>(null);
  const [materialSearch, setMaterialSearch] = useState('');
  const [kindFilter, setKindFilter] = useState(ALL);

  // Result of the last query, with the filters that produced it (the export reuses them).
  const requestId = useRef(0);
  const [applied, setApplied] = useState<ReportFilters | null>(null);
  const [items, setItems] = useState<MovementRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [exporting, setExporting] = useState<'movements' | 'balances' | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      supabase.from('companies').select('id, name').order('name'),
      supabase.from('warehouses').select('id, name, company_id').order('name'),
      supabase.from('cost_centers').select('id, code, name, company_id').order('code'),
      supabase.from('materials').select('id, name, unit').order('name'),
    ]).then(
      ([c, w, cc, m]) => {
        try {
          setCompanies(rows(c));
          setWarehouses(rows(w));
          setCostCenters(rows(cc));
          setMaterials(rows(m));
        } catch (e) {
          setOptionsError(`Filtros indisponíveis: ${(e as Error).message}`);
        }
      },
      (e: Error) => setOptionsError(`Filtros indisponíveis: ${e.message}`),
    );
  }, []);

  const period = validatePeriod(fromText, toText);
  const periodError = period.ok ? null : period.error;

  const filters = useMemo<ReportFilters | null>(() => {
    const p = validatePeriod(fromText, toText);
    if (!p.ok) return null;
    return {
      fromDate: p.from,
      toDate: new Date(p.toExclusive.getFullYear(), p.toExclusive.getMonth(), p.toExclusive.getDate() - 1),
      from: p.from.toISOString(),
      to: p.toExclusive.toISOString(),
      companyId: optional(companyId),
      warehouseId: optional(warehouseId),
      costCenterId: optional(costCenterId),
      materialId: material?.id ?? null,
      kinds: REPORT_KIND_FILTERS.find((k) => k.id === kindFilter)?.kinds ?? [],
    };
  }, [fromText, toText, companyId, warehouseId, costCenterId, material, kindFilter]);

  useEffect(() => {
    const current = ++requestId.current;
    setExportError(null);
    if (!filters) {
      // Invalid period: nothing is queried and nothing can be exported.
      setApplied(null);
      setItems([]);
      setTotal(0);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    buildQuery(filters, true)
      .range(0, SCREEN_ROWS - 1)
      .then((res) => {
        if (current !== requestId.current) return; // a newer filter replaced this request
        try {
          setItems(rows<MovementRow[]>(res));
          setTotal(res.count ?? 0);
          setApplied(filters);
        } catch (e) {
          setError((e as Error).message);
          setApplied(null);
          setItems([]);
          setTotal(0);
        }
      })
      .then(
        () => current === requestId.current && setLoading(false),
        (e: Error) => {
          if (current !== requestId.current) return;
          setError(e.message);
          setApplied(null);
          setItems([]);
          setTotal(0);
          setLoading(false);
        },
      );
  }, [filters]);

  // Warehouses and cost centers of the chosen company only.
  const companyWarehouses = warehouses.filter((w) => companyId === ALL || w.company_id === companyId);
  // cost_centers RLS is company-wide, but movements follow cost-center access: when every membership
  // of the user in a company is scoped to a cost center, offer only those cost centers.
  const isDirector = !!memberships?.some((m) => m.role === 'director');
  const visibleCostCenters = costCenters.filter((c) => {
    if (isDirector || !memberships) return true;
    const own = memberships.filter((m) => m.company_id === c.company_id);
    if (!own.length || own.some((m) => !m.cost_center_id)) return true;
    return own.some((m) => m.cost_center_id === c.id);
  });
  const companyCostCenters = visibleCostCenters.filter((c) => companyId === ALL || c.company_id === companyId);
  const multiCompany = companies.length > 1;
  const companyName = (id: string) => companies.find((c) => c.id === id)?.name ?? 'Empresa';

  function chooseCompany(id: string) {
    setCompanyId(id);
    if (id === ALL) return;
    if (warehouseId !== ALL && warehouses.find((w) => w.id === warehouseId)?.company_id !== id) setWarehouseId(ALL);
    if (costCenterId !== ALL && costCenters.find((c) => c.id === costCenterId)?.company_id !== id) setCostCenterId(ALL);
  }

  const materialMatches = useMemo(() => {
    const q = materialSearch.trim().toLocaleLowerCase('pt-BR');
    if (!q) return [];
    return materials.filter((m) => m.name.toLocaleLowerCase('pt-BR').includes(q)).slice(0, MATERIAL_MATCHES);
  }, [materials, materialSearch]);

  async function exportMovements() {
    if (!applied || exporting) return;
    setExportError(null);
    const tooMany = exportLimitError(total);
    if (tooMany) return setExportError(tooMany);
    setExporting('movements');
    try {
      const all: MovementRow[] = [];
      const seen = new Set<string>();
      let expected = 0;
      // Page until every row of the first page's count arrived (or a page is empty), so a server
      // row cap below MOVEMENT_EXPORT_PAGE can't silently drop rows.
      for (let offset = 0; offset === 0 || (all.length < expected); ) {
        const res = await buildQuery(applied, offset === 0).range(offset, offset + MOVEMENT_EXPORT_PAGE - 1);
        const page = rows<MovementRow[]>(res);
        if (offset === 0) {
          expected = res.count ?? 0;
          // Re-check on the live count: movements may have been registered since the screen loaded.
          const liveTooMany = exportLimitError(expected);
          if (liveTooMany) throw new Error(liveTooMany);
        }
        if (!page.length) break;
        for (const m of page) {
          if (!seen.has(m.id)) {
            seen.add(m.id);
            all.push(m);
          }
        }
        offset += page.length;
      }
      if (all.length !== expected) {
        throw new Error(
          `A exportação trouxe ${all.length} de ${expected} movimentações. As movimentações mudaram durante a exportação; tente de novo.`,
        );
      }
      await downloadXlsx(`movimentacoes_${fileDate(applied.fromDate)}_a_${fileDate(applied.toDate)}.xlsx`, [
        { name: 'Movimentações', ...movementSheetRows(all, MOVEMENT_LABELS) },
      ]);
    } catch (e) {
      setExportError((e as Error).message);
    } finally {
      setExporting(null);
    }
  }

  async function exportBalances() {
    if (exporting) return;
    setExportError(null);
    setExporting('balances');
    try {
      const [st, c] = await Promise.all([
        supabase.from('sites').select('id, name, cost_center:cost_centers(code)'),
        supabase.from('companies').select('id, name'),
      ]);
      const balances: StockBalance[] = [];
      for (let offset = 0; ; offset += BALANCE_PAGE) {
        const page = rows<StockBalance[]>(
          await supabase
            .rpc('get_stock_balances')
            .order('warehouse_id')
            .order('material_id')
            .range(offset, offset + BALANCE_PAGE - 1),
        );
        balances.push(...page);
        if (page.length < BALANCE_PAGE) break;
      }
      const siteLabel = new Map(
        rows<SiteRef[]>(st).map((x) => [x.id, x.cost_center ? `${x.cost_center.code} · ${x.name}` : x.name]),
      );
      const companyNames = new Map(rows<Company[]>(c).map((x) => [x.id, x.name]));
      const today = new Date();
      const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      await downloadXlsx(`saldos_${stamp}.xlsx`, [
        {
          name: 'Saldos',
          ...balanceSheetRows(balances, {
            company: (id) => companyNames.get(id) ?? 'Empresa',
            site: (id) => siteLabel.get(id) ?? 'Obra',
          }),
        },
      ]);
    } catch (e) {
      setExportError((e as Error).message);
    } finally {
      setExporting(null);
    }
  }

  const canExportMovements = !!applied && !loading && total > 0 && !exporting;

  const header = (
    <View style={styles.header}>
      <View style={[styles.filters, wide && styles.filtersWide]}>
        <View style={[s.row, wide && styles.periodWide]}>
          <View style={s.flex}>
            <Field label="De">
              <TextInput
                style={s.input}
                value={fromText}
                onChangeText={setFromText}
                placeholder="dd/mm/aaaa"
                keyboardType="numbers-and-punctuation"
                maxLength={10}
              />
            </Field>
          </View>
          <View style={s.flex}>
            <Field label="Até">
              <TextInput
                style={s.input}
                value={toText}
                onChangeText={setToText}
                placeholder="dd/mm/aaaa"
                keyboardType="numbers-and-punctuation"
                maxLength={10}
              />
            </Field>
          </View>
        </View>
        {periodError && <Text style={s.error}>{periodError}</Text>}

        <Field label="Tipo">
          <Chips
            options={REPORT_KIND_FILTERS.map(({ id, label }) => ({ id, label }))}
            value={kindFilter}
            onChange={setKindFilter}
          />
        </Field>

        {multiCompany && (
          <Field label="Empresa">
            <Chips
              options={[{ id: ALL, label: 'Todas' }, ...companies.map((c) => ({ id: c.id, label: c.name }))]}
              value={companyId}
              onChange={chooseCompany}
            />
          </Field>
        )}

        {companyWarehouses.length > 1 && (
          <Field label="Depósito">
            <Chips
              options={[{ id: ALL, label: 'Todos' }, ...companyWarehouses.map((w) => ({
                  id: w.id,
                  label: multiCompany && companyId === ALL ? `${w.name} · ${companyName(w.company_id)}` : w.name,
                })),
              ]}
              value={warehouseId}
              onChange={setWarehouseId}
            />
          </Field>
        )}

        {companyCostCenters.length > 1 && (
          <Field label="Centro de custo">
            <Chips
              options={[
                { id: ALL, label: 'Todos' },
                ...companyCostCenters.map((c) => ({ id: c.id, label: `${c.code} · ${c.name}` })),
              ]}
              value={costCenterId}
              onChange={setCostCenterId}
            />
          </Field>
        )}

        <Field label="Material">
          {material ? (
            <Pressable style={styles.pill} onPress={() => setMaterial(null)}>
              <Text style={styles.pillText}>{material.name} ✕</Text>
            </Pressable>
          ) : (
            <>
              <TextInput
                style={s.input}
                value={materialSearch}
                onChangeText={setMaterialSearch}
                placeholder="Todos os materiais — digite para buscar"
              />
              {materialSearch.trim() !== '' && (
                <Chips
                  options={materialMatches.map((m) => ({ id: m.id, label: m.name }))}
                  value={null}
                  onChange={(id) => {
                    setMaterial(materials.find((m) => m.id === id) ?? null);
                    setMaterialSearch('');
                  }}
                  emptyText="Nenhum material encontrado."
                />
              )}
            </>
          )}
        </Field>
        {optionsError && <Text style={s.error}>{optionsError}</Text>}
      </View>

      <View style={[styles.summary, wide && styles.summaryWide]}>
        <Text style={styles.total}>
          {loading
            ? 'Carregando…'
            : applied
              ? `${total.toLocaleString('pt-BR')} ${total === 1 ? 'movimentação' : 'movimentações'}`
              : ' '}
        </Text>
        {canExportXlsx ? (
          <View style={styles.actions}>
            <ExportButton
              label="Exportar movimentações"
              busy={exporting === 'movements'}
              disabled={!canExportMovements}
              onPress={exportMovements}
            />
            <ExportButton
              label="Exportar saldos"
              busy={exporting === 'balances'}
              disabled={!!exporting}
              onPress={exportBalances}
            />
          </View>
        ) : (
          <Text style={s.hint}>{EXPORT_WEB_ONLY}</Text>
        )}
      </View>
      {!loading && applied && total > items.length && (
        <Text style={s.hint}>
          Mostrando as {items.length} mais recentes. A exportação traz todas (até{' '}
          {MOVEMENT_EXPORT_LIMIT.toLocaleString('pt-BR')}).
        </Text>
      )}
      {exportError && <Text style={s.error}>{exportError}</Text>}

      {wide && items.length > 0 && (
        <View style={[styles.tr, styles.th]}>
          <Text style={[styles.td, styles.cDate, styles.thText]}>Data</Text>
          <Text style={[styles.td, styles.cType, styles.thText]}>Tipo</Text>
          {multiCompany && <Text style={[styles.td, styles.cCompany, styles.thText]}>Empresa</Text>}
          <Text style={[styles.td, styles.cWarehouse, styles.thText]}>Depósito</Text>
          <Text style={[styles.td, styles.cCc, styles.thText]}>Centro de custo</Text>
          <Text style={[styles.td, styles.cMaterial, styles.thText]}>Material</Text>
          <Text style={[styles.td, styles.cQty, styles.thText, styles.right]}>Quantidade</Text>
          <Text style={[styles.td, styles.cAuthor, styles.thText]}>Registrado por</Text>
        </View>
      )}
    </View>
  );

  if (memberships?.length === 0) return <Text style={s.empty}>{NO_ACCESS}</Text>;

  return (
    <FlatList
      data={items}
      keyExtractor={(m) => m.id}
      contentContainerStyle={[s.list, wide && styles.listWide]}
      ListHeaderComponent={header}
      ListEmptyComponent={
        loading ? (
          <ActivityIndicator style={{ marginTop: 32 }} />
        ) : periodError ? undefined : (
          <Text style={s.empty}>{error ?? 'Nenhuma movimentação encontrada.'}</Text>
        )
      }
      renderItem={({ item }) => {
        const signed = signedQuantity(item.kind, Number(item.quantity));
        const qty = `${signed > 0 ? '+' : '−'}${formatQty(Math.abs(signed))} ${item.material?.unit ?? ''}`;
        const open = () => router.push(`/history/${item.id}`);
        if (wide) {
          return (
            <Pressable style={styles.tr} onPress={open}>
              <Text style={[styles.td, styles.cDate]}>{formatDateTime(item.occurred_at)}</Text>
              <Text style={[styles.td, styles.cType]} numberOfLines={1}>
                {movementTitle(item, MOVEMENT_LABELS)}
              </Text>
              {multiCompany && (
                <Text style={[styles.td, styles.cCompany]} numberOfLines={1}>
                  {item.company?.name ?? '—'}
                </Text>
              )}
              <Text style={[styles.td, styles.cWarehouse]} numberOfLines={1}>
                {item.warehouse?.name ?? 'outra empresa'}
              </Text>
              <Text style={[styles.td, styles.cCc]} numberOfLines={1}>
                {item.cost_center ? `${item.cost_center.code} · ${item.cost_center.name}` : '—'}
              </Text>
              <Text style={[styles.td, styles.cMaterial]} numberOfLines={1}>
                {item.material?.name ?? 'Material'}
              </Text>
              <Text style={[styles.td, styles.cQty, styles.right, styles.qty, signed < 0 ? styles.neg : styles.pos]}>
                {qty}
              </Text>
              <Text style={[styles.td, styles.cAuthor]} numberOfLines={1}>
                {item.author?.full_name ?? (item.source === 'import' ? 'importado' : '—')}
              </Text>
            </Pressable>
          );
        }
        return (
          <Pressable style={s.item} onPress={open}>
            <View style={styles.top}>
              <Text style={[s.itemTitle, s.flex]} numberOfLines={1}>
                {item.material?.name ?? 'Material'}
              </Text>
              <Text style={[styles.qty, signed < 0 ? styles.neg : styles.pos]}>{qty}</Text>
            </View>
            <Text style={s.itemSub}>
              {movementTitle(item, MOVEMENT_LABELS)} · {item.warehouse?.name ?? 'outra empresa'}
            </Text>
            <Text style={s.hint}>
              {formatDateTime(item.occurred_at)} · {item.cost_center?.code ?? '—'}
              {multiCompany && item.company ? ` · ${item.company.name}` : ''}
              {item.author ? ` · ${item.author.full_name}` : item.source === 'import' ? ' · importado' : ''}
            </Text>
          </Pressable>
        );
      }}
    />
  );
}

function ExportButton({
  label,
  busy,
  disabled,
  onPress,
}: {
  label: string;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.exportButton, (disabled || busy) && s.disabled]} onPress={onPress} disabled={disabled || busy}>
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.exportText}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { gap: 12, marginBottom: 8 },
  listWide: { maxWidth: 1400, gap: 0 },
  filters: { gap: 14 },
  filtersWide: { gap: 12 },
  periodWide: { maxWidth: 420 },
  pill: { alignSelf: 'flex-start', borderRadius: 16, backgroundColor: '#fff4ee', borderWidth: 1, borderColor: ACCENT, paddingVertical: 6, paddingHorizontal: 12 },
  pillText: { color: ACCENT, fontWeight: '600' },
  summary: { gap: 8, marginTop: 4 },
  summaryWide: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  total: { fontSize: 18, fontWeight: '700' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  exportButton: { backgroundColor: ACCENT, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 14, alignItems: 'center', minWidth: 120 },
  exportText: { color: '#fff', fontWeight: '600' },
  tr: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderColor: '#e2e2e2', backgroundColor: '#fff', paddingVertical: 8 },
  th: { backgroundColor: '#f4f4f4', borderTopWidth: 1, marginTop: 4 },
  thText: { fontWeight: '700', color: '#333' },
  td: { paddingHorizontal: 8, fontSize: 14 },
  right: { textAlign: 'right' },
  cDate: { width: 140 },
  cType: { flex: 2 },
  cCompany: { flex: 1.5 },
  cWarehouse: { flex: 1.5 },
  cCc: { flex: 1.5 },
  cMaterial: { flex: 2 },
  cQty: { width: 130 },
  cAuthor: { flex: 1.3 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qty: { fontSize: 16, fontWeight: '700' },
  pos: { color: '#1b6e3a' },
  neg: { color: '#b3261e' },
});
