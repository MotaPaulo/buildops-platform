-- =============================================================================
-- User management fixes
--
-- 1. A blocked (banned) user has no access, even while their access token is still valid:
--    the permission functions treat them as having no memberships.
-- 2. The same access can't be granted twice.
-- =============================================================================

create or replace function public.is_director()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    join auth.users u on u.id = m.user_id
    where m.user_id = (select auth.uid()) and m.role = 'director'
      and (u.banned_until is null or u.banned_until <= now())
  );
$$;

create or replace function public.has_company_access(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    join auth.users u on u.id = m.user_id
    where m.user_id = (select auth.uid())
      and (u.banned_until is null or u.banned_until <= now())
      and (m.role = 'director' or m.company_id = p_company_id)
  );
$$;

create or replace function public.has_cost_center_access(p_cost_center_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join auth.users u on u.id = m.user_id
    join public.cost_centers cc on cc.id = p_cost_center_id
    where m.user_id = (select auth.uid())
      and (u.banned_until is null or u.banned_until <= now())
      and (
        m.role = 'director'
        or (m.company_id = cc.company_id
            and (m.cost_center_id is null or m.cost_center_id = cc.id))
      )
  );
$$;

create or replace function public.has_role_in_company(p_company_id uuid, p_roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    join auth.users u on u.id = m.user_id
    where m.user_id = (select auth.uid())
      and (u.banned_until is null or u.banned_until <= now())
      and (m.role = 'director' or (m.company_id = p_company_id and m.role = any (p_roles)))
  );
$$;

-- Remove exact duplicate accesses, keeping the oldest row of each.
delete from public.memberships m
 using public.memberships older
 where older.user_id = m.user_id
   and older.role = m.role
   and older.company_id is not distinct from m.company_id
   and older.cost_center_id is not distinct from m.cost_center_id
   and (older.created_at, older.id) < (m.created_at, m.id);

alter table public.memberships
  add constraint memberships_unique_access
  unique nulls not distinct (user_id, role, company_id, cost_center_id);
