-- =============================================================================
-- User management by directors
--
-- Accounts are created and blocked by the admin-users Edge Function (service role).
-- Memberships are written directly by the app under the existing director-only RLS.
-- Users and profiles are never deleted: history references them. Access is removed by
-- deleting memberships, and login is stopped by banning the account.
-- =============================================================================

-- Users with their e-mail, block status and memberships. The app can't read auth.users,
-- so directors list users through this function.
create function public.list_users()
returns table (
  id              uuid,
  email           text,
  full_name       text,
  banned          boolean,
  last_sign_in_at timestamptz,
  memberships     jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_director() then
    raise exception 'Somente a diretoria gerencia usuários.' using errcode = '42501';
  end if;

  return query
  select
    p.id,
    u.email::text,
    p.full_name,
    coalesce(u.banned_until > now(), false),
    u.last_sign_in_at,
    coalesce(
      (select jsonb_agg(
                jsonb_build_object(
                  'id', m.id,
                  'role', m.role,
                  'company_id', m.company_id,
                  'cost_center_id', m.cost_center_id
                ) order by m.created_at)
         from public.memberships m
        where m.user_id = p.id),
      '[]'::jsonb
    )
  from public.profiles p
  join auth.users u on u.id = p.id
  order by p.full_name;
end;
$$;

revoke execute on function public.list_users() from public, anon;
grant execute on function public.list_users() to authenticated;

-- At least one active (not blocked) director must keep a director membership.
-- The advisory lock serializes concurrent removals, so two directors can't remove each other
-- at the same time. In a row-level BEFORE trigger, rows already deleted or updated earlier in the
-- same statement are visible, so a single statement can't remove every director either.
create function public.keep_one_director()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role <> 'director' then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and new.role = 'director' and new.user_id = old.user_id then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext('public.keep_one_director'));

  if not exists (
    select 1
      from public.memberships m
      join auth.users u on u.id = m.user_id
     where m.role = 'director'
       and m.id <> old.id
       and (u.banned_until is null or u.banned_until <= now())
  ) then
    raise exception 'É preciso manter ao menos um diretor.' using errcode = 'P0001';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger memberships_keep_one_director
  before update or delete on public.memberships
  for each row execute function public.keep_one_director();
