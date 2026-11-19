import { Stack } from 'expo-router';
import { Pressable, Text } from 'react-native';

import { supabase } from '@/lib/supabase';

export default function AppLayout() {
  return (
    <Stack
      screenOptions={{
        headerRight: () => (
          <Pressable onPress={() => supabase.auth.signOut()} hitSlop={8} style={{ paddingHorizontal: 12 }}>
            <Text>Sair</Text>
          </Pressable>
        ),
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Saldo de estoque' }} />
      <Stack.Screen name="movement" options={{ title: 'Nova movimentação', headerRight: undefined }} />
    </Stack>
  );
}
