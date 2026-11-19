import { Stack } from 'expo-router';

import { MembershipsProvider } from '@/lib/access';
import { useAuth } from '@/lib/auth';

export default function AppLayout() {
  const { session } = useAuth();
  // Users created by a director get an initial password and must replace it before anything else.
  const mustChangePassword = session?.user.user_metadata?.must_change_password === true;

  return (
    <MembershipsProvider>
      <Stack>
        <Stack.Protected guard={!mustChangePassword}>
          <Stack.Screen name="index" options={{ title: 'Estoque' }} />
          <Stack.Screen name="movement" options={{ title: 'Nova movimentação' }} />
          <Stack.Screen name="transfer" options={{ title: 'Transferência' }} />
          <Stack.Screen name="history/index" options={{ title: 'Histórico' }} />
          <Stack.Screen name="history/[id]" options={{ title: 'Movimentação' }} />
          <Stack.Screen name="report" options={{ title: 'Relatório' }} />
          <Stack.Screen name="master-data/index" options={{ title: 'Cadastros' }} />
          <Stack.Screen name="master-data/materials/index" options={{ title: 'Materiais' }} />
          <Stack.Screen name="master-data/materials/[id]" options={{ title: 'Material' }} />
          <Stack.Screen name="master-data/warehouses/index" options={{ title: 'Depósitos' }} />
          <Stack.Screen name="master-data/warehouses/[id]" options={{ title: 'Depósito' }} />
          <Stack.Screen name="master-data/sites/index" options={{ title: 'Obras' }} />
          <Stack.Screen name="master-data/sites/[id]" options={{ title: 'Obra' }} />
          <Stack.Screen name="master-data/cost-centers/index" options={{ title: 'Centros de custo' }} />
          <Stack.Screen name="master-data/cost-centers/[id]" options={{ title: 'Centro de custo' }} />
          <Stack.Screen name="master-data/minimums/index" options={{ title: 'Estoque mínimo' }} />
          <Stack.Screen name="master-data/minimums/[warehouseId]" options={{ title: 'Mínimos' }} />
          <Stack.Screen name="master-data/users/index" options={{ title: 'Usuários' }} />
          <Stack.Screen name="master-data/users/new" options={{ title: 'Novo usuário' }} />
          <Stack.Screen name="master-data/users/[id]" options={{ title: 'Usuário' }} />
        </Stack.Protected>
        <Stack.Protected guard={mustChangePassword}>
          <Stack.Screen name="change-password" options={{ title: 'Trocar senha' }} />
        </Stack.Protected>
      </Stack>
    </MembershipsProvider>
  );
}
