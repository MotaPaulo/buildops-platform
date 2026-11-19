import { canEditMasterData, hasRoleInCompany, MASTER_DATA_ROLES, type Company, type CostCenter } from '@buildops/shared';
import { router } from 'expo-router';
import { FlatList, Pressable, Text, View } from 'react-native';

import { Fab, formStyles as s, ReloadError } from '@/components/form';
import { useMemberships } from '@/lib/access';
import { rows, useFocusData } from '@/lib/data';
import { supabase } from '@/lib/supabase';

export default function CostCentersScreen() {
  const { memberships } = useMemberships();
  const { data, error } = useFocusData(async () => {
    const [costCenters, companies, sites] = await Promise.all([
      supabase.from('cost_centers').select('id, company_id, code, name, active').order('code'),
      supabase.from('companies').select('id, name'),
      supabase.from('sites').select('cost_center_id, name'),
    ]);
    const siteNames = new Map<string, string[]>();
    for (const x of rows<{ cost_center_id: string; name: string }[]>(sites)) {
      siteNames.set(x.cost_center_id, [...(siteNames.get(x.cost_center_id) ?? []), x.name]);
    }
    return {
      costCenters: rows<Required<CostCenter>[]>(costCenters),
      companyName: new Map(rows<Company[]>(companies).map((c) => [c.id, c.name])),
      siteNames,
    };
  });

  const canEdit = (cc: CostCenter) =>
    !!memberships && hasRoleInCompany(memberships, cc.company_id, MASTER_DATA_ROLES.costCenters);
  const multiCompany = (data?.companyName.size ?? 0) > 1;

  return (
    <View style={s.flex}>
      <FlatList
        data={data?.costCenters ?? []}
        keyExtractor={(cc) => cc.id}
        contentContainerStyle={s.list}
        ListHeaderComponent={<ReloadError error={error} hasData={!!data} />}
        ListEmptyComponent={
          <Text style={s.empty}>{error ?? (data ? 'Nenhum centro de custo cadastrado.' : 'Carregando…')}</Text>
        }
        renderItem={({ item }) => {
          const sites = data?.siteNames.get(item.id);
          return (
            <Pressable
              style={[s.item, !item.active && s.itemInactive]}
              disabled={!canEdit(item)}
              onPress={() => router.push(`/master-data/cost-centers/${item.id}`)}
            >
              <Text style={s.itemTitle}>
                {item.code} · {item.name}
              </Text>
              <Text style={s.itemSub}>
                {[multiCompany ? data?.companyName.get(item.company_id) : null, sites ? `Obra: ${sites.join(', ')}` : 'Sem obra']
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
              {!item.active && <Text style={s.badge}>Inativo</Text>}
            </Pressable>
          );
        }}
      />
      {memberships && canEditMasterData(memberships, 'costCenters') && (
        <Fab label="+ Novo centro de custo" onPress={() => router.push('/master-data/cost-centers/new')} />
      )}
    </View>
  );
}
