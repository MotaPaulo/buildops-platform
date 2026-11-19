import {
  canRegisterMovement,
  canTransfer,
  MANUAL_MOVEMENT_KINDS,
  MOVEMENT_LABELS,
  parseDecimal,
  type ManualMovementKind,
  type StockBalance,
} from '@buildops/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ACCENT, Chips, Field } from '@/components/form';
import { useMemberships } from '@/lib/access';
import { formatQty } from '@/lib/movements';
import { pickPhoto, PHOTO_BUCKET, uploadMovementPhoto, type PickedPhoto } from '@/lib/photos';
import { supabase } from '@/lib/supabase';

type Warehouse = { id: string; company_id: string; site_id: string | null; name: string };
type CostCenter = { id: string; company_id: string; code: string; name: string };
type Site = { id: string; cost_center_id: string };
type Material = { id: string; sku: string | null; name: string; unit: string };


/** Extra option in the kind selector that opens the transfer screen. */
const TRANSFER = 'transfer';

const KIND_HINTS: Record<ManualMovementKind, string> = {
  in: 'Compra ou devolução de material',
  out: 'Consumo na obra',
  adjustment: 'Correção após contagem física',
};

export default function NewMovementScreen() {
  const params = useLocalSearchParams<{ warehouseId?: string; materialId?: string }>();
  const { memberships, error: accessError } = useMemberships();

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [balances, setBalances] = useState<StockBalance[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const [kind, setKind] = useState<ManualMovementKind | null>(null);
  const [warehouseId, setWarehouseId] = useState<string | null>(params.warehouseId ?? null);
  const [costCenterId, setCostCenterId] = useState<string | null>(null);
  const [materialId, setMaterialId] = useState<string | null>(params.materialId ?? null);
  const [materialQuery, setMaterialQuery] = useState('');
  const [quantityText, setQuantityText] = useState('');
  const [adjustDown, setAdjustDown] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [unitCostText, setUnitCostText] = useState('');
  const [notes, setNotes] = useState('');
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      supabase.from('warehouses').select('id, company_id, site_id, name').eq('active', true).order('name'),
      supabase.from('cost_centers').select('id, company_id, code, name').eq('active', true).order('code'),
      supabase.from('sites').select('id, cost_center_id'),
      supabase.from('materials').select('id, sku, name, unit').eq('active', true).order('name'),
      supabase.rpc('get_stock_balances'),
    ]).then(([w, cc, s, m, b]) => {
      const failed = [w, cc, s, m, b].find((r) => r.error);
      if (failed?.error) return setLoadError(failed.error.message);
      setWarehouses(w.data as Warehouse[]);
      setCostCenters(cc.data as CostCenter[]);
      setSites(s.data as Site[]);
      setMaterials(m.data as Material[]);
      setBalances(b.data as StockBalance[]);
      setLoaded(true);
    });
  }, []);

  // Kinds the user can record in at least one cost center.
  const allowedKinds = useMemo(
    () =>
      memberships
        ? MANUAL_MOVEMENT_KINDS.filter((k) => costCenters.some((cc) => canRegisterMovement(memberships, k, cc)))
        : [],
    [memberships, costCenters],
  );

  useEffect(() => {
    if (!kind && allowedKinds.length) setKind(allowedKinds.includes('out') ? 'out' : (allowedKinds[0] ?? null));
  }, [allowedKinds, kind]);

  // Cost centers where the selected kind is allowed.
  const allowedCostCenters = useMemo(
    () => (memberships && kind ? costCenters.filter((cc) => canRegisterMovement(memberships, kind, cc)) : []),
    [memberships, kind, costCenters],
  );

  const warehouseOptions = useMemo(
    () => warehouses.filter((w) => allowedCostCenters.some((cc) => cc.company_id === w.company_id)),
    [warehouses, allowedCostCenters],
  );
  const warehouse = warehouseOptions.find((w) => w.id === warehouseId) ?? null;

  const costCenterOptions = useMemo(
    () => (warehouse ? allowedCostCenters.filter((cc) => cc.company_id === warehouse.company_id) : []),
    [warehouse, allowedCostCenters],
  );

  // A site warehouse pre-selects that site's cost center.
  useEffect(() => {
    if (costCenterId && costCenterOptions.some((cc) => cc.id === costCenterId)) return;
    const siteCc = sites.find((s) => s.id === warehouse?.site_id)?.cost_center_id;
    const suggested =
      costCenterOptions.find((cc) => cc.id === siteCc) ?? (costCenterOptions.length === 1 ? costCenterOptions[0] : null);
    setCostCenterId(suggested?.id ?? null);
  }, [warehouse, costCenterOptions, sites, costCenterId]);

  useEffect(() => {
    if (warehouseId && !warehouse && warehouseOptions.length) setWarehouseId(null);
    if (!warehouseId && warehouseOptions.length === 1) setWarehouseId(warehouseOptions[0]?.id ?? null);
  }, [warehouseId, warehouse, warehouseOptions]);

  const material = materials.find((m) => m.id === materialId) ?? null;
  const filteredMaterials = useMemo(() => {
    const q = materialQuery.trim().toLowerCase();
    const list = q
      ? materials.filter((m) => m.name.toLowerCase().includes(q) || m.sku?.toLowerCase().includes(q))
      : materials;
    return list.slice(0, 8);
  }, [materials, materialQuery]);

  const currentBalance =
    warehouse && material
      ? balances.find((b) => b.warehouse_id === warehouse.id && b.material_id === material.id)?.quantity ?? 0
      : null;

  const parsedQuantity = parseDecimal(quantityText);

  async function choosePhoto(source: 'camera' | 'library') {
    setFormError(null);
    try {
      const picked = await pickPhoto(source);
      if (picked) setPhoto(picked);
    } catch (e) {
      setFormError((e as Error).message);
    }
  }

  async function save() {
    setFormError(null);
    const quantity = parsedQuantity;
    const unitCost = unitCostText.trim() ? parseDecimal(unitCostText, 4) : null;

    if (!kind || !warehouse || !costCenterId || !material) {
      return setFormError('Escolha o tipo, o depósito, o centro de custo e o material.');
    }
    if (!quantity) return setFormError('Informe uma quantidade maior que zero (até 3 casas decimais).');
    if (unitCostText.trim() && unitCost === null) return setFormError('Custo unitário inválido.');
    const signed = kind === 'adjustment' && adjustDown ? -quantity : quantity;
    const reducesStock = kind === 'out' || signed < 0;
    if (reducesStock && currentBalance !== null && quantity > currentBalance) {
      return setFormError(`Saldo insuficiente: disponível ${formatQty(currentBalance)} ${material.unit}.`);
    }

    setSaving(true);
    let photoPath: string | null = null;
    try {
      if (photo) photoPath = await uploadMovementPhoto(warehouse.company_id, photo);

      const { error } = await supabase.from('stock_movements').insert({
        kind,
        company_id: warehouse.company_id,
        warehouse_id: warehouse.id,
        cost_center_id: costCenterId,
        material_id: material.id,
        quantity: signed,
        unit_cost: kind === 'in' ? unitCost : null,
        invoice_number: kind === 'in' && invoiceNumber.trim() ? invoiceNumber.trim() : null,
        photo_path: photoPath,
        notes: notes.trim() || null,
      });
      if (error) throw new Error(friendlyError(error.code, error.message));

      router.back();
    } catch (e) {
      // Movement rejected: don't leave an orphan photo in the bucket.
      if (photoPath) await supabase.storage.from(PHOTO_BUCKET).remove([photoPath]);
      setFormError((e as Error).message);
      setSaving(false);
    }
  }

  const fatal = accessError ?? loadError;
  if (fatal) return <Text style={styles.center}>{fatal}</Text>;
  if (!memberships || !loaded) return <ActivityIndicator style={styles.center} />;
  if (!allowedKinds.length && !canTransfer(memberships)) {
    return <Text style={styles.center}>Seu perfil não tem permissão para lançar movimentações.</Text>;
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <Field label="Tipo" hint={kind ? KIND_HINTS[kind] : undefined}>
          <Chips
            options={[
              ...allowedKinds.map((k) => ({ id: k, label: MOVEMENT_LABELS[k] })),
              ...(canTransfer(memberships) ? [{ id: TRANSFER, label: 'Transferência' }] : []),
            ]}
            value={kind}
            onChange={(k) =>
              k === TRANSFER
                ? router.replace({
                    pathname: '/transfer',
                    params: { ...(warehouseId && { warehouseId }), ...(materialId && { materialId }) },
                  })
                : setKind(k as ManualMovementKind)
            }
          />
        </Field>

        <Field label="Depósito">
          <Chips
            options={warehouseOptions.map((w) => ({ id: w.id, label: w.name }))}
            value={warehouseId}
            onChange={setWarehouseId}
          />
        </Field>

        {warehouse && (
          <Field label="Centro de custo" hint="A quem a entrada ou o consumo é apropriado">
            <Chips
              options={costCenterOptions.map((cc) => ({ id: cc.id, label: `${cc.code} · ${cc.name}` }))}
              value={costCenterId}
              onChange={setCostCenterId}
            />
          </Field>
        )}

        <Field label="Material">
          {material ? (
            <Pressable style={styles.selected} onPress={() => setMaterialId(null)}>
              <Text style={styles.selectedText}>{material.name}</Text>
              <Text style={styles.link}>Trocar</Text>
            </Pressable>
          ) : (
            <>
              <TextInput
                style={styles.input}
                placeholder="Buscar por nome ou código"
                value={materialQuery}
                onChangeText={setMaterialQuery}
              />
              <Chips
                options={filteredMaterials.map((m) => ({ id: m.id, label: `${m.name} (${m.unit})` }))}
                value={null}
                onChange={setMaterialId}
              />
            </>
          )}
          {currentBalance !== null && material && (
            <View style={[styles.row, { justifyContent: 'space-between' }]}>
              <Text style={styles.hint}>
                Saldo neste depósito: {formatQty(currentBalance)} {material.unit}
              </Text>
              <Pressable
                hitSlop={8}
                onPress={() =>
                  router.push({ pathname: '/history', params: { warehouseId: warehouse!.id, materialId: material.id } })
                }
              >
                <Text style={styles.link}>Ver histórico</Text>
              </Pressable>
            </View>
          )}
        </Field>

        <Field label={`Quantidade${material ? ` (${material.unit})` : ''}`}>
          {kind === 'adjustment' && (
            <Chips
              options={[
                { id: 'up', label: 'Aumentar saldo' },
                { id: 'down', label: 'Reduzir saldo' },
              ]}
              value={adjustDown ? 'down' : 'up'}
              onChange={(v) => setAdjustDown(v === 'down')}
            />
          )}
          <TextInput
            style={styles.input}
            placeholder="0"
            keyboardType="decimal-pad"
            value={quantityText}
            onChangeText={setQuantityText}
          />
          {quantityText.trim() !== '' && (
            <Text style={[styles.hint, parsedQuantity === null && styles.error]}>
              {parsedQuantity === null
                ? 'Quantidade inválida (até 3 casas decimais)'
                : `= ${formatQty(parsedQuantity)} ${material?.unit ?? ''}`}
            </Text>
          )}
        </Field>

        {kind === 'in' && (
          <View style={styles.row}>
            <View style={styles.flex}>
              <Field label="Nº da nota">
                <TextInput style={styles.input} value={invoiceNumber} onChangeText={setInvoiceNumber} />
              </Field>
            </View>
            <View style={styles.flex}>
              <Field label="Custo unitário (R$)">
                <TextInput
                  style={styles.input}
                  placeholder="0,00"
                  keyboardType="decimal-pad"
                  value={unitCostText}
                  onChangeText={setUnitCostText}
                />
              </Field>
            </View>
          </View>
        )}

        <Field label={kind === 'in' ? 'Foto da nota' : 'Foto do material'} hint="Opcional">
          {photo ? (
            <View style={styles.photoBox}>
              <Image source={{ uri: photo.uri }} style={styles.photo} resizeMode="cover" />
              <Pressable onPress={() => setPhoto(null)} hitSlop={8}>
                <Text style={styles.link}>Remover foto</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.row}>
              <Pressable style={styles.secondary} onPress={() => choosePhoto('camera')}>
                <Text style={styles.secondaryText}>Tirar foto</Text>
              </Pressable>
              <Pressable style={styles.secondary} onPress={() => choosePhoto('library')}>
                <Text style={styles.secondaryText}>Galeria</Text>
              </Pressable>
            </View>
          )}
        </Field>

        <Field label="Observações" hint="Opcional">
          <TextInput
            style={[styles.input, styles.multiline]}
            multiline
            value={notes}
            onChangeText={setNotes}
            placeholder={kind === 'out' ? 'Ex.: laje do 3º pavimento' : undefined}
          />
        </Field>

        {formError && <Text style={styles.error}>{formError}</Text>}

        <Pressable style={[styles.button, saving && styles.disabled]} onPress={save} disabled={saving}>
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Registrar {kind ? MOVEMENT_LABELS[kind].toLowerCase() : ''}</Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function friendlyError(code: string | undefined, message: string): string {
  if (code === '42501') return 'Seu perfil não pode fazer esse lançamento neste centro de custo.';
  if (code === '23503') return 'Depósito e centro de custo precisam ser da mesma empresa.';
  return message;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { marginTop: 48, textAlign: 'center', color: '#555', paddingHorizontal: 24 },
  form: { padding: 16, gap: 18, maxWidth: 640, width: '100%', alignSelf: 'center' },
  hint: { fontSize: 13, color: '#666' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, fontSize: 16, backgroundColor: '#fff' },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: 12 },
  selected: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: ACCENT, borderRadius: 8, padding: 12, backgroundColor: '#fff4ee' },
  selectedText: { fontSize: 16, fontWeight: '600', flex: 1 },
  link: { color: ACCENT, fontWeight: '600' },
  secondary: { flex: 1, borderWidth: 1, borderColor: ACCENT, borderRadius: 8, padding: 12, alignItems: 'center' },
  secondaryText: { color: ACCENT, fontWeight: '600' },
  photoBox: { gap: 8, alignItems: 'flex-start' },
  photo: { width: 160, height: 160, borderRadius: 8, backgroundColor: '#eee' },
  error: { color: '#b3261e' },
  button: { backgroundColor: ACCENT, borderRadius: 8, padding: 14, alignItems: 'center' },
  disabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
