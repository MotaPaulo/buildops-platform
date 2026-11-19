import {
  BALANCE_VIEW_LABELS,
  BALANCE_VIEWS,
  canEditMasterData,
  groupBalances,
  MASTER_DATA_ROLES,
  type BalanceGroupRow,
  type BalanceView,
  type MasterDataKind,
  type StockBalance,
} from '@buildops/shared';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';

import { ACCENT, Chips } from '@/components/form';
import { useMemberships } from '@/lib/access';
import { rows as resultRows } from '@/lib/data';
import { formatQty } from '@/lib/movements';
import { supabase } from '@/lib/supabase';

type SiteRef = { id: string; name: string; cost_center: { code: string } | null };

function HeaderActions() {
  const { memberships } = useMemberships();
  const canEditAny =
    !!memberships &&
    (Object.keys(MASTER_DATA_ROLES) as MasterDataKind[]).some((k) => canEditMasterData(memberships, k));

  return (
    <View style={styles.headerActions}>
      {!!memberships?.length && (
        <Pressable onPress={() => router.push('/history')} hitSlop={8}>
          <Text style={styles.headerLink}>Histórico</Text>
        </Pressable>
      )}
      {canEditAny && (
        <Pressable onPress={() => router.push('/master-data')} hitSlop={8}>
          <Text style={styles.headerLink}>Cadastros</Text>
        </Pressable>
      )}
      <Pressable onPress={() => supabase.auth.signOut()} hitSlop={8}>
        <Text>Sair</Text>
      </Pressable>
    </View>
  );
}

export default function StockBalancesScreen() {
  const { memberships } = useMemberships();
  const noAccess = memberships?.length === 0;

  const [balances, setBalances] = useState<StockBalance[]>([]);
  const [sites, setSites] = useState<SiteRef[]>([]);
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [view, setView] = useState<BalanceView>('warehouse');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [b, st, c] = await Promise.all([
        supabase.rpc('get_stock_balances'),
        supabase.from('sites').select('id, name, cost_center:cost_centers(code)'),
        supabase.from('companies').select('id, name'),
      ]);
      setBalances(resultRows<StockBalance[]>(b));
      setSites(resultRows<SiteRef[]>(st));
      setCompanies(resultRows<{ id: string; name: string }[]>(c));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
    setRefreshing(false);
  }, []);

  // Reload when returning from a form.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Views that add information: "Empresa" only with more than one company.
  const views = BALANCE_VIEWS.filter((v) => v !== 'company' || companies.length > 1);

  const sections = useMemo(() => {
    const siteLabel = new Map(
      sites.map((x) => [x.id, x.cost_center ? `${x.cost_center.code} · ${x.name}` : x.name]),
    );
    const companyName = new Map(companies.map((c) => [c.id, c.name]));
    return groupBalances(balances, view, {
      site: (id) => siteLabel.get(id) ?? 'Obra',
      company: (id) => companyName.get(id) ?? 'Empresa',
      noSite: 'Almoxarifados (sem obra)',
      group: companies.length > 1 ? 'Todas as empresas' : 'Total',
    }).map((g) => ({ ...g, data: g.rows }));
  }, [balances, sites, companies, view]);

  function open(row: BalanceGroupRow) {
    if (row.warehouse_id) {
      router.push({ pathname: '/movement', params: { warehouseId: row.warehouse_id, materialId: row.material_id } });
    } else {
      router.push({ pathname: '/history', params: { materialId: row.material_id } });
    }
  }

  const emptyText =
    error ??
    (refreshing
      ? 'Carregando…'
      : noAccess
        ? 'Seu usuário ainda não tem acesso a nenhuma empresa. Peça à diretoria para liberar.'
        : 'Nenhum saldo para as empresas do seu perfil.');

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerRight: () => <HeaderActions /> }} />
      <SectionList
        sections={sections}
        keyExtractor={(r, i) => `${r.warehouse_id ?? ''}:${r.material_id}:${i}`}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          balances.length ? (
            <View style={styles.views}>
              <Chips
                options={views.map((v) => ({ id: v, label: BALANCE_VIEW_LABELS[v] }))}
                value={view}
                onChange={(v) => setView(v as BalanceView)}
              />
              {view !== 'warehouse' && (
                <Text style={styles.hint}>Soma dos depósitos. Toque num material para ver o histórico.</Text>
              )}
            </View>
          ) : undefined
        }
        ListEmptyComponent={<Text style={styles.empty}>{emptyText}</Text>}
        renderSectionHeader={({ section }) => <Text style={styles.section}>{section.title}</Text>}
        renderItem={({ item }) => {
          const alert = item.below_minimum_count > 0;
          return (
            <Pressable style={[styles.row, alert && styles.rowAlert]} onPress={() => open(item)}>
              <View style={styles.info}>
                <Text style={styles.material}>{item.material_name}</Text>
                {alert && (
                  <Text style={styles.alert}>
                    {item.warehouse_id
                      ? `Abaixo do mínimo (${formatQty(minimumOf(balances, item) ?? 0)} ${item.unit})`
                      : `Abaixo do mínimo em ${item.below_minimum_count} ${item.below_minimum_count === 1 ? 'depósito' : 'depósitos'}`}
                  </Text>
                )}
              </View>
              <Text style={styles.qty}>
                {formatQty(item.quantity)} {item.unit}
              </Text>
            </Pressable>
          );
        }}
      />
      {memberships && !noAccess && (
        <Pressable style={styles.fab} onPress={() => router.push('/movement')}>
          <Text style={styles.fabText}>+ Nova movimentação</Text>
        </Pressable>
      )}
    </View>
  );
}

function minimumOf(balances: StockBalance[], row: BalanceGroupRow) {
  return balances.find((b) => b.warehouse_id === row.warehouse_id && b.material_id === row.material_id)?.min_quantity;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  headerActions: { flexDirection: 'row', gap: 16, paddingHorizontal: 12 },
  headerLink: { color: ACCENT, fontWeight: '600' },
  list: { padding: 16, paddingBottom: 96, gap: 8, maxWidth: 640, width: '100%', alignSelf: 'center' },
  views: { gap: 6, marginBottom: 4 },
  hint: { fontSize: 13, color: '#666' },
  section: { fontSize: 13, fontWeight: '700', color: ACCENT, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 12 },
  fab: { position: 'absolute', right: 16, bottom: 24, backgroundColor: ACCENT, borderRadius: 28, paddingVertical: 14, paddingHorizontal: 20, elevation: 4, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  fabText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  empty: { textAlign: 'center', color: '#666', marginTop: 32 },
  row: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 8, borderWidth: 1, borderColor: '#ddd', backgroundColor: '#fff' },
  rowAlert: { borderColor: ACCENT, backgroundColor: '#fff4ee' },
  info: { flex: 1, gap: 2 },
  material: { fontSize: 16, fontWeight: '600' },
  alert: { color: ACCENT, fontWeight: '600', marginTop: 2 },
  qty: { fontSize: 16, fontWeight: '700' },
});
