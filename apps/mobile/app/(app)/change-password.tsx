import { validatePassword } from '@buildops/shared';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput } from 'react-native';

import { Field, formStyles as s, PrimaryButton } from '@/components/form';
import { supabase } from '@/lib/supabase';

/** Shown instead of the app while user_metadata.must_change_password is set (first login). */
export default function ChangePasswordScreen() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const invalid = validatePassword(password) ?? (password !== confirm ? 'As senhas não conferem.' : null);
    setError(invalid);
    if (invalid) return;

    setSaving(true);
    // The auth listener receives the updated user, and the layout lets them into the app.
    const { error } = await supabase.auth.updateUser({ password, data: { must_change_password: false } });
    setSaving(false);
    if (error) {
      setError(error.code === 'same_password' ? 'A nova senha precisa ser diferente da senha inicial.' : error.message);
    }
  }

  return (
    <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
        <Text style={s.hint}>
          Este é o seu primeiro acesso. Troque a senha inicial recebida da diretoria por uma senha só sua.
        </Text>
        <Field label="Nova senha" hint="Mínimo de 8 caracteres.">
          <TextInput
            style={s.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="new-password"
          />
        </Field>
        <Field label="Confirme a nova senha">
          <TextInput
            style={s.input}
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
            autoComplete="new-password"
            onSubmitEditing={save}
          />
        </Field>
        {error && <Text style={s.error}>{error}</Text>}
        <PrimaryButton label="Trocar senha" onPress={save} busy={saving} />
        <Pressable onPress={() => supabase.auth.signOut()} hitSlop={8} style={{ alignSelf: 'center' }}>
          <Text style={s.link}>Sair</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
