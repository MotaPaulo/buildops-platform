import { canEditMasterData, type MasterDataKind } from '@buildops/shared';
import { router, type Href } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, Text } from 'react-native';

import { formStyles as s } from '@/components/form';
import { useMemberships } from '@/lib/access';

const SECTIONS: { kind: MasterDataKind; title: string; description: string; href: Href }[] = [
  {
    kind: 'materials',
    title: 'Materiais',
    description: 'Catálogo único do grupo: nome, unidade, código e categoria.',
    href: '/master-data/materials',
  },
  {
    kind: 'warehouses',
    title: 'Depósitos',
    description: 'Almoxarifados e canteiros de cada empresa.',
    href: '/master-data/warehouses',
  },
  {
    kind: 'sites',
    title: 'Obras',
    description: 'Obras de cada empresa e o centro de custo de cada uma.',
    href: '/master-data/sites',
  },
  {
    kind: 'costCenters',
    title: 'Centros de custo',
    description: 'Códigos usados pelo financeiro para apropriar entradas e consumos.',
    href: '/master-data/cost-centers',
  },
  {
    kind: 'minimums',
    title: 'Estoque mínimo',
    description: 'Quantidade mínima de cada material por depósito, para o alerta de falta.',
    href: '/master-data/minimums',
  },
];

export default function MasterDataScreen() {
  const { memberships } = useMemberships();
  if (!memberships) return <ActivityIndicator style={s.center} />;

  const sections = SECTIONS.filter((sec) => canEditMasterData(memberships, sec.kind));
  if (!sections.length) return <Text style={s.center}>Seu perfil não edita cadastros.</Text>;

  return (
    <ScrollView contentContainerStyle={s.list}>
      {sections.map((sec) => (
        <Pressable key={sec.kind} style={s.item} onPress={() => router.push(sec.href)}>
          <Text style={s.itemTitle}>{sec.title}</Text>
          <Text style={s.itemSub}>{sec.description}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
