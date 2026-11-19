import {
  hasRoleInCompany,
  MASTER_DATA_ROLES,
  SITE_STATUS_LABELS,
  SITE_STATUSES,
  type Company,
  type CostCenter,
  type Site,
  type SiteStatus,
} from '@buildops/shared';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Switch, Text, TextInput, View } from 'react-native';

import { ACCENT, Chips, Field, formStyles as s, friendlyDbError, PrimaryButton } from '@/components/form';
import { useMemberships } from '@/lib/access';
import { rows } from '@/lib/data';
import { supabase } from '@/lib/supabase';

export default function SiteFormScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const { memberships } = useMemberships();

  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [costCenterId, setCostCenterId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [status, setStatus] = useState<SiteStatus>('active');
  const [createWarehouse, setCreateWarehouse] = useState(true);
  /** Set when the site was saved but its warehouse wasn't: a retry only creates the warehouse. */
  const [createdSiteId, setCreatedSiteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [c, cc] = await Promise.all([
          supabase.from('companies').select('id, name').order('name'),
          supabase.from('cost_centers').select('id, company_id, code, name').eq('active', true).order('code'),
        ]);
        setCostCenters(rows<CostCenter[]>(cc));
        if (!isNew) {
          const [x] = rows<Site[]>(
            await supabase.from('sites').select('id, company_id, cost_center_id, name, address, status').eq('id', id),
          );
          if (!x) throw new Error('Obra não encontrada.');
          setCompanyId(x.company_id);
          setCostCenterId(x.cost_center_id);
          setName(x.name);
          setAddress(x.address ?? '');
          setStatus(x.status);
        }
        setCompanies(rows<Company[]>(c));
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [id, isNew]);

  const companyOptions = useMemo(
    () =>
      (companies ?? []).filter((c) => memberships && hasRoleInCompany(memberships, c.id, MASTER_DATA_ROLES.sites)),
    [companies, memberships],
  );

  useEffect(() => {
    if (isNew && !companyId && companyOptions.length === 1) setCompanyId(companyOptions[0]?.id ?? null);
  }, [isNew, companyId, companyOptions]);

  const costCenterOptions = costCenters
    .filter((cc) => cc.company_id === companyId)
    .map((cc) => ({ id: cc.id, label: `${cc.code} · ${cc.name}` }));

  function chooseCompany(next: string) {
    setCompanyId(next);
    setCostCenterId(null);
  }

  async function save() {
    setError(null);
    if (!companyId || !costCenterId) return setError('Escolha a empresa e o centro de custo.');
    if (!name.trim()) return setError('Informe o nome da obra.');

    const fields = { name: name.trim(), address: address.trim() || null, status, cost_center_id: costCenterId };
    setSaving(true);
    try {
      if (isNew) {
        let siteId = createdSiteId;
        if (!siteId) {
          const res = await supabase.from('sites').insert({ ...fields, company_id: companyId }).select('id');
          if (res.error) throw res.error;
          siteId = (res.data?.[0]?.id as string | undefined) ?? null;
          if (!siteId) throw new Error('Seu perfil não tem permissão para cadastrar obras.');
          setCreatedSiteId(siteId);
        }

        if (createWarehouse) {
          const w = await supabase
            .from('warehouses')
            .insert({ company_id: companyId, site_id: siteId, name: `Canteiro ${fields.name}` });
          // The site is already saved; report the warehouse failure without losing it.
          if (w.error) {
            setSaving(false);
            setError(
              `Obra cadastrada, mas o depósito do canteiro não foi criado: ${w.error.message}. Toque de novo para tentar só o depósito, ou desligue a opção.`,
            );
            return;
          }
        }
      } else {
        const res = await supabase.from('sites').update(fields).eq('id', id).select('id');
        if (res.error) throw res.error;
        if (!res.data?.length) throw new Error('Seu perfil não tem permissão para editar esta obra.');
      }
      router.back();
    } catch (e) {
      const err = e as { code?: string; message: string };
      setError(friendlyDbError(err.code, err.message));
      setSaving(false);
    }
  }

  if (!companies) return error ? <Text style={s.center}>{error}</Text> : <ActivityIndicator style={s.center} />;
  const companyName = companies.find((c) => c.id === companyId)?.name;

  return (
    <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: isNew ? 'Nova obra' : 'Editar obra' }} />
      <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
        <Field label="Empresa" hint={isNew ? undefined : 'A empresa não muda depois do cadastro.'}>
          {isNew ? (
            <Chips options={companyOptions.map((c) => ({ id: c.id, label: c.name }))} value={companyId} onChange={chooseCompany} />
          ) : (
            <Text style={s.readonly}>{companyName}</Text>
          )}
        </Field>

        {companyId && (
          <Field label="Centro de custo" hint="Para onde vão os custos da obra.">
            <Chips
              options={costCenterOptions}
              value={costCenterId}
              onChange={setCostCenterId}
              emptyText="Nenhum centro de custo ativo nesta empresa."
            />
          </Field>
        )}

        <Field label="Nome">
          <TextInput style={s.input} value={name} onChangeText={setName} placeholder="Ex.: Residencial Jardim" />
        </Field>

        <Field label="Endereço" hint="Opcional">
          <TextInput style={s.input} value={address} onChangeText={setAddress} />
        </Field>

        <Field label="Situação">
          <Chips
            options={SITE_STATUSES.map((st) => ({ id: st, label: SITE_STATUS_LABELS[st] }))}
            value={status}
            onChange={(v) => setStatus(v as SiteStatus)}
          />
        </Field>

        {isNew && (
          <View style={[s.row, { alignItems: 'center', justifyContent: 'space-between' }]}>
            <View style={s.flex}>
              <Text style={s.label}>Criar depósito do canteiro</Text>
              <Text style={s.hint}>Cria "Canteiro {name.trim() || '…'}" ligado a esta obra.</Text>
            </View>
            <Switch value={createWarehouse} onValueChange={setCreateWarehouse} trackColor={{ true: ACCENT }} thumbColor="#fff" />
          </View>
        )}

        {error && <Text style={s.error}>{error}</Text>}
        <PrimaryButton
          label={
            createdSiteId
              ? createWarehouse
                ? 'Criar depósito do canteiro'
                : 'Concluir'
              : isNew
                ? 'Cadastrar obra'
                : 'Salvar'
          }
          onPress={save}
          busy={saving}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
