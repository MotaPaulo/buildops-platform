import {
  canEditMasterData,
  hasRoleInCompany,
  MASTER_DATA_ROLES,
  SITE_STATUS_LABELS,
  type Company,
  type CostCenter,
  type Site,
} from '@buildops/shared';
import { router } from 'expo-router';
import { FlatList, Pressable, Text, View } from 'react-native';

import { Fab, formStyles as s } from '@/components/form';
import { useMemberships } from '@/lib/access';
import { rows, useFocusData } from '@/lib/data';
import { supabase } from '@/lib/supabase';

export default function SitesScreen() {
  const { memberships } = useMemberships();
  const { data, error } = useFocusData(async () => {
    const [sites, companies, costCenters] = await Promise.all([
      supabase.from('sites').select('id, company_id, cost_center_id, name, address, status').order('name'),
      supabase.from('companies').select('id, name'),
      supabase.from('cost_centers').select('id, company_id, code, name'),
    ]);
    return {
      sites: rows<Site[]>(sites),
      companyName: new Map(rows<Company[]>(companies).map((c) => [c.id, c.name])),
      ccCode: new Map(rows<CostCenter[]>(costCenters).map((cc) => [cc.id, cc.code])),
    };
  });

  const canEdit = (x: Site) => !!memberships && hasRoleInCompany(memberships, x.company_id, MASTER_DATA_ROLES.sites);
  const multiCompany = (data?.companyName.size ?? 0) > 1;

  return (
    <View style={s.flex}>
      <FlatList
        data={data?.sites ?? []}
        keyExtractor={(x) => x.id}
        contentContainerStyle={s.list}
        ListEmptyComponent={<Text style={s.empty}>{error ?? (data ? 'Nenhuma obra cadastrada.' : 'Carregando…')}</Text>}
        renderItem={({ item }) => (
          <Pressable
            style={[s.item, item.status === 'finished' && s.itemInactive]}
            disabled={!canEdit(item)}
            onPress={() => router.push(`/master-data/sites/${item.id}`)}
          >
            <Text style={s.itemTitle}>{item.name}</Text>
            <Text style={s.itemSub}>
              {[
                multiCompany ? data?.companyName.get(item.company_id) : null,
                data?.ccCode.get(item.cost_center_id),
                SITE_STATUS_LABELS[item.status],
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </Pressable>
        )}
      />
      {memberships && canEditMasterData(memberships, 'sites') && (
        <Fab label="+ Nova obra" onPress={() => router.push('/master-data/sites/new')} />
      )}
    </View>
  );
}
