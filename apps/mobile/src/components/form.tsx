// Shared form building blocks. On-screen text is pt-BR.
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

export const ACCENT = '#b8430f';

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <View style={formStyles.field}>
      <Text style={formStyles.label}>{label}</Text>
      {children}
      {hint && <Text style={formStyles.hint}>{hint}</Text>}
    </View>
  );
}

export type ChipOption = { id: string; label: string };

/** Single-choice selector shown as a row of pills. */
export function Chips({
  options,
  value,
  onChange,
  emptyText = 'Nenhuma opção disponível para o seu perfil.',
}: {
  options: ChipOption[];
  value: string | null;
  onChange: (id: string) => void;
  emptyText?: string;
}) {
  if (!options.length) return <Text style={formStyles.hint}>{emptyText}</Text>;
  return (
    <View style={formStyles.chips}>
      {options.map((o) => {
        const active = o.id === value;
        return (
          <Pressable
            key={o.id}
            style={[formStyles.chip, active && formStyles.chipActive]}
            onPress={() => onChange(o.id)}
          >
            <Text style={[formStyles.chipText, active && formStyles.chipTextActive]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function PrimaryButton({ label, onPress, busy }: { label: string; onPress: () => void; busy?: boolean }) {
  return (
    <Pressable style={[formStyles.button, busy && formStyles.disabled]} onPress={onPress} disabled={busy}>
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={formStyles.buttonText}>{label}</Text>}
    </Pressable>
  );
}

/** Floating action button at the bottom right of a list screen. */
export function Fab({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={formStyles.fab} onPress={onPress}>
      <Text style={formStyles.fabText}>{label}</Text>
    </Pressable>
  );
}

export const formStyles = StyleSheet.create({
  flex: { flex: 1 },
  center: { marginTop: 48, textAlign: 'center', color: '#555', paddingHorizontal: 24 },
  form: { padding: 16, gap: 18, maxWidth: 640, width: '100%', alignSelf: 'center' },
  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: '600', color: '#333' },
  hint: { fontSize: 13, color: '#666' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, fontSize: 16, backgroundColor: '#fff' },
  readonly: { fontSize: 16, paddingVertical: 4, color: '#333' },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: '#ccc', borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14, backgroundColor: '#fff' },
  chipActive: { borderColor: ACCENT, backgroundColor: ACCENT },
  chipText: { color: '#333' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  link: { color: ACCENT, fontWeight: '600' },
  error: { color: '#b3261e' },
  button: { backgroundColor: ACCENT, borderRadius: 8, padding: 14, alignItems: 'center' },
  disabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  fab: { position: 'absolute', right: 16, bottom: 24, backgroundColor: ACCENT, borderRadius: 28, paddingVertical: 14, paddingHorizontal: 20, elevation: 4, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  fabText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  list: { padding: 16, paddingBottom: 96, gap: 8, maxWidth: 640, width: '100%', alignSelf: 'center' },
  item: { padding: 14, borderRadius: 8, borderWidth: 1, borderColor: '#ddd', backgroundColor: '#fff', gap: 2 },
  itemInactive: { opacity: 0.55 },
  itemTitle: { fontSize: 16, fontWeight: '600' },
  itemSub: { color: '#555' },
  badge: { color: '#b3261e', fontWeight: '600', fontSize: 13 },
  empty: { textAlign: 'center', color: '#666', marginTop: 32 },
});

/** Turns Postgres/PostgREST error codes into messages for the user. */
export function friendlyDbError(code: string | undefined, message: string, duplicate = 'Esse registro já existe.'): string {
  if (code === '42501') return 'Seu perfil não tem permissão para essa operação.';
  if (code === '23505') return duplicate;
  if (code === '23503') return 'Os itens escolhidos precisam ser da mesma empresa.';
  return message;
}
