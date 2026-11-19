import { parseDecimal, type Material, type StockBalance, type StockMinimum } from '@buildops/shared';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ACCENT, Chips, Field, formStyles as s, friendlyDbError, PrimaryButton } from '@/components/form';
import { rows } from '@/lib/data';
import { supabase } from '@/lib/supabase';

const formatQty = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

type Line = { material: Pick<Material, 'id' | 'name' | 'unit'>; text: string; saved: number | null };

export default function WarehouseMinimumsScreen() {
  const { warehouseId } = useLocalSearchParams<{ warehouseId: string }>();

  const [warehouseName, setWarehouseName] = useState('');
  const [materials, setMaterials] = useState<Pick<Material, 'id' | 'name' | 'unit' | 'sku'>[]>([]);
  const [balance, setBalance] = useState<Map<string, number>>(new Map());
  const [lines, setLines] = useState<Line[] | null>(null);
  const [query, setQuery] = useState('');
  /** Saved minimums the user removed; deleted on save. */
  const [removed, setRemoved] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [w, m, mins, b] = await Promise.all([
          supabase.from('warehouses').select('name').eq('id', warehouseId),
          supabase.from('materials').select('id, name, unit, sku').eq('active', true).order('name'),
          supabase.from('stock_minimums').select('warehouse_id, material_id, min_quantity').eq('warehouse_id', warehouseId),
          supabase.rpc('get_stock_balances'),
        ]);
        const [warehouse] = rows<{ name: string }[]>(w);
        if (!warehouse) throw new Error('Depósito não encontrado.');
        const mats = rows<(Material & { sku: string | null })[]>(m);
        const all = new Map(mats.map((x) => [x.id, x]));
        setWarehouseName(warehouse.name);
        setMaterials(mats);
        setBalance(
          new Map(
            rows<StockBalance[]>(b)
              .filter((x) => x.warehouse_id === warehouseId)
              .map((x) => [x.material_id, Number(x.quantity)]),
          ),
        );
        setLines(
          rows<StockMinimum[]>(mins)
            .filter((x) => all.has(x.material_id))
            .map((x) => ({
              material: all.get(x.material_id)!,
              text: formatQty(Number(x.min_quantity)),
              saved: Number(x.min_quantity),
            }))
            .sort((a, z) => a.material.name.localeCompare(z.material.name, 'pt-BR')),
        );
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [warehouseId]);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !lines) return [];
    const used = new Set(lines.map((l) => l.material.id));
    return materials
      .filter((m) => !used.has(m.id) && (m.name.toLowerCase().includes(q) || m.sku?.toLowerCase().includes(q)))
      .slice(0, 8);
  }, [query, lines, materials]);

  function add(materialId: string) {
    const m = materials.find((x) => x.id === materialId);
    if (!m || !lines) return;
    setLines([...lines, { material: m, text: '', saved: null }]);
    setRemoved(removed.filter((id) => id !== materialId));
    setQuery('');
  }

  function remove(materialId: string) {
    if (!lines) return;
    const line = lines.find((l) => l.material.id === materialId);
    if (line?.saved !== null) setRemoved([...removed, materialId]);
    setLines(lines.filter((l) => l.material.id !== materialId));
  }

  function setText(materialId: string, text: string) {
    setLines((ls) => ls?.map((l) => (l.material.id === materialId ? { ...l, text } : l)) ?? null);
  }

  async function save() {
    if (!lines) return;
    setError(null);
    const upserts: StockMinimum[] = [];
    for (const l of lines) {
      const min = parseDecimal(l.text);
      if (min === null) return setError(`Informe um mínimo válido para ${l.material.name} (ou remova a linha).`);
      if (min !== l.saved) upserts.push({ warehouse_id: warehouseId, material_id: l.material.id, min_quantity: min });
    }

    setSaving(true);
    try {
      if (upserts.length) {
        const res = await supabase
          .from('stock_minimums')
          .upsert(upserts, { onConflict: 'warehouse_id,material_id' })
          .select('material_id');
        if (res.error) throw res.error;
        if ((res.data?.length ?? 0) < upserts.length) throw new Error('Seu perfil não pode definir mínimos neste depósito.');
      }
      if (removed.length) {
        const res = await supabase
          .from('stock_minimums')
          .delete()
          .eq('warehouse_id', warehouseId)
          .in('material_id', removed)
          .select('material_id');
        if (res.error) throw res.error;
        if ((res.data?.length ?? 0) < removed.length) throw new Error('Seu perfil não pode remover mínimos neste depósito.');
      }
      router.back();
    } catch (e) {
      const err = e as { code?: string; message: string };
      setError(friendlyDbError(err.code, err.message));
      setSaving(false);
    }
  }

  if (!lines) return error ? <Text style={s.center}>{error}</Text> : <ActivityIndicator style={s.center} />;

  return (
    <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: `Mínimos · ${warehouseName}` }} />
      <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
        <Text style={s.hint}>
          Quando o saldo fica abaixo do mínimo, o material aparece em destaque na tela de saldos.
        </Text>

        {lines.length === 0 && <Text style={s.hint}>Nenhum mínimo definido neste depósito.</Text>}
        {lines.map((l) => {
          const current = balance.get(l.material.id) ?? 0;
          const min = parseDecimal(l.text);
          const below = min !== null && current < min;
          return (
            <View key={l.material.id} style={[styles.line, below && styles.lineAlert]}>
              <View style={s.flex}>
                <Text style={s.itemTitle}>{l.material.name}</Text>
                <Text style={[s.itemSub, below && styles.alert]}>
                  Saldo: {formatQty(current)} {l.material.unit}
                  {below ? ' · abaixo do mínimo' : ''}
                </Text>
                <Pressable onPress={() => remove(l.material.id)} hitSlop={8}>
                  <Text style={[s.link, styles.remove]}>Remover</Text>
                </Pressable>
              </View>
              <View style={styles.minBox}>
                <TextInput
                  style={[s.input, styles.minInput]}
                  value={l.text}
                  onChangeText={(t) => setText(l.material.id, t)}
                  keyboardType="decimal-pad"
                  placeholder="Mínimo"
                  accessibilityLabel={`Mínimo de ${l.material.name}`}
                />
                <Text style={s.hint}>{l.material.unit}</Text>
              </View>
            </View>
          );
        })}

        <Field label="Adicionar material">
          <TextInput style={s.input} value={query} onChangeText={setQuery} placeholder="Buscar por nome ou código" />
          {query.trim() !== '' && (
            <Chips
              options={candidates.map((m) => ({ id: m.id, label: `${m.name} (${m.unit})` }))}
              value={null}
              onChange={add}
              emptyText="Nenhum material encontrado (ou já está na lista)."
            />
          )}
        </Field>

        {error && <Text style={s.error}>{error}</Text>}
        <PrimaryButton label="Salvar mínimos" onPress={save} busy={saving} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', gap: 12, alignItems: 'center', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#ddd', backgroundColor: '#fff' },
  lineAlert: { borderColor: ACCENT, backgroundColor: '#fff4ee' },
  alert: { color: ACCENT, fontWeight: '600' },
  remove: { marginTop: 6, fontSize: 13 },
  minBox: { alignItems: 'center', gap: 2 },
  minInput: { width: 110, textAlign: 'right' },
});
