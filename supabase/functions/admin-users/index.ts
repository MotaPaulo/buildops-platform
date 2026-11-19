// Privileged user management for directors: create accounts and block or unblock them.
// The service-role key never leaves this function. The caller's identity comes only from their
// JWT: we ask the database whether they are a director under their own token, and only then use
// the service-role client. Messages are shown in the app, so they are pt-BR.
//
// POST { action: 'create', email, full_name, password, role, company_id?, cost_center_id? }
// POST { action: 'block' | 'unblock', user_id }
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY')!;

const ROLES = ['director', 'manager', 'storekeeper', 'foreman'];
const MIN_PASSWORD_LENGTH = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BAN_FOREVER = '876000h';
const LAST_DIRECTOR = 'É preciso manter ao menos um diretor.';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

const fail = (status: number, error: string) => reply(status, { error });

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const optionalId = (v: unknown) => (typeof v === 'string' && v ? v : null);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail(405, 'Método não permitido.');

  const authorization = req.headers.get('Authorization');
  if (!authorization) return fail(401, 'Sessão inválida. Entre novamente.');

  // Identity and permission, under the caller's own token
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await caller.auth.getUser(authorization.replace(/^Bearer\s+/i, ''));
  if (userError || !userData.user) return fail(401, 'Sessão inválida. Entre novamente.');
  const { data: isDirector, error: rpcError } = await caller.rpc('is_director');
  if (rpcError) return fail(500, rpcError.message);
  if (isDirector !== true) return fail(403, 'Somente a diretoria gerencia usuários.');

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail(400, 'Requisição inválida.');
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  switch (body.action) {
    case 'create':
      return createUser(admin, body);
    case 'block':
    case 'unblock':
      return setBlocked(admin, userData.user.id, optionalId(body.user_id), body.action === 'block');
    default:
      return fail(400, 'Ação desconhecida.');
  }
});

async function createUser(admin: SupabaseClient, body: Record<string, unknown>) {
  const email = text(body.email).toLowerCase();
  const fullName = text(body.full_name);
  const password = typeof body.password === 'string' ? body.password : '';
  const role = text(body.role);
  const companyId = optionalId(body.company_id);
  const costCenterId = optionalId(body.cost_center_id);

  if (!EMAIL_RE.test(email)) return fail(400, 'Informe um e-mail válido.');
  if (fullName.length < 2) return fail(400, 'Informe o nome do usuário.');
  if (password.length < MIN_PASSWORD_LENGTH) {
    return fail(400, `A senha precisa ter ao menos ${MIN_PASSWORD_LENGTH} caracteres.`);
  }

  // Same rules as validateAccess() in packages/shared/src/users.ts, checked before anything is created
  if (!ROLES.includes(role)) return fail(400, 'Escolha o perfil de acesso.');
  if (role === 'director') {
    if (companyId || costCenterId) {
      return fail(400, 'A diretoria vale para o grupo todo: não escolha empresa nem centro de custo.');
    }
  } else {
    if (!companyId || !UUID_RE.test(companyId)) return fail(400, 'Escolha a empresa deste acesso.');
    if (costCenterId && !UUID_RE.test(costCenterId)) {
      return fail(400, 'O centro de custo precisa ser da empresa escolhida.');
    }
    const { data: company, error } = await admin.from('companies').select('id').eq('id', companyId).maybeSingle();
    if (error) return fail(500, error.message);
    if (!company) return fail(400, 'Empresa não encontrada.');
    if (costCenterId) {
      const { data: cc, error: ccError } = await admin
        .from('cost_centers')
        .select('company_id')
        .eq('id', costCenterId)
        .maybeSingle();
      if (ccError) return fail(500, ccError.message);
      if (!cc || cc.company_id !== companyId) return fail(400, 'O centro de custo precisa ser da empresa escolhida.');
    }
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, must_change_password: true },
  });
  if (createError || !created.user) {
    const duplicate =
      createError?.code === 'email_exists' || /already (been )?registered|already exists/i.test(createError?.message ?? '');
    return duplicate
      ? fail(409, 'Já existe um usuário com este e-mail.')
      : fail(400, createError?.message ?? 'Não foi possível criar o usuário.');
  }

  const { error: membershipError } = await admin.from('memberships').insert({
    user_id: created.user.id,
    role,
    company_id: role === 'director' ? null : companyId,
    cost_center_id: role === 'director' ? null : costCenterId,
  });
  if (membershipError) {
    // Users are never deleted. The account exists without access; the director adds it in the
    // user's detail screen (access was validated above, so this should not happen).
    return reply(207, {
      user_id: created.user.id,
      error: `Usuário criado, mas o acesso não foi gravado (${membershipError.message}). Abra o usuário e adicione o acesso.`,
    });
  }

  return reply(200, { user_id: created.user.id });
}

async function setBlocked(admin: SupabaseClient, callerId: string, userId: string | null, block: boolean) {
  if (!userId) return fail(400, 'Usuário não informado.');

  if (block) {
    if (userId === callerId) return fail(400, 'Você não pode bloquear o seu próprio acesso.');

    // Blocking a director must leave at least one other active director
    const before = await otherActiveDirector(admin, userId);
    if ('error' in before) return fail(500, before.error);
    if (before.isDirector && !before.exists) return fail(400, LAST_DIRECTOR);
  }

  const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: block ? BAN_FOREVER : 'none' });
  if (error) return fail(error.status === 404 ? 404 : 400, error.status === 404 ? 'Usuário não encontrado.' : error.message);

  if (block) {
    // Two directors blocking each other at the same time could both pass the check above.
    // Re-check after the ban and undo it if no other active director remains.
    const after = await otherActiveDirector(admin, userId);
    if ('error' in after || (after.isDirector && !after.exists)) {
      await admin.auth.admin.updateUserById(userId, { ban_duration: 'none' });
      return 'error' in after ? fail(500, after.error) : fail(400, LAST_DIRECTOR);
    }
  }
  return reply(200, { user_id: userId, banned: block });
}

/** Whether userId has a director membership, and whether another unbanned director exists. */
async function otherActiveDirector(
  admin: SupabaseClient,
  userId: string,
): Promise<{ isDirector: boolean; exists: boolean } | { error: string }> {
  const { data: directors, error } = await admin.from('memberships').select('user_id').eq('role', 'director');
  if (error) return { error: error.message };
  const directorIds = new Set((directors ?? []).map((d) => d.user_id as string));
  if (!directorIds.has(userId)) return { isDirector: false, exists: true };
  for (const id of directorIds) {
    if (id === userId) continue;
    const { data, error: userError } = await admin.auth.admin.getUserById(id);
    if (userError) return { error: userError.message };
    const bannedUntil = data.user?.banned_until;
    if (data.user && (!bannedUntil || new Date(bannedUntil) <= new Date())) return { isDirector: true, exists: true };
  }
  return { isDirector: true, exists: false };
}
