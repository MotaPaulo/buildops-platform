import {
  hasRoleInCompany,
  MASTER_DATA_ROLES,
  type Company,
  type Site,
  type Warehouse,
} from '@buildops/shared';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Switch, Text, TextInput, View } from 'react-native';

import { ACCENT, Chips, Field, formStyles as s, friendlyDbError, PrimaryButton } from '@/components/form';
import { useMemberships } from '@/lib/access';
import { rows } from '@/lib/data';
import { supabase } from '@/lib/supabase';

const NO_SITE = 'none';

export default function WarehouseFormScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const { memberships } = useMemberships();

  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [siteId, setSiteId] = useState<string>(NO_SITE);
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [c, st] = await Promise.all([
          supabase.from('companies').select('id, name').order('name'),
          supabase.from('sites').select('id, company_id, cost_center_id, name, address, status').order('name'),
        ]);
        setSites(rows<Site[]>(st));
        if (!isNew) {
          const [w] = rows<Warehouse[]>(
            await supabase.from('warehouses').select('id, company_id, site_id, name, active').eq('id', id),
          );
          if (!w) throw new Error('Depósito não encontrado.');
          setCompanyId(w.company_id);
          setName(w.name);
          setSiteId(w.site_id ?? NO_SITE);
          setActive(w.active);
        }
        setCompanies(rows<Company[]>(c));
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [id, isNew]);

  // New warehouses: only companies where the user can manage warehouses.
  const companyOptions = useMemo(
    () =>
      (companies ?? []).filter(
        (c) => memberships && hasRoleInCompany(memberships, c.id, MASTER_DATA_ROLES.warehouses),
      ),
    [companies, memberships],
  );

  useEffect(() => {
    if (isNew && !companyId && companyOptions.length === 1) setCompanyId(companyOptions[0]?.id ?? null);
  }, [isNew, companyId, companyOptions]);

  // Sites of the selected company. Finished sites are hidden unless already linked.
  const siteOptions = useMemo(
    () => [
      { id: NO_SITE, label: 'Nenhuma (almoxarifado)' },
      ...sites
        .filter((x) => x.company_id === companyId && (x.status !== 'finished' || x.id === siteId))
        .map((x) => ({ id: x.id, label: x.name })),
    ],
    [sites, companyId, siteId],
  );

  function chooseCompany(next: string) {
    setCompanyId(next);
    setSiteId(NO_SITE);
  }

  function chooseSite(next: string) {
    setSiteId(next);
    const site = sites.find((x) => x.id === next);
    if (site && !name.trim()) setName(`Canteiro ${site.name}`);
  }

  async function save() {
    setError(null);
    if (!companyId) return setError('Escolha a empresa.');
    if (!name.trim()) return setError('Informe o nome do depósito.');

    const fields = { name: name.trim(), site_id: siteId === NO_SITE ? null : siteId, active };
    setSaving(true);
    const res = isNew
      ? await supabase.from('warehouses').insert({ ...fields, company_id: companyId }).select('id')
      : await supabase.from('warehouses').update(fields).eq('id', id).select('id');
    setSaving(false);

    if (res.error) return setError(friendlyDbError(res.error.code, res.error.message));
    if (!res.data?.length) return setError('Seu perfil não tem permissão para editar este depósito.');
    router.back();
  }

  if (!companies) return error ? <Text style={s.center}>{error}</Text> : <ActivityIndicator style={s.center} />;
  const companyName = companies.find((c) => c.id === companyId)?.name;

  return (
    <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: isNew ? 'Novo depósito' : 'Editar depósito' }} />
      <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
        <Field label="Empresa" hint={isNew ? undefined : 'A empresa não muda depois do cadastro.'}>
          {isNew ? (
            <Chips options={companyOptions.map((c) => ({ id: c.id, label: c.name }))} value={companyId} onChange={chooseCompany} />
          ) : (
            <Text style={s.readonly}>{companyName}</Text>
          )}
        </Field>

        {companyId && (
          <Field label="Obra" hint="Depósito de canteiro fica ligado à obra; almoxarifado central, não.">
            <Chips options={siteOptions} value={siteId} onChange={chooseSite} />
          </Field>
        )}

        <Field label="Nome">
          <TextInput style={s.input} value={name} onChangeText={setName} placeholder="Ex.: Almoxarifado central" />
        </Field>

        <View style={[s.row, { alignItems: 'center', justifyContent: 'space-between' }]}>
          <View style={s.flex}>
            <Text style={s.label}>Ativo</Text>
            <Text style={s.hint}>Depósitos inativos não aparecem nos lançamentos.</Text>
          </View>
          <Switch value={active} onValueChange={setActive} trackColor={{ true: ACCENT }} thumbColor="#fff" />
        </View>

        {error && <Text style={s.error}>{error}</Text>}
        <PrimaryButton label={isNew ? 'Cadastrar depósito' : 'Salvar'} onPress={save} busy={saving} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
