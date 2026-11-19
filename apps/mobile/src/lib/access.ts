import type { Membership } from '@buildops/shared';
import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from 'react';

import { useAuth } from './auth';
import { supabase } from './supabase';

type MembershipsState = { memberships: Membership[] | null; error: string | null };

const MembershipsContext = createContext<MembershipsState>({ memberships: null, error: null });

/**
 * Loads the signed-in user's memberships once for all screens.
 * RLS returns only the user's own (or all of them, for directors), so filter by user_id.
 */
export function MembershipsProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [state, setState] = useState<MembershipsState>({ memberships: null, error: null });

  useEffect(() => {
    if (!userId) return;
    setState({ memberships: null, error: null });
    supabase
      .from('memberships')
      .select('role, company_id, cost_center_id')
      .eq('user_id', userId)
      .then(({ data, error }) =>
        setState(error ? { memberships: null, error: error.message } : { memberships: (data ?? []) as Membership[], error: null }),
      );
  }, [userId]);

  return createElement(MembershipsContext.Provider, { value: state }, children);
}

export const useMemberships = () => useContext(MembershipsContext);
