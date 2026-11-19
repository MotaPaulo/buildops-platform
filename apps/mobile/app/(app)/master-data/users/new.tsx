import { canEditMasterData, validateAccess, validateNewUser, type AccessInput } from '@buildops/shared';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput } from 'react-native';

import { AccessPicker, EMPTY_ACCESS } from '@/components/access-picker';
import { Field, formStyles as s, PrimaryButton } from '@/components/form';
import { useMemberships } from '@/lib/access';
import { adminUsers, loadOrg, type Org } from '@/lib/users';

export default function NewUserScreen() {
  const { memberships } = useMemberships();
  const [org, setOrg] = useState<Org | null>(null);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [access, setAccess] = useState<AccessInput>(EMPTY_ACCESS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadOrg()
      .then(setOrg)
      .catch((e: Error) => setError(e.message));
  }, []);

  async function save() {
    if (!org) return;
    const invalid =
      validateNewUser({ email, full_name: fullName, password }) ?? validateAccess(access, org.costCenters);
    setError(invalid);
    if (invalid) return;

    setSaving(true);
    const res = await adminUsers({
      action: 'create',
      email: email.trim(),
      full_name: fullName.trim(),
      password,
      ...access,
    });
    setSaving(false);
    if (res.error) return setError(res.error);
    router.back();
  }

  if (memberships && !canEditMasterData(memberships, 'users')) {
    return <Text style={s.center}>Somente a diretoria gerencia usuários.</Text>;
  }
  if (!org) return error ? <Text style={s.center}>{error}</Text> : <ActivityIndicator style={s.center} />;

  return (
    <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
        <Field label="Nome">
          <TextInput style={s.input} value={fullName} onChangeText={setFullName} placeholder="Ex.: Maria Souza" />
        </Field>

        <Field label="E-mail" hint="Usado para entrar no app.">
          <TextInput
            style={s.input}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="off"
            keyboardType="email-address"
            placeholder="nome@empresa.com.br"
          />
        </Field>

        <Field
          label="Senha inicial"
          hint="Mínimo de 8 caracteres. Passe a senha ao usuário: ele terá de trocá-la no primeiro acesso."
        >
          <TextInput style={s.input} value={password} onChangeText={setPassword} autoCapitalize="none" autoComplete="off" />
        </Field>

        <Text style={s.section}>Acesso inicial</Text>
        <AccessPicker value={access} onChange={setAccess} org={org} />

        {error && <Text style={s.error}>{error}</Text>}
        <PrimaryButton label="Cadastrar usuário" onPress={save} busy={saving} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
