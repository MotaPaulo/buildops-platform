import {
  canAccessCostCenter,
  canAuthorizeTransfer,
  canTransfer,
  hasRoleInCompany,
  parseDecimal,
  type Company,
  type CostCenter,
  type StockBalance,
} from '@buildops/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';

import { Chips, Field, formStyles as s, friendlyDbError, PrimaryButton } from '@/components/form';
import { useMemberships } from '@/lib/access';
import { rows } from '@/lib/data';
import { supabase } from '@/lib/supabase';

type Warehouse = { id: string; company_id: string; site_id: string | null; name: string };
type Site = { id: string; cost_center_id: string };
type Material = { id: string; name: string; unit: string };

const formatQty = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const ccLabel = (cc: CostCenter) => `${cc.code} · ${cc.name}`;

/** Keeps a cost center selection valid: the site's cost center, the only option, or nothing. */
function useSuggestedCostCenter(
  warehouse: Warehouse | null,
  options: CostCenter[],
  sites: Site[],
  value: string | null,
  setValue: (id: string | null) => void,
) {
  useEffect(() => {
    if (value && options.some((cc) => cc.id === value)) return;
    const siteCc = sites.find((x) => x.id === warehouse?.site_id)?.cost_center_id;
    const suggested = options.find((cc) => cc.id === siteCc) ?? (options.length === 1 ? options[0] : null);
    setValue(suggested?.id ?? null);
  }, [warehouse, options, sites, value, setValue]);
}

export default function TransferScreen() {
  const params = useLocalSearchParams<{ warehouseId?: string; materialId?: string }>();
  const { memberships, error: accessError } = useMemberships();

  const [data, setData] = useState<{
    companies: Company[];
    warehouses: Warehouse[];
    costCenters: CostCenter[];
    sites: Site[];
    materials: Material[];
    balances: StockBalance[];
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [fromId, setFromId] = useState<string | null>(params.warehouseId ?? null);
  const [fromCcId, setFromCcId] = useState<string | null>(null);
  const [materialId, setMaterialId] = useState<string | null>(params.materialId ?? null);
  const [quantityText, setQuantityText] = useState('');
  const [toId, setToId] = useState<string | null>(null);
  const [toCcId, setToCcId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      supabase.from('companies').select('id, name').order('name'),
      supabase.from('warehouses').select('id, company_id, site_id, name').eq('active', true).order('name'),
      supabase.from('cost_centers').select('id, company_id, code, name').eq('active', true).order('code'),
      supabase.from('sites').select('id, cost_center_id'),
      supabase.from('materials').select('id, name, unit').eq('active', true).order('name'),
      supabase.rpc('get_stock_balances'),
    ])
      .then(([c, w, cc, st, m, b]) =>
        setData({
          companies: rows<Company[]>(c),
          warehouses: rows<Warehouse[]>(w),
          costCenters: rows<CostCenter[]>(cc),
          sites: rows<Site[]>(st),
          materials: rows<Material[]>(m),
          balances: rows<StockBalance[]>(b),
        }),
      )
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  const companies = data?.companies ?? [];
  const warehouses = data?.warehouses ?? [];
  const costCenters = data?.costCenters ?? [];
  const sites = data?.sites ?? [];
  const m = useMemo(() => memberships ?? [], [memberships]);

  // Origin: warehouses of companies where the user authorizes transfers (manager or director).
  const fromOptions = useMemo(
    () =>
      warehouses.filter(
        (w) =>
          hasRoleInCompany(m, w.company_id, ['manager']) &&
          costCenters.some((cc) => cc.company_id === w.company_id && canAccessCostCenter(m, cc)),
      ),
    [warehouses, costCenters, m],
  );
  const from = fromOptions.find((w) => w.id === fromId) ?? null;

  useEffect(() => {
    if (fromId && !from && fromOptions.length) setFromId(null);
    if (!fromId && fromOptions.length === 1) setFromId(fromOptions[0]?.id ?? null);
  }, [fromId, from, fromOptions]);

  const fromCcOptions = useMemo(
    () => (from ? costCenters.filter((cc) => cc.company_id === from.company_id && canAccessCostCenter(m, cc)) : []),
    [from, costCenters, m],
  );
  useSuggestedCostCenter(from, fromCcOptions, sites, fromCcId, setFromCcId);
  const fromCc = fromCcOptions.find((cc) => cc.id === fromCcId) ?? null;

  // Only materials with stock in the origin warehouse can be transferred.
  const stockAtOrigin = useMemo(() => {
    if (!from || !data) return [];
    return data.balances
      .filter((b) => b.warehouse_id === from.id && b.quantity > 0)
      .filter((b) => data.materials.some((mat) => mat.id === b.material_id));
  }, [from, data]);
  const stock = stockAtOrigin.find((b) => b.material_id === materialId) ?? null;

  useEffect(() => {
    if (materialId && from && data && !stock) setMaterialId(null);
  }, [materialId, from, data, stock]);

  // Destination: any other warehouse with a cost center the transfer can be authorized to.
  const toOptions = useMemo(
    () =>
      from && fromCc
        ? warehouses.filter(
            (w) =>
              w.id !== from.id &&
              costCenters.some((cc) => cc.company_id === w.company_id && canAuthorizeTransfer(m, fromCc, cc)),
          )
        : [],
    [warehouses, costCenters, from, fromCc, m],
  );
  const to = toOptions.find((w) => w.id === toId) ?? null;

  useEffect(() => {
    if (toId && !to) setToId(null);
  }, [toId, to]);

  const toCcOptions = useMemo(
    () =>
      to && fromCc
        ? costCenters.filter((cc) => cc.company_id === to.company_id && canAuthorizeTransfer(m, fromCc, cc))
        : [],
    [to, fromCc, costCenters, m],
  );
  useSuggestedCostCenter(to, toCcOptions, sites, toCcId, setToCcId);

  const showCompany = new Set(warehouses.map((w) => w.company_id)).size > 1;
  const companyName = (id: string) => companies.find((c) => c.id === id)?.name ?? '';
  const warehouseLabel = (w: Warehouse) => (showCompany ? `${w.name} · ${companyName(w.company_id)}` : w.name);

  const crossCompany = !!from && !!to && from.company_id !== to.company_id;
  const parsedQuantity = parseDecimal(quantityText);

  async function save() {
    setFormError(null);
    if (!from || !fromCcId || !stock) return setFormError('Escolha a origem, o centro de custo e o material.');
    if (!parsedQuantity) return setFormError('Informe uma quantidade maior que zero (até 3 casas decimais).');
    if (parsedQuantity > stock.quantity) {
      return setFormError(`Saldo insuficiente: disponível ${formatQty(stock.quantity)} ${stock.unit}.`);
    }
    if (!to || !toCcId) return setFormError('Escolha o destino e o centro de custo de destino.');

    setSaving(true);
    const { error } = await supabase.rpc('create_transfer', {
      p_material_id: stock.material_id,
      p_from_warehouse_id: from.id,
      p_from_cost_center_id: fromCcId,
      p_to_warehouse_id: to.id,
      p_to_cost_center_id: toCcId,
      p_quantity: parsedQuantity,
      p_notes: notes.trim() || undefined,
    });
    setSaving(false);

    // The database message is already specific for permission and balance errors.
    if (error) return setFormError(error.code === '42501' ? error.message : friendlyDbError(error.code, error.message));
    router.back();
  }

  const fatal = accessError ?? loadError;
  if (fatal) return <Text style={s.center}>{fatal}</Text>;
  if (!memberships || !data) return <ActivityIndicator style={s.center} />;
  if (!canTransfer(memberships) || !fromOptions.length) {
    return <Text style={s.center}>Somente gestores ou a diretoria autorizam transferências.</Text>;
  }

  return (
    <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
        <Text style={s.hint}>
          Move material de um depósito para outro. Gera uma saída na origem e uma entrada no destino, com você
          registrado como quem autorizou.
        </Text>

        <Text style={s.section}>Origem</Text>
        <Field label="Depósito de origem">
          <Chips options={fromOptions.map((w) => ({ id: w.id, label: warehouseLabel(w) }))} value={fromId} onChange={setFromId} />
        </Field>

        {from && (
          <Field label="Centro de custo de origem" hint="De quem o material sai">
            <Chips options={fromCcOptions.map((cc) => ({ id: cc.id, label: ccLabel(cc) }))} value={fromCcId} onChange={setFromCcId} />
          </Field>
        )}

        {from && (
          <Field label="Material">
            <Chips
              options={stockAtOrigin.map((b) => ({
                id: b.material_id,
                label: `${b.material_name} (${formatQty(b.quantity)} ${b.unit})`,
              }))}
              value={materialId}
              onChange={setMaterialId}
              emptyText="Este depósito não tem saldo de nenhum material."
            />
          </Field>
        )}

        {stock && (
          <Field label={`Quantidade (${stock.unit})`} hint={`Disponível: ${formatQty(stock.quantity)} ${stock.unit}`}>
            <TextInput
              style={s.input}
              placeholder="0"
              keyboardType="decimal-pad"
              value={quantityText}
              onChangeText={setQuantityText}
            />
            {quantityText.trim() !== '' && (
              <Text style={[s.hint, parsedQuantity === null && s.error]}>
                {parsedQuantity === null
                  ? 'Quantidade inválida (até 3 casas decimais)'
                  : `= ${formatQty(parsedQuantity)} ${stock.unit}`}
              </Text>
            )}
          </Field>
        )}

        {from && fromCc && (
          <>
            <Text style={s.section}>Destino</Text>
            <Field label="Depósito de destino">
              <Chips
                options={toOptions.map((w) => ({ id: w.id, label: warehouseLabel(w) }))}
                value={toId}
                onChange={setToId}
                emptyText="Nenhum outro depósito disponível para o seu perfil."
              />
            </Field>
          </>
        )}

        {to && (
          <Field label="Centro de custo de destino" hint="A quem o material passa a ser apropriado">
            <Chips options={toCcOptions.map((cc) => ({ id: cc.id, label: ccLabel(cc) }))} value={toCcId} onChange={setToCcId} />
          </Field>
        )}

        {crossCompany && (
          <View style={s.notice}>
            <Text style={s.noticeText}>
              Transferência entre empresas ({companyName(from.company_id)} → {companyName(to.company_id)}). Só a
              diretoria autoriza.
            </Text>
          </View>
        )}

        <Field label="Observações" hint="Opcional">
          <TextInput
            style={[s.input, s.multiline]}
            multiline
            value={notes}
            onChangeText={setNotes}
            placeholder="Ex.: sobra da obra, remanejamento"
          />
        </Field>

        {formError && <Text style={s.error}>{formError}</Text>}
        <PrimaryButton label="Transferir" onPress={save} busy={saving} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
