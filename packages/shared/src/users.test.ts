import { describe, expect, it } from 'vitest';

import { canEditMasterData, type Membership } from './inventory';
import { matchesUserSearch, validateAccess, validateNewUser, validatePassword } from './users';

const A = 'company-a';
const B = 'company-b';
const costCenters = [
  { id: 'cc-ob-001', company_id: A },
  { id: 'cc-lt-001', company_id: B },
];

describe('validateAccess', () => {
  it('requires a role', () => {
    expect(validateAccess({ role: null, company_id: A, cost_center_id: null }, costCenters)).toMatch(/perfil/);
  });

  it('directors cover the whole group, without company or cost center', () => {
    expect(validateAccess({ role: 'director', company_id: null, cost_center_id: null }, costCenters)).toBeNull();
    expect(validateAccess({ role: 'director', company_id: A, cost_center_id: null }, costCenters)).toMatch(/grupo todo/);
  });

  it('every other role needs a company', () => {
    for (const role of ['manager', 'storekeeper', 'foreman'] as const) {
      expect(validateAccess({ role, company_id: null, cost_center_id: null }, costCenters)).toMatch(/empresa/);
      expect(validateAccess({ role, company_id: A, cost_center_id: null }, costCenters)).toBeNull();
    }
  });

  it('the cost center must belong to the chosen company', () => {
    expect(validateAccess({ role: 'foreman', company_id: A, cost_center_id: 'cc-ob-001' }, costCenters)).toBeNull();
    expect(validateAccess({ role: 'foreman', company_id: A, cost_center_id: 'cc-lt-001' }, costCenters)).toMatch(
      /centro de custo/,
    );
    expect(validateAccess({ role: 'foreman', company_id: A, cost_center_id: 'unknown' }, costCenters)).toMatch(
      /centro de custo/,
    );
  });
});

describe('validateNewUser', () => {
  const ok = { email: 'novo@buildops.test', full_name: 'Novo Usuário', password: '12345678' };

  it('accepts a complete form', () => {
    expect(validateNewUser(ok)).toBeNull();
    expect(validateNewUser({ ...ok, email: '  novo@buildops.test ' })).toBeNull();
  });

  it('rejects an invalid e-mail, a missing name or a short password', () => {
    expect(validateNewUser({ ...ok, email: 'novo@' })).toMatch(/e-mail/);
    expect(validateNewUser({ ...ok, full_name: ' ' })).toMatch(/nome/);
    expect(validateNewUser({ ...ok, password: '1234567' })).toMatch(/8 caracteres/);
  });

  it('validatePassword needs at least 8 characters', () => {
    expect(validatePassword('1234567')).not.toBeNull();
    expect(validatePassword('12345678')).toBeNull();
  });
});

describe('user list helpers', () => {
  it('search ignores case and accents and matches name or e-mail', () => {
    const u = { full_name: 'José Antônio', email: 'jose@buildops.test' };
    expect(matchesUserSearch(u, 'antonio')).toBe(true);
    expect(matchesUserSearch(u, 'JOSE@')).toBe(true);
    expect(matchesUserSearch(u, '')).toBe(true);
    expect(matchesUserSearch(u, 'maria')).toBe(false);
  });

  it('only directors manage users', () => {
    const director: Membership[] = [{ role: 'director', company_id: null, cost_center_id: null }];
    const manager: Membership[] = [{ role: 'manager', company_id: A, cost_center_id: null }];
    expect(canEditMasterData(director, 'users')).toBe(true);
    expect(canEditMasterData(manager, 'users')).toBe(false);
  });
});
