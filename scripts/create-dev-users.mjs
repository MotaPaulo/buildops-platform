// Cria usuários de teste no Supabase LOCAL, um por perfil, vinculados às empresas do seed.
// Uso: pnpm db:users   (depois de pnpm db:start / pnpm db:reset)
import { execSync } from 'node:child_process';

const status = JSON.parse(execSync('supabase status -o json', { encoding: 'utf8' }));
const url = status.API_URL;
const key = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;

if (!url?.startsWith('http://127.0.0.1')) {
  throw new Error(`Recusando rodar fora do ambiente local: ${url}`);
}

const PASSWORD = 'buildops123';
const COMPANY_A = '00000000-0000-0000-0000-000000000001'; // Construtora Exemplo
const CC_JARDIM = '10000000-0000-0000-0000-000000000001'; // OB-001 Residencial Jardim

const users = [
  { email: 'diretoria@buildops.test', name: 'Diretoria Teste', role: 'director' },
  { email: 'gestor@buildops.test', name: 'Gestor Teste', role: 'manager', company_id: COMPANY_A },
  { email: 'almox@buildops.test', name: 'Almoxarife Teste', role: 'storekeeper', company_id: COMPANY_A },
  { email: 'mestre@buildops.test', name: 'Mestre Teste', role: 'foreman', company_id: COMPANY_A, cost_center_id: CC_JARDIM },
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
    console.log(`- ${u.email}: já existe ou falhou (${created.status})`);
    continue;
  }

  const membership = await call('/rest/v1/memberships', {
    user_id: created.data.id,
    role: u.role,
    company_id: u.company_id ?? null,
    cost_center_id: u.cost_center_id ?? null,
  });
  if (!membership.ok) throw new Error(`Vínculo de ${u.email}: ${JSON.stringify(membership.data)}`);

  console.log(`+ ${u.email} (${u.role})`);
}

console.log(`\nSenha de todos: ${PASSWORD}`);
