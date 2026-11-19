// Integration test of the admin-users Edge Function and user management rules, against the LOCAL
// stack (pnpm db:start, pnpm db:users). Usage: pnpm test:functions
// Accounts it creates are deleted at the end: they are throwaway test data with no history.
import { execSync } from 'node:child_process';
import assert from 'node:assert/strict';

const status = JSON.parse(execSync('supabase status -o json', { encoding: 'utf8' }));
const url = status.API_URL;
const anonKey = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
const serviceKey = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
if (!url?.startsWith('http://127.0.0.1')) throw new Error(`Refusing to run outside the local environment: ${url}`);

const PASSWORD = 'buildops123';
const COMPANY_A = '00000000-0000-0000-0000-000000000001';
const CC_LT001 = '10000000-0000-0000-0000-000000000003'; // belongs to company B
const stamp = Date.now();
const created = [];
let failures = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`OK     ${name}`);
  } catch (e) {
    failures++;
    console.log(`FAILED ${name}\n       ${e.message}`);
  }
}

async function signIn(email, password = PASSWORD) {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return { status: res.status, body: await res.json() };
}

async function token(email) {
  const { body } = await signIn(email);
  if (!body.access_token) throw new Error(`sign-in failed for ${email}: ${JSON.stringify(body)}`);
  return body.access_token;
}

async function adminUsers(accessToken, body) {
  const res = await fetch(`${url}/functions/v1/admin-users`, {
    method: 'POST',
    headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (json.user_id && body.action === 'create') created.push(json.user_id);
  return { status: res.status, body: json };
}

async function rpc(accessToken, fn) {
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  return { status: res.status, body: await res.json() };
}

const director = await token('diretoria@buildops.test');
const manager = await token('gestor@buildops.test');
const email = `teste.funcao.${stamp}@buildops.test`;
const newUser = { action: 'create', email, full_name: 'Teste Função', password: 'senha-inicial-1', role: 'storekeeper', company_id: COMPANY_A };

await check('director creates a user with an initial password and access', async () => {
  const r = await adminUsers(director, newUser);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const list = await rpc(director, 'list_users');
  const row = list.body.find((u) => u.email === email);
  assert.ok(row, 'user listed');
  assert.deepEqual(row.memberships.map((m) => [m.role, m.company_id]), [['storekeeper', COMPANY_A]]);
});

await check('the new user signs in and must change the password', async () => {
  const r = await signIn(email, 'senha-inicial-1');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.user.user_metadata.must_change_password, true);
});

await check('duplicate e-mail is rejected', async () => {
  const r = await adminUsers(director, newUser);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'Já existe um usuário com este e-mail.');
});

await check('a manager cannot use the function or list users', async () => {
  const r = await adminUsers(manager, { ...newUser, email: `x.${stamp}@buildops.test` });
  assert.equal(r.status, 403);
  const list = await rpc(manager, 'list_users');
  assert.equal(list.body.code, '42501');
});

await check('invalid access is rejected before anything is created', async () => {
  const noCompany = await adminUsers(director, { ...newUser, email: `y.${stamp}@buildops.test`, company_id: null });
  assert.equal(noCompany.status, 400);
  assert.equal(noCompany.body.error, 'Escolha a empresa deste acesso.');
  const wrongCc = await adminUsers(director, { ...newUser, email: `z.${stamp}@buildops.test`, cost_center_id: CC_LT001 });
  assert.equal(wrongCc.status, 400);
  assert.equal(wrongCc.body.error, 'O centro de custo precisa ser da empresa escolhida.');
  const list = await rpc(director, 'list_users');
  assert.ok(!list.body.some((u) => u.email.endsWith(`.${stamp}@buildops.test`) && u.email !== email));
});

await check('a blocked user cannot sign in; unblocking restores the old password', async () => {
  const userId = created[0];
  assert.equal((await adminUsers(director, { action: 'block', user_id: userId })).status, 200);
  const blocked = await signIn(email, 'senha-inicial-1');
  assert.equal(blocked.body.error_code ?? blocked.body.code, 'user_banned');
  assert.equal((await adminUsers(director, { action: 'unblock', user_id: userId })).status, 200);
  assert.equal((await signIn(email, 'senha-inicial-1')).status, 200);
});

await check('a director cannot block themselves', async () => {
  const me = JSON.parse(Buffer.from(director.split('.')[1], 'base64url').toString()).sub;
  const r = await adminUsers(director, { action: 'block', user_id: me });
  assert.equal(r.status, 400);
});

await check('public sign-up is closed', async () => {
  const res = await fetch(`${url}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `signup.${stamp}@buildops.test`, password: 'qualquer-senha-1' }),
  });
  const body = await res.json();
  assert.notEqual(res.status, 200, JSON.stringify(body));
  assert.equal(body.error_code ?? body.code, 'signup_disabled');
});

// Cleanup: throwaway accounts with no history
for (const id of created) {
  await fetch(`${url}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
}

console.log(failures ? `\n${failures} failed` : '\nAll passed');
process.exit(failures ? 1 : 0);
