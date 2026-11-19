import { Stack } from 'expo-router';

import { MembershipsProvider } from '@/lib/access';

export default function AppLayout() {
  return (
    <MembershipsProvider>
      <Stack>
        <Stack.Screen name="index" options={{ title: 'Saldo de estoque' }} />
        <Stack.Screen name="movement" options={{ title: 'Nova movimentação' }} />
        <Stack.Screen name="master-data/index" options={{ title: 'Cadastros' }} />
        <Stack.Screen name="master-data/materials/index" options={{ title: 'Materiais' }} />
        <Stack.Screen name="master-data/materials/[id]" options={{ title: 'Material' }} />
        <Stack.Screen name="master-data/warehouses/index" options={{ title: 'Depósitos' }} />
        <Stack.Screen name="master-data/warehouses/[id]" options={{ title: 'Depósito' }} />
        <Stack.Screen name="master-data/sites/index" options={{ title: 'Obras' }} />
        <Stack.Screen name="master-data/sites/[id]" options={{ title: 'Obra' }} />
      </Stack>
    </MembershipsProvider>
  );
}
