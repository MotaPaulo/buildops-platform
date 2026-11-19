import { MOVEMENT_LABELS, signedQuantity, type MovementKind } from '@buildops/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { ACCENT, Chips, formStyles as s } from '@/components/form';
import { rows } from '@/lib/data';
import { formatDateTime, formatQty, MOVEMENT_SELECT, movementTitle, type MovementRow } from '@/lib/movements';
import { supabase } from '@/lib/supabase';

const PAGE = 30;
const ALL = 'all';

/** Kind filter: transfers cover both sides. */
const KIND_FILTERS: { id: string; label: string; kinds: MovementKind[] }[] = [
  { id: ALL, label: 'Todos', kinds: [] },
  { id: 'in', label: 'Entradas', kinds: ['in'] },
  { id: 'out', label: 'Saídas', kinds: ['out'] },
  { id: 'transfer', label: 'Transferências', kinds: ['transfer_out', 'transfer_in'] },
  { id: 'adjustment', label: 'Ajustes', kinds: ['adjustment'] },
];

export default function HistoryScreen() {
  const params = useLocalSearchParams<{ warehouseId?: string; materialId?: string }>();

  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([]);
  const [material, setMaterial] = useState<{ id: string; name: string } | null>(null);
  const [materialChecked, setMaterialChecked] = useState(!params.materialId);
  const requestId = useRef(0);
  const [warehouseId, setWarehouseId] = useState<string>(params.warehouseId ?? ALL);
  const [kindFilter, setKindFilter] = useState(ALL);

  const [items, setItems] = useState<MovementRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from('warehouses')
      .select('id, name')
      .order('name')
      .then((r) => setWarehouses(rows(r)), () => {});
    if (params.materialId) {
      supabase
        .from('materials')
        .select('id, name')
        .eq('id', params.materialId)
        .then(
          (r) => setMaterial(rows<{ id: string; name: string }[]>(r)[0] ?? null),
          () => {},
        )
        .then(() => setMaterialChecked(true));
    }
  }, [params.materialId]);

  const materialId = material?.id ?? null;

  const load = useCallback(
    async (offset: number) => {
      const current = ++requestId.current;
      setLoading(true);
      setError(null);
      let q = supabase
        .from('stock_movements')
        .select(MOVEMENT_SELECT)
        .order('occurred_at', { ascending: false })
        .order('id')
        .range(offset, offset + PAGE - 1);
      if (warehouseId !== ALL) q = q.eq('warehouse_id', warehouseId);
      if (materialId) q = q.eq('material_id', materialId);
      const kinds = KIND_FILTERS.find((k) => k.id === kindFilter)?.kinds ?? [];
      if (kinds.length) q = q.in('kind', kinds);

      try {
        const page = rows<MovementRow[]>(await q);
        if (current !== requestId.current) return; // a newer filter replaced this request
        setItems((prev) => (offset === 0 ? page : [...prev, ...page]));
        setHasMore(page.length === PAGE);
      } catch (e) {
        if (current === requestId.current) setError((e as Error).message);
      } finally {
        if (current === requestId.current) setLoading(false);
      }
    },
    [warehouseId, materialId, kindFilter],
  );

  // Wait for the material named in the URL before the first query.
  useEffect(() => {
    if (materialChecked) load(0);
  }, [load, materialChecked]);

  const header = (
    <View style={styles.filters}>
      {material && (
        <Pressable style={styles.pill} onPress={() => setMaterial(null)}>
          <Text style={styles.pillText}>Material: {material.name} ✕</Text>
        </Pressable>
      )}
      <Chips options={KIND_FILTERS.map(({ id, label }) => ({ id, label }))} value={kindFilter} onChange={setKindFilter} />
      {warehouses.length > 1 && (
        <Chips
          options={[{ id: ALL, label: 'Todos os depósitos' }, ...warehouses.map((w) => ({ id: w.id, label: w.name }))]}
          value={warehouseId}
          onChange={setWarehouseId}
        />
      )}
    </View>
  );

  return (
    <FlatList
      data={items}
      keyExtractor={(m) => m.id}
      contentContainerStyle={s.list}
      ListHeaderComponent={header}
      ListEmptyComponent={
        loading ? <ActivityIndicator style={{ marginTop: 32 }} /> : (
          <Text style={s.empty}>{error ?? 'Nenhuma movimentação encontrada.'}</Text>
        )
      }
      ListFooterComponent={
        items.length > 0 ? (
          hasMore ? (
            <Pressable style={styles.more} onPress={() => load(items.length)} disabled={loading}>
              {loading ? <ActivityIndicator color={ACCENT} /> : <Text style={s.link}>Carregar mais</Text>}
            </Pressable>
          ) : (
            <Text style={[s.hint, styles.end]}>{error ?? 'Fim do histórico.'}</Text>
          )
        ) : undefined
      }
      renderItem={({ item }) => {
        const signed = signedQuantity(item.kind, Number(item.quantity));
        return (
          <Pressable style={s.item} onPress={() => router.push(`/history/${item.id}`)}>
            <View style={styles.top}>
              <Text style={[s.itemTitle, s.flex]} numberOfLines={1}>
                {item.material?.name ?? 'Material'}
              </Text>
              <Text style={[styles.qty, signed < 0 ? styles.neg : styles.pos]}>
                {signed > 0 ? '+' : '−'}
                {formatQty(Math.abs(signed))} {item.material?.unit}
              </Text>
            </View>
            <Text style={s.itemSub}>
              {movementTitle(item, MOVEMENT_LABELS)} · {item.warehouse?.name ?? 'outra empresa'}
            </Text>
            <Text style={s.hint}>
              {formatDateTime(item.occurred_at)} · {item.cost_center?.code ?? '—'}
              {item.author ? ` · ${item.author.full_name}` : item.source === 'import' ? ' · importado' : ''}
              {item.photo_path ? ' · com foto' : ''}
            </Text>
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  filters: { gap: 10, marginBottom: 8 },
  pill: { alignSelf: 'flex-start', borderRadius: 16, backgroundColor: '#fff4ee', borderWidth: 1, borderColor: ACCENT, paddingVertical: 6, paddingHorizontal: 12 },
  pillText: { color: ACCENT, fontWeight: '600' },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qty: { fontSize: 16, fontWeight: '700' },
  pos: { color: '#1b6e3a' },
  neg: { color: '#b3261e' },
  more: { padding: 16, alignItems: 'center' },
  end: { textAlign: 'center', padding: 16 },
});
