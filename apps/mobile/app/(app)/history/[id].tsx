import { MOVEMENT_LABELS, signedQuantity } from '@buildops/shared';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View } from 'react-native';

import { formStyles as s } from '@/components/form';
import { rows } from '@/lib/data';
import { formatDateTime, formatQty, MOVEMENT_SELECT, movementTitle, type MovementRow } from '@/lib/movements';
import { PHOTO_BUCKET } from '@/lib/photos';
import { supabase } from '@/lib/supabase';

const formatMoney = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 4 });

function Info({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <View style={styles.info}>
      <Text style={s.hint}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

export default function MovementDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [m, setM] = useState<MovementRow | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [row] = rows<MovementRow[]>(await supabase.from('stock_movements').select(MOVEMENT_SELECT).eq('id', id));
        if (!row) throw new Error('Movimentação não encontrada ou fora do seu acesso.');
        setM(row);
        if (row.photo_path) {
          // Private bucket: a short-lived signed URL is enough to display it.
          const { data, error: e } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(row.photo_path, 600);
          if (e) setPhotoError(e.message);
          else setPhotoUrl(data.signedUrl);
        }
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [id]);

  if (error) return <Text style={s.center}>{error}</Text>;
  if (!m) return <ActivityIndicator style={s.center} />;

  const signed = signedQuantity(m.kind, Number(m.quantity));
  const unit = m.material?.unit ?? '';

  return (
    <ScrollView contentContainerStyle={s.form}>
      <View style={styles.header}>
        <Text style={s.hint}>{movementTitle(m, MOVEMENT_LABELS)}</Text>
        <Text style={styles.material}>{m.material?.name}</Text>
        <Text style={[styles.qty, signed < 0 ? styles.neg : styles.pos]}>
          {signed > 0 ? '+' : '−'}
          {formatQty(Math.abs(signed))} {unit}
        </Text>
      </View>

      <Info label="Data" value={formatDateTime(m.occurred_at)} />
      <Info label="Depósito" value={m.warehouse?.name ?? 'outra empresa'} />
      <Info label="Centro de custo" value={m.cost_center ? `${m.cost_center.code} · ${m.cost_center.name}` : null} />
      <Info
        label="Registrado por"
        value={m.author?.full_name ?? (m.source === 'import' ? `Importado de ${m.external_system}` : null)}
      />
      {m.source === 'import' && <Info label="Referência no sistema de origem" value={m.external_ref} />}
      <Info label="Autorizado por" value={m.transfer?.authorizer?.full_name} />
      <Info label="Nota fiscal" value={m.invoice_number} />
      <Info label="Custo unitário" value={m.unit_cost !== null ? formatMoney(Number(m.unit_cost)) : null} />
      <Info
        label="Custo total"
        value={m.unit_cost !== null ? formatMoney(Number(m.unit_cost) * Number(m.quantity)) : null}
      />
      <Info label="Observações" value={m.notes} />

      {m.photo_path && (
        <View style={styles.info}>
          <Text style={s.hint}>Foto</Text>
          {photoUrl ? (
            <Image
              source={{ uri: photoUrl }}
              style={styles.photo}
              resizeMode="contain"
              accessibilityLabel="Foto da movimentação"
              onError={() => {
                setPhotoUrl(null);
                setPhotoError('o arquivo salvo não é uma imagem válida.');
              }}
            />
          ) : photoError ? (
            <Text style={s.error}>Não foi possível carregar a foto: {photoError}</Text>
          ) : (
            <ActivityIndicator />
          )}
        </View>
      )}

      <Text style={[s.hint, styles.immutable]}>
        Movimentações não são editadas. Para corrigir, um gestor lança um ajuste de inventário.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  header: { gap: 4, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#ddd' },
  material: { fontSize: 20, fontWeight: '700' },
  qty: { fontSize: 24, fontWeight: '700' },
  pos: { color: '#1b6e3a' },
  neg: { color: '#b3261e' },
  info: { gap: 2 },
  value: { fontSize: 16, color: '#222' },
  photo: { width: '100%', aspectRatio: 3 / 4, borderRadius: 8, backgroundColor: '#eee' },
  immutable: { marginTop: 8, fontStyle: 'italic' },
});
