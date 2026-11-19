import { hasRoleInCompany, MASTER_DATA_ROLES, type Company, type CostCenter } from '@buildops/shared';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Switch, Text, TextInput, View } from 'react-native';

import { ACCENT, Chips, Field, formStyles as s, friendlyDbError, PrimaryButton } from '@/components/form';
import { useMemberships } from '@/lib/access';
import { rows } from '@/lib/data';
import { supabase } from '@/lib/supabase';

export default function CostCenterFormScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const { memberships } = useMemberships();

  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const c = await supabase.from('companies').select('id, name').order('name');
        if (!isNew) {
          const [cc] = rows<Required<CostCenter>[]>(
            await supabase.from('cost_centers').select('id, company_id, code, name, active').eq('id', id),
          );
          if (!cc) throw new Error('Centro de custo não encontrado.');
          setCompanyId(cc.company_id);
          setCode(cc.code);
          setName(cc.name);
          setActive(cc.active);
        }
        setCompanies(rows<Company[]>(c));
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [id, isNew]);

  const companyOptions = useMemo(
    () =>
      (companies ?? []).filter(
        (c) => memberships && hasRoleInCompany(memberships, c.id, MASTER_DATA_ROLES.costCenters),
      ),
    [companies, memberships],
  );

  useEffect(() => {
    if (isNew && !companyId && companyOptions.length === 1) setCompanyId(companyOptions[0]?.id ?? null);
  }, [isNew, companyId, companyOptions]);

  async function save() {
    setError(null);
    if (!companyId) return setError('Escolha a empresa.');
    if (!code.trim() || !name.trim()) return setError('Informe o código e o nome.');

    const fields = { code: code.trim().toUpperCase(), name: name.trim(), active };
    setSaving(true);
    const res = isNew
      ? await supabase.from('cost_centers').insert({ ...fields, company_id: companyId }).select('id')
      : await supabase.from('cost_centers').update(fields).eq('id', id).select('id');
    setSaving(false);

    if (res.error) {
      return setError(friendlyDbError(res.error.code, res.error.message, `Já existe o código ${fields.code} nesta empresa.`));
    }
    if (!res.data?.length) return setError('Seu perfil não tem permissão para editar este centro de custo.');
    router.back();
  }

  if (!companies) return error ? <Text style={s.center}>{error}</Text> : <ActivityIndicator style={s.center} />;
  const companyName = companies.find((c) => c.id === companyId)?.name;

  return (
    <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: isNew ? 'Novo centro de custo' : 'Editar centro de custo' }} />
      <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
        <Field label="Empresa" hint={isNew ? undefined : 'A empresa não muda depois do cadastro.'}>
          {isNew ? (
            <Chips options={companyOptions.map((c) => ({ id: c.id, label: c.name }))} value={companyId} onChange={setCompanyId} />
          ) : (
            <Text style={s.readonly}>{companyName}</Text>
          )}
        </Field>

        <Field label="Código" hint="O mesmo usado pelo financeiro. Único na empresa.">
          <TextInput
            style={s.input}
            value={code}
            onChangeText={(t) => setCode(t.toUpperCase())}
            autoCapitalize="characters"
            placeholder="Ex.: OB-003"
          />
        </Field>

        <Field label="Nome">
          <TextInput style={s.input} value={name} onChangeText={setName} placeholder="Ex.: Condomínio das Flores" />
        </Field>

        <View style={[s.row, { alignItems: 'center', justifyContent: 'space-between' }]}>
          <View style={s.flex}>
            <Text style={s.label}>Ativo</Text>
            <Text style={s.hint}>
              Inativos não aparecem nos lançamentos. Só pode desativar se nenhuma obra em andamento usar este centro.
            </Text>
          </View>
          <Switch value={active} onValueChange={setActive} trackColor={{ true: ACCENT }} thumbColor="#fff" />
        </View>

        {error && <Text style={s.error}>{error}</Text>}
        <PrimaryButton label={isNew ? 'Cadastrar centro de custo' : 'Salvar'} onPress={save} busy={saving} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
