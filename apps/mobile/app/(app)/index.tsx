import type { StockBalance } from '@buildops/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { supabase } from '@/lib/supabase';

const formatQty = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

export default function StockBalancesScreen() {
  const [rows, setRows] = useState<StockBalance[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    const { data, error } = await supabase.rpc('get_stock_balances');
    if (error) setError(error.message);
    else {
      setError(null);
      setRows((data ?? []) as StockBalance[]);
    }
    setRefreshing(false);
  }, []);

  // Reload when returning from the movement form.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <View style={styles.screen}>
      <FlatList
        data={rows}
        keyExtractor={(r) => `${r.warehouse_id}:${r.material_id}`}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {error ?? (refreshing ? 'Carregando…' : 'Nenhum saldo para as empresas do seu perfil.')}
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable
            style={[styles.row, item.below_minimum && styles.rowAlert]}
            onPress={() =>
              router.push({
                pathname: '/movement',
                params: { warehouseId: item.warehouse_id, materialId: item.material_id },
              })
            }
          >
            <View style={styles.info}>
              <Text style={styles.material}>{item.material_name}</Text>
              <Text style={styles.warehouse}>{item.warehouse_name}</Text>
              {item.below_minimum && (
                <Text style={styles.alert}>
                  Abaixo do mínimo ({formatQty(item.min_quantity ?? 0)} {item.unit})
                </Text>
              )}
            </View>
            <Text style={styles.qty}>
              {formatQty(item.quantity)} {item.unit}
            </Text>
          </Pressable>
        )}
      />
      <Pressable style={styles.fab} onPress={() => router.push('/movement')}>
        <Text style={styles.fabText}>+ Nova movimentação</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  list: { padding: 16, paddingBottom: 96, gap: 8 },
  fab: { position: 'absolute', right: 16, bottom: 24, backgroundColor: '#b8430f', borderRadius: 28, paddingVertical: 14, paddingHorizontal: 20, elevation: 4, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  fabText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  empty: { textAlign: 'center', color: '#666', marginTop: 32 },
  row: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 8, borderWidth: 1, borderColor: '#ddd' },
  rowAlert: { borderColor: '#b8430f', backgroundColor: '#fff4ee' },
  info: { flex: 1, gap: 2 },
  material: { fontSize: 16, fontWeight: '600' },
  warehouse: { color: '#555' },
  alert: { color: '#b8430f', fontWeight: '600', marginTop: 2 },
  qty: { fontSize: 16, fontWeight: '700' },
});
