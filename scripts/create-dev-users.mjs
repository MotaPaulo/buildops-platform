// Creates test users in LOCAL Supabase, one per role, linked to the seed companies.
// Usage: pnpm db:users   (after pnpm db:start / pnpm db:reset)
import { execSync } from 'node:child_process';

const status = JSON.parse(execSync('supabase status -o json', { encoding: 'utf8' }));
const url = status.API_URL;
const key = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;

if (!url?.startsWith('http://127.0.0.1')) {
  throw new Error(`Refusing to run outside the local environment: ${url}`);
}

const PASSWORD = 'buildops123';
const COMPANY_A = '00000000-0000-0000-0000-000000000001'; // Construtora Exemplo
const COMPANY_B = '00000000-0000-0000-0000-000000000002'; // Urbanismo Exemplo
const CC_JARDIM = '10000000-0000-0000-0000-000000000001'; // OB-001 Residencial Jardim
const CC_CENTRAL = '10000000-0000-0000-0000-000000000002'; // OB-002 Edifício Central

// role: null creates a user with no membership (sees nothing).
const users = [
  // Construtora Exemplo, whole company
  { email: 'diretoria@buildops.test', name: 'Diretoria Teste', role: 'director' },
  { email: 'gestor@buildops.test', name: 'Gestor Teste', role: 'manager', company_id: COMPANY_A },
  { email: 'almox@buildops.test', name: 'Almoxarife Teste', role: 'storekeeper', company_id: COMPANY_A },
  // Construtora Exemplo, limited to one cost center
  { email: 'mestre@buildops.test', name: 'Mestre Teste', role: 'foreman', company_id: COMPANY_A, cost_center_id: CC_JARDIM },
  { email: 'mestre.central@buildops.test', name: 'Mestre Edifício Central', role: 'foreman', company_id: COMPANY_A, cost_center_id: CC_CENTRAL },
  { email: 'gestor.jardim@buildops.test', name: 'Gestor Residencial Jardim', role: 'manager', company_id: COMPANY_A, cost_center_id: CC_JARDIM },
  // Urbanismo Exemplo
  { email: 'gestor.urbanismo@buildops.test', name: 'Gestor Urbanismo', role: 'manager', company_id: COMPANY_B },
  { email: 'almox.urbanismo@buildops.test', name: 'Almoxarife Urbanismo', role: 'storekeeper', company_id: COMPANY_B },
  // No access
  { email: 'semacesso@buildops.test', name: 'Sem Acesso', role: null },
];

const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

async function call(path, body) {
  const res = await fetch(`${url}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null };
}

for (const u of users) {
  const created = await call('/auth/v1/admin/users', {
    email: u.email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: u.name },
  });

  if (!created.ok) {
    console.log(`- ${u.email}: already exists or failed (${created.status})`);
    continue;
  }

  if (u.role) {
    const membership = await call('/rest/v1/memberships', {
      user_id: created.data.id,
      role: u.role,
      company_id: u.company_id ?? null,
      cost_center_id: u.cost_center_id ?? null,
    });
    if (!membership.ok) throw new Error(`Membership for ${u.email}: ${JSON.stringify(membership.data)}`);
  }

  console.log(`+ ${u.email} (${u.role ?? 'no access'})`);
}

console.log(`\nPassword for all users: ${PASSWORD}`);
