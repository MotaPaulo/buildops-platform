import { canEditMasterData, COMMON_UNITS, type Material } from '@buildops/shared';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Switch, Text, TextInput, View } from 'react-native';

import { ACCENT, Chips, Field, formStyles as s, friendlyDbError, PrimaryButton } from '@/components/form';
import { useMemberships } from '@/lib/access';
import { rows } from '@/lib/data';
import { supabase } from '@/lib/supabase';

export default function MaterialFormScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const { memberships } = useMemberships();

  const [loaded, setLoaded] = useState(isNew);
  const [categories, setCategories] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [unit, setUnit] = useState('');
  const [category, setCategory] = useState('');
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const all = rows<Pick<Material, 'category'>[]>(await supabase.from('materials').select('category'));
        setCategories([...new Set(all.map((m) => m.category).filter((c): c is string => !!c))].sort());
        if (isNew) return;
        const [m] = rows<Material[]>(
          await supabase.from('materials').select('id, sku, name, unit, category, active').eq('id', id),
        );
        if (!m) throw new Error('Material não encontrado.');
        setName(m.name);
        setSku(m.sku ?? '');
        setUnit(m.unit);
        setCategory(m.category ?? '');
        setActive(m.active);
        setLoaded(true);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [id, isNew]);

  const categoryOptions = useMemo(() => {
    const q = category.trim().toLowerCase();
    return categories
      .filter((c) => c.toLowerCase() !== q && (!q || c.toLowerCase().includes(q)))
      .slice(0, 8)
      .map((c) => ({ id: c, label: c }));
  }, [categories, category]);

  async function save() {
    setError(null);
    if (!name.trim() || !unit.trim()) return setError('Informe o nome e a unidade.');

    const row = {
      name: name.trim(),
      sku: sku.trim() ? sku.trim().toUpperCase() : null,
      unit: unit.trim(),
      category: category.trim() || null,
      active,
    };
    setSaving(true);
    const res = isNew
      ? await supabase.from('materials').insert(row).select('id')
      : await supabase.from('materials').update(row).eq('id', id).select('id');
    setSaving(false);

    if (res.error) {
      return setError(friendlyDbError(res.error.code, res.error.message, 'Já existe um material com esse código.'));
    }
    // RLS hides rows the user can't change: an update that matches nothing is a denial.
    if (!res.data?.length) return setError('Seu perfil não tem permissão para editar materiais.');
    router.back();
  }

  if (memberships && !canEditMasterData(memberships, 'materials')) {
    return <Text style={s.center}>Seu perfil não edita materiais.</Text>;
  }
  if (!loaded) return error ? <Text style={s.center}>{error}</Text> : <ActivityIndicator style={s.center} />;

  return (
    <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: isNew ? 'Novo material' : 'Editar material' }} />
      <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
        <Field label="Nome">
          <TextInput style={s.input} value={name} onChangeText={setName} placeholder="Ex.: Cimento CP II 50 kg" />
        </Field>

        <Field
          label="Unidade"
          hint={isNew ? undefined : 'Só pode mudar enquanto o material não tiver movimentações.'}
        >
          <TextInput style={s.input} value={unit} onChangeText={setUnit} autoCapitalize="none" placeholder="Ex.: sc" />
          <Chips options={COMMON_UNITS.map((u) => ({ id: u, label: u }))} value={unit} onChange={setUnit} />
        </Field>

        <Field label="Código (SKU)" hint="Opcional. Único no grupo.">
          <TextInput style={s.input} value={sku} onChangeText={setSku} autoCapitalize="characters" />
        </Field>

        <Field label="Categoria" hint="Opcional">
          <TextInput style={s.input} value={category} onChangeText={setCategory} placeholder="Ex.: Agregados" />
          {categoryOptions.length > 0 && <Chips options={categoryOptions} value={null} onChange={setCategory} />}
        </Field>

        <View style={[s.row, { alignItems: 'center', justifyContent: 'space-between' }]}>
          <View style={s.flex}>
            <Text style={s.label}>Ativo</Text>
            <Text style={s.hint}>Materiais inativos não aparecem nos lançamentos.</Text>
          </View>
          <Switch value={active} onValueChange={setActive} trackColor={{ true: ACCENT }} thumbColor="#fff" />
        </View>

        {error && <Text style={s.error}>{error}</Text>}
        <PrimaryButton label={isNew ? 'Cadastrar material' : 'Salvar'} onPress={save} busy={saving} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
