import { ROLE_LABELS, type AccessInput, type Company, type CostCenter } from '@buildops/shared';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { Alert, Platform } from 'react-native';

import { rows } from './data';
import { supabase } from './supabase';

export type Org = { companies: Company[]; costCenters: Required<CostCenter>[] };

/** Companies and cost centers used to pick and describe a user's access. */
export async function loadOrg(): Promise<Org> {
  const [companies, costCenters] = await Promise.all([
    supabase.from('companies').select('id, name').order('name'),
    supabase.from('cost_centers').select('id, company_id, code, name, active').order('code'),
  ]);
  return { companies: rows<Company[]>(companies), costCenters: rows<Required<CostCenter>[]>(costCenters) };
}

/** "Gestor · Construtora Exemplo · OB-001 Residencial Jardim" */
export function describeAccess(access: AccessInput, org: Org | null): string {
  const parts = [access.role ? ROLE_LABELS[access.role] : '—'];
  if (access.role === 'director') return `${parts[0]} · Grupo todo`;
  const company = org?.companies.find((c) => c.id === access.company_id);
  parts.push(company?.name ?? 'Empresa');
  const cc = org?.costCenters.find((c) => c.id === access.cost_center_id);
  parts.push(cc ? `${cc.code} ${cc.name}` : 'Empresa toda');
  return parts.join(' · ');
}

/** Calls the admin-users Edge Function and returns its error message (pt-BR), or null. */
export async function adminUsers(body: Record<string, unknown>): Promise<{ error: string | null; data?: unknown }> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body });
  // 207: the account was created but something after it failed; the body carries the message.
  if (!error) {
    const partial = (data as { error?: unknown } | null)?.error;
    return { error: partial ? String(partial) : null, data };
  }
  if (error instanceof FunctionsHttpError) {
    try {
      const payload = await error.context.json();
      if (payload?.error) return { error: String(payload.error) };
    } catch {
      // fall through to the generic message
    }
  }
  return { error: 'Não foi possível falar com o servidor. Tente novamente.' };
}

/** Asks for confirmation (window.confirm on the web, an alert on the phone). */
export function confirmAction(title: string, message: string, confirmLabel: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) }),
  );
}
