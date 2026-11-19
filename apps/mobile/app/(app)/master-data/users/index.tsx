import { canEditMasterData, matchesUserSearch, type UserRow } from '@buildops/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';

import { Fab, formStyles as s, ReloadError } from '@/components/form';
import { useMemberships } from '@/lib/access';
import { rows, useFocusData } from '@/lib/data';
import { supabase } from '@/lib/supabase';
import { describeAccess, loadOrg } from '@/lib/users';

export default function UsersScreen() {
  const { memberships } = useMemberships();
  const isDirector = !!memberships && canEditMasterData(memberships, 'users');
  const [query, setQuery] = useState('');

  const { data, error } = useFocusData(async () => {
    const [users, org] = await Promise.all([supabase.rpc('list_users'), loadOrg()]);
    return { users: rows<UserRow[]>(users), org };
  });

  if (memberships && !isDirector) return <Text style={s.center}>Somente a diretoria gerencia usuários.</Text>;

  const users = (data?.users ?? []).filter((u) => matchesUserSearch(u, query));

  return (
    <View style={s.flex}>
      <FlatList
        data={users}
        keyExtractor={(u) => u.id}
        contentContainerStyle={s.list}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ gap: 8, marginBottom: 4 }}>
            <ReloadError error={error} hasData={!!data} />
            <TextInput
              style={s.input}
              value={query}
              onChangeText={setQuery}
              placeholder="Buscar por nome ou e-mail"
              autoCapitalize="none"
            />
          </View>
        }
        ListEmptyComponent={
          <Text style={s.empty}>
            {error ?? (data ? (query ? 'Nenhum usuário encontrado.' : 'Nenhum usuário cadastrado.') : 'Carregando…')}
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable
            style={[s.item, item.banned && s.itemInactive]}
            onPress={() => router.push(`/master-data/users/${item.id}`)}
          >
            <Text style={s.itemTitle}>{item.full_name}</Text>
            <Text style={s.itemSub}>{item.email}</Text>
            <Text style={s.itemSub}>
              {item.memberships.length
                ? item.memberships.map((m) => describeAccess(m, data?.org ?? null)).join('\n')
                : 'Sem acesso'}
            </Text>
            {item.banned && <Text style={s.badge}>Bloqueado</Text>}
          </Pressable>
        )}
      />
      {isDirector && <Fab label="+ Novo usuário" onPress={() => router.push('/master-data/users/new')} />}
    </View>
  );
}
