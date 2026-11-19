// User management rules. The database and the admin-users Edge Function enforce them;
// these helpers only guide the screens. Messages are shown on screen, so they are pt-BR.
import type { AppRole } from './inventory';

/** Access a director grants to a user: one row of the memberships table. */
export interface AccessInput {
  role: AppRole | null;
  company_id: string | null;
  cost_center_id: string | null;
}

interface CostCenterRef {
  id: string;
  company_id: string;
}

/**
 * Checks a membership before it is inserted. Mirrors the memberships constraints: every role
 * except director needs a company, and the cost center must belong to that company.
 * Directors cover the whole group, so they take neither. Returns the error message, or null.
 */
export function validateAccess(access: AccessInput, costCenters: readonly CostCenterRef[]): string | null {
  if (!access.role) return 'Escolha o perfil de acesso.';
  if (access.role === 'director') {
    return access.company_id || access.cost_center_id
      ? 'A diretoria vale para o grupo todo: não escolha empresa nem centro de custo.'
      : null;
  }
  if (!access.company_id) return 'Escolha a empresa deste acesso.';
  if (access.cost_center_id) {
    const cc = costCenters.find((c) => c.id === access.cost_center_id);
    if (!cc || cc.company_id !== access.company_id) {
      return 'O centro de custo precisa ser da empresa escolhida.';
    }
  }
  return null;
}

export const MIN_PASSWORD_LENGTH = 8;

/** Checks a password typed for a new user or on the first-login password change. */
export function validatePassword(password: string): string | null {
  return password.length < MIN_PASSWORD_LENGTH
    ? `A senha precisa ter ao menos ${MIN_PASSWORD_LENGTH} caracteres.`
    : null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface NewUserInput {
  email: string;
  full_name: string;
  password: string;
}

/** Checks the new-user form (the access is checked by validateAccess). Returns the error, or null. */
export function validateNewUser(input: NewUserInput): string | null {
  if (!EMAIL_RE.test(input.email.trim())) return 'Informe um e-mail válido.';
  if (input.full_name.trim().length < 2) return 'Informe o nome do usuário.';
  return validatePassword(input.password);
}

/** Row returned by the list_users RPC (directors only). */
export interface UserRow {
  id: string;
  email: string;
  full_name: string;
  banned: boolean;
  last_sign_in_at: string | null;
  memberships: (AccessInput & { id: string; role: AppRole })[];
}

/** Case- and accent-insensitive search over name and e-mail. */
export function matchesUserSearch(user: Pick<UserRow, 'email' | 'full_name'>, query: string): boolean {
  const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const q = norm(query.trim());
  return !q || norm(user.full_name).includes(q) || norm(user.email).includes(q);
}
