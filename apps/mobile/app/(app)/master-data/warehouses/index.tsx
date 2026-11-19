import {
  canEditMasterData,
  hasRoleInCompany,
  MASTER_DATA_ROLES,
  type Company,
  type Site,
  type Warehouse,
} from '@buildops/shared';
import { router } from 'expo-router';
import { FlatList, Pressable, Text, View } from 'react-native';

import { Fab, formStyles as s } from '@/components/form';
import { useMemberships } from '@/lib/access';
import { rows, useFocusData } from '@/lib/data';
import { supabase } from '@/lib/supabase';

export default function WarehousesScreen() {
  const { memberships } = useMemberships();
  const { data, error } = useFocusData(async () => {
    const [warehouses, companies, sites] = await Promise.all([
      supabase.from('warehouses').select('id, company_id, site_id, name, active').order('name'),
      supabase.from('companies').select('id, name'),
      supabase.from('sites').select('id, name'),
    ]);
    return {
      warehouses: rows<Warehouse[]>(warehouses),
      companyName: new Map(rows<Company[]>(companies).map((c) => [c.id, c.name])),
      siteName: new Map(rows<Pick<Site, 'id' | 'name'>[]>(sites).map((x) => [x.id, x.name])),
    };
  });

  const canEdit = (w: Warehouse) =>
    !!memberships && hasRoleInCompany(memberships, w.company_id, MASTER_DATA_ROLES.warehouses);
  const multiCompany = (data?.companyName.size ?? 0) > 1;

  return (
    <View style={s.flex}>
      <FlatList
        data={data?.warehouses ?? []}
        keyExtractor={(w) => w.id}
        contentContainerStyle={s.list}
        ListEmptyComponent={
          <Text style={s.empty}>{error ?? (data ? 'Nenhum depósito cadastrado.' : 'Carregando…')}</Text>
        }
        renderItem={({ item }) => (
          <Pressable
            style={[s.item, !item.active && s.itemInactive]}
            disabled={!canEdit(item)}
            onPress={() => router.push(`/master-data/warehouses/${item.id}`)}
          >
            <Text style={s.itemTitle}>{item.name}</Text>
            <Text style={s.itemSub}>
              {[
                multiCompany ? data?.companyName.get(item.company_id) : null,
                item.site_id ? `Obra: ${data?.siteName.get(item.site_id) ?? '—'}` : 'Sem obra',
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            {!item.active && <Text style={s.badge}>Inativo</Text>}
          </Pressable>
        )}
      />
      {memberships && canEditMasterData(memberships, 'warehouses') && (
        <Fab label="+ Novo depósito" onPress={() => router.push('/master-data/warehouses/new')} />
      )}
    </View>
  );
}
