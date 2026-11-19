-- User management (migration 20261124): list_users() is director-only, only directors write
-- memberships, and at least one active director always remains.
-- Run with `pnpm db:test`. Everything happens inside a transaction that is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (id, email, raw_user_meta_data) values
  ('cccccccc-0000-0000-0000-000000000001', 'test-um-director@buildops.test', '{"full_name":"T Diretoria UM"}'),
  ('cccccccc-0000-0000-0000-000000000002', 'test-um-manager@buildops.test', '{"full_name":"T Gestor UM"}'),
  ('cccccccc-0000-0000-0000-000000000003', 'test-um-new@buildops.test', '{"full_name":"T Novo UM"}');
insert into public.memberships (id, user_id, role, company_id, cost_center_id) values
  ('dddddddd-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'director', null, null),
  ('dddddddd-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000002', 'manager', '00000000-0000-0000-0000-000000000001', null);

create function pg_temp.act_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
grant execute on all functions in schema pg_temp to authenticated;
set local role authenticated;

-- list_users
select pg_temp.act_as('cccccccc-0000-0000-0000-000000000002');
select throws_ok($$select * from public.list_users()$$, '42501', null, 'manager cannot list users');

select pg_temp.act_as('cccccccc-0000-0000-0000-000000000001');
select results_eq(
  $$select email, banned, jsonb_array_length(memberships) from public.list_users() where id = 'cccccccc-0000-0000-0000-000000000002'$$,
  $$values ('test-um-manager@buildops.test'::text, false, 1)$$,
  'director lists users with e-mail, block status and memberships');

-- Membership writes
select pg_temp.act_as('cccccccc-0000-0000-0000-000000000002');
select throws_ok($$insert into public.memberships (user_id, role, company_id)
  values ('cccccccc-0000-0000-0000-000000000003', 'storekeeper', '00000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'manager cannot insert memberships');
select is_empty($$delete from public.memberships where id = 'dddddddd-0000-0000-0000-000000000002' returning id$$,
  'manager cannot delete memberships');

select pg_temp.act_as('cccccccc-0000-0000-0000-000000000001');
select lives_ok($$insert into public.memberships (user_id, role, company_id)
  values ('cccccccc-0000-0000-0000-000000000003', 'storekeeper', '00000000-0000-0000-0000-000000000001')$$,
  'director inserts memberships');
select throws_ok($$insert into public.memberships (user_id, role) values ('cccccccc-0000-0000-0000-000000000003', 'foreman')$$,
  '23514', null, 'a non-director membership needs a company');
select throws_ok($$insert into public.memberships (user_id, role, company_id)
  values ('cccccccc-0000-0000-0000-000000000003', 'storekeeper', '00000000-0000-0000-0000-000000000001')$$,
  '23505', null, 'the same access cannot be granted twice');

-- A blocked user has no access while their token is still valid
reset role;
update auth.users set banned_until = now() + interval '1 day' where id = 'cccccccc-0000-0000-0000-000000000002';
set local role authenticated;
select pg_temp.act_as('cccccccc-0000-0000-0000-000000000002');
select is(public.has_company_access('00000000-0000-0000-0000-000000000001'), false, 'blocked user loses company access');
reset role;
update auth.users set banned_until = null where id = 'cccccccc-0000-0000-0000-000000000002';
set local role authenticated;
select pg_temp.act_as('cccccccc-0000-0000-0000-000000000001');

-- Last director: block every other director (rolled back) so the test director is the only active one
reset role;
update auth.users u set banned_until = now() + interval '1 day'
 where u.id <> 'cccccccc-0000-0000-0000-000000000001'
   and exists (select 1 from public.memberships m where m.user_id = u.id and m.role = 'director');
set local role authenticated;
select pg_temp.act_as('cccccccc-0000-0000-0000-000000000001');

select is(public.is_director(), true, 'the only active director is still a director');
select throws_ok($$delete from public.memberships where id = 'dddddddd-0000-0000-0000-000000000001'$$,
  'P0001', 'É preciso manter ao menos um diretor.', 'the last active director membership cannot be removed');
select throws_ok($$update public.memberships set role = 'manager', company_id = '00000000-0000-0000-0000-000000000001'
  where id = 'dddddddd-0000-0000-0000-000000000001'$$,
  'P0001', 'É preciso manter ao menos um diretor.', 'the last active director cannot be demoted');
select lives_ok($$delete from public.memberships where id = 'dddddddd-0000-0000-0000-000000000002'$$,
  'other memberships can still be removed');

insert into public.memberships (user_id, role) values ('cccccccc-0000-0000-0000-000000000003', 'director');
select lives_ok($$delete from public.memberships where id = 'dddddddd-0000-0000-0000-000000000001'$$,
  'a director can be removed once another active director exists');

select * from finish();
rollback;
