import type { Membership } from '@buildops/shared';
import { useEffect, useState } from 'react';

import { useAuth } from './auth';
import { supabase } from './supabase';

/** Vínculos do usuário logado. A RLS só devolve os do próprio usuário (ou todos, para a diretoria). */
export function useMemberships() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [memberships, setMemberships] = useState<Membership[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    supabase
      .from('memberships')
      .select('role, company_id, cost_center_id')
      .eq('user_id', userId)
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setMemberships((data ?? []) as Membership[]);
      });
  }, [userId]);

  return { memberships, error };
}
