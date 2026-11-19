import { hasRoleInCompany, MASTER_DATA_ROLES, type Company, type StockBalance, type Warehouse } from '@buildops/shared';
import { router } from 'expo-router';
import { FlatList, Pressable, Text } from 'react-native';

import { formStyles as s, ReloadError } from '@/components/form';
import { useMemberships } from '@/lib/access';
import { rows, useFocusData } from '@/lib/data';
import { supabase } from '@/lib/supabase';

export default function MinimumsWarehousesScreen() {
  const { memberships } = useMemberships();
  const { data, error } = useFocusData(async () => {
    const [warehouses, companies, balances] = await Promise.all([
      supabase.from('warehouses').select('id, company_id, site_id, name, active').eq('active', true).order('name'),
      supabase.from('companies').select('id, name'),
      supabase.rpc('get_stock_balances'),
    ]);
    return {
      warehouses: rows<Warehouse[]>(warehouses),
      companyName: new Map(rows<Company[]>(companies).map((c) => [c.id, c.name])),
      balances: rows<StockBalance[]>(balances),
    };
  });

  const canEdit = (w: Warehouse) =>
    !!memberships && hasRoleInCompany(memberships, w.company_id, MASTER_DATA_ROLES.minimums);
  const multiCompany = (data?.companyName.size ?? 0) > 1;

  return (
    <FlatList
      data={data?.warehouses ?? []}
      keyExtractor={(w) => w.id}
      contentContainerStyle={s.list}
      ListHeaderComponent={
        <>
        <ReloadError error={error} hasData={!!data} />
        <Text style={[s.hint, { marginBottom: 8 }]}>
          Escolha o depósito. O saldo aparece em destaque quando fica abaixo do mínimo.
        </Text>
        </>
      }
      ListEmptyComponent={<Text style={s.empty}>{error ?? (data ? 'Nenhum depósito ativo.' : 'Carregando…')}</Text>}
      renderItem={({ item }) => {
        const mins = data?.balances.filter((b) => b.warehouse_id === item.id && b.min_quantity !== null) ?? [];
        const below = mins.filter((b) => b.below_minimum).length;
        return (
          <Pressable
            style={[s.item, !canEdit(item) && s.itemInactive]}
            disabled={!canEdit(item)}
            onPress={() => router.push(`/master-data/minimums/${item.id}`)}
          >
            <Text style={s.itemTitle}>{item.name}</Text>
            <Text style={s.itemSub}>
              {[
                multiCompany ? data?.companyName.get(item.company_id) : null,
                mins.length ? `${mins.length} ${mins.length === 1 ? 'mínimo definido' : 'mínimos definidos'}` : 'Sem mínimos',
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            {below > 0 && (
              <Text style={s.badge}>
                {below} {below === 1 ? 'material abaixo' : 'materiais abaixo'} do mínimo
              </Text>
            )}
          </Pressable>
        );
      }}
    />
  );
}
