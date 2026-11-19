import { canEditMasterData, validateAccess, type AccessInput, type UserRow } from '@buildops/shared';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { AccessPicker, EMPTY_ACCESS } from '@/components/access-picker';
import { formStyles as s, friendlyDbError, PrimaryButton } from '@/components/form';
import { useMemberships } from '@/lib/access';
import { useAuth } from '@/lib/auth';
import { rows } from '@/lib/data';
import { supabase } from '@/lib/supabase';
import { adminUsers, confirmAction, describeAccess, loadOrg, type Org } from '@/lib/users';

const LAST_DIRECTOR = 'É preciso manter ao menos um diretor.';

export default function UserDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const { memberships } = useMemberships();
  const isSelf = session?.user.id === id;

  const [user, setUser] = useState<UserRow | null>(null);
  const [org, setOrg] = useState<Org | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [access, setAccess] = useState<AccessInput>(EMPTY_ACCESS);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [users, o] = await Promise.all([supabase.rpc('list_users'), loadOrg()]);
      const found = rows<UserRow[]>(users).find((u) => u.id === id);
      if (!found) throw new Error('Usuário não encontrado.');
      setUser(found);
      setOrg(o);
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function addAccess() {
    if (!org) return;
    const invalid = validateAccess(access, org.costCenters);
    setError(invalid);
    if (invalid) return;
    setBusy('add');
    const res = await supabase.from('memberships').insert({ user_id: id, ...access }).select('id');
    setBusy(null);
    if (res.error) return setError(friendlyDbError(res.error.code, res.error.message, 'Esse acesso já existe.'));
    setAccess(EMPTY_ACCESS);
    await load();
  }

  async function removeAccess(membershipId: string, label: string) {
    const ok = await confirmAction(
      'Remover acesso',
      `${label}\n\nO usuário perde este acesso na próxima vez que abrir o app.`,
      'Remover',
    );
    if (!ok) return;
    setError(null);
    setBusy(membershipId);
    const res = await supabase.from('memberships').delete().eq('id', membershipId).select('id');
    setBusy(null);
    if (res.error) {
      return setError(res.error.message.includes(LAST_DIRECTOR) ? LAST_DIRECTOR : friendlyDbError(res.error.code, res.error.message));
    }
    if (!res.data?.length) return setError('Seu perfil não tem permissão para remover este acesso.');
    await load();
  }

  async function toggleBlock() {
    if (!user) return;
    const block = !user.banned;
    const ok = await confirmAction(
      block ? 'Bloquear acesso' : 'Desbloquear acesso',
      block
        ? `${user.full_name} não conseguirá mais entrar no app. O histórico dele é mantido.`
        : `${user.full_name} poderá entrar de novo com a senha atual.`,
      block ? 'Bloquear' : 'Desbloquear',
    );
    if (!ok) return;
    setError(null);
    setBusy('block');
    const res = await adminUsers({ action: block ? 'block' : 'unblock', user_id: user.id });
    setBusy(null);
    if (res.error) return setError(res.error);
    await load();
  }

  if (memberships && !canEditMasterData(memberships, 'users')) {
    return <Text style={s.center}>Somente a diretoria gerencia usuários.</Text>;
  }
  if (!user || !org) {
    return loadError ? <Text style={s.center}>{loadError}</Text> : <ActivityIndicator style={s.center} />;
  }

  return (
    <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: user.full_name }} />

      <View style={{ gap: 2 }}>
        <Text style={s.itemTitle}>{user.full_name}</Text>
        <Text style={s.itemSub}>{user.email}</Text>
        <Text style={s.hint}>
          {user.last_sign_in_at
            ? `Último acesso: ${new Date(user.last_sign_in_at).toLocaleString('pt-BR')}`
            : 'Ainda não entrou no app.'}
        </Text>
        {user.banned && <Text style={s.badge}>Bloqueado</Text>}
      </View>

      {loadError && <Text style={s.error}>Não foi possível atualizar: {loadError}</Text>}

      <Text style={s.section}>Acessos</Text>
      {user.memberships.length ? (
        user.memberships.map((m) => {
          const label = describeAccess(m, org);
          return (
            <View key={m.id} style={[s.item, s.row, { alignItems: 'center' }]}>
              <Text style={[s.itemSub, s.flex]}>{label}</Text>
              {busy === m.id ? (
                <ActivityIndicator />
              ) : (
                <Pressable onPress={() => removeAccess(m.id, label)} hitSlop={8} disabled={!!busy}>
                  <Text style={s.link}>Remover</Text>
                </Pressable>
              )}
            </View>
          );
        })
      ) : (
        <Text style={s.hint}>Sem acesso: o usuário entra, mas não vê nenhuma empresa.</Text>
      )}

      <Text style={s.section}>Adicionar acesso</Text>
      <AccessPicker value={access} onChange={setAccess} org={org} />
      <PrimaryButton label="Adicionar acesso" onPress={addAccess} busy={busy === 'add'} />

      {error && <Text style={s.error}>{error}</Text>}

      <Text style={s.section}>Login</Text>
      {isSelf ? (
        <Text style={s.hint}>Você não pode bloquear o seu próprio acesso.</Text>
      ) : (
        <PrimaryButton
          label={user.banned ? 'Desbloquear acesso' : 'Bloquear acesso'}
          onPress={toggleBlock}
          busy={busy === 'block'}
        />
      )}
    </ScrollView>
  );
}
