import type { Material } from '@buildops/shared';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';

import { Fab, formStyles as s } from '@/components/form';
import { rows, useFocusData } from '@/lib/data';
import { supabase } from '@/lib/supabase';

export default function MaterialsScreen() {
  const [query, setQuery] = useState('');
  const { data, error } = useFocusData(async () =>
    rows<Material[]>(await supabase.from('materials').select('id, sku, name, unit, category, active').order('name')),
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!data || !q) return data ?? [];
    return data.filter((m) =>
      [m.name, m.sku, m.category].some((v) => v?.toLowerCase().includes(q)),
    );
  }, [data, query]);

  return (
    <View style={s.flex}>
      <FlatList
        data={filtered}
        keyExtractor={(m) => m.id}
        contentContainerStyle={s.list}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <TextInput
            style={s.input}
            placeholder="Buscar por nome, código ou categoria"
            value={query}
            onChangeText={setQuery}
          />
        }
        ListEmptyComponent={
          <Text style={s.empty}>{error ?? (data ? 'Nenhum material encontrado.' : 'Carregando…')}</Text>
        }
        renderItem={({ item }) => (
          <Pressable
            style={[s.item, !item.active && s.itemInactive]}
            onPress={() => router.push(`/master-data/materials/${item.id}`)}
          >
            <Text style={s.itemTitle}>{item.name}</Text>
            <Text style={s.itemSub}>
              {[item.sku, item.unit, item.category].filter(Boolean).join(' · ')}
            </Text>
            {!item.active && <Text style={s.badge}>Inativo</Text>}
          </Pressable>
        )}
      />
      <Fab label="+ Novo material" onPress={() => router.push('/master-data/materials/new')} />
    </View>
  );
}
