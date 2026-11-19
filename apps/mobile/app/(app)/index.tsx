import type { StockBalance } from '@buildops/shared';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';

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

  useEffect(() => {
    load();
  }, [load]);

  return (
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
        <View style={[styles.row, item.below_minimum && styles.rowAlert]}>
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
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 8 },
  empty: { textAlign: 'center', color: '#666', marginTop: 32 },
  row: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 8, borderWidth: 1, borderColor: '#ddd' },
  rowAlert: { borderColor: '#b8430f', backgroundColor: '#fff4ee' },
  info: { flex: 1, gap: 2 },
  material: { fontSize: 16, fontWeight: '600' },
  warehouse: { color: '#555' },
  alert: { color: '#b8430f', fontWeight: '600', marginTop: 2 },
  qty: { fontSize: 16, fontWeight: '700' },
});
