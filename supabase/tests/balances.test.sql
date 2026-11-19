-- get_stock_balances() and get_cost_center_balances(): minimums without stock, visibility per user.
-- Run with `pnpm db:test`. Everything happens inside a transaction that is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, email, raw_user_meta_data) values
  ('cccccccc-0000-0000-0000-000000000001', 'test-storekeeper-a@buildops.test', '{"full_name":"T Almox A"}'),
  ('cccccccc-0000-0000-0000-000000000002', 'test-manager-b@buildops.test', '{"full_name":"T Gestor B"}'),
  ('cccccccc-0000-0000-0000-000000000003', 'test-foreman-ob1@buildops.test', '{"full_name":"T Mestre OB-001"}');
insert into public.memberships (user_id, role, company_id, cost_center_id) values
  ('cccccccc-0000-0000-0000-000000000001', 'storekeeper', '00000000-0000-0000-0000-000000000001', null),
  ('cccccccc-0000-0000-0000-000000000002', 'manager', '00000000-0000-0000-0000-000000000002', null),
  ('cccccccc-0000-0000-0000-000000000003', 'foreman', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001');

-- A material never received in the central warehouse, with a minimum there
insert into public.materials (id, name, unit) values ('cccccccc-0000-0000-0000-000000000010', 'Só mínimo', 'un');
insert into public.stock_minimums values ('30000000-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000010', 5);

-- An inactive material with a minimum (no stock): must not show up
insert into public.materials (id, name, unit, active) values ('cccccccc-0000-0000-0000-000000000011', 'Inativo', 'un', false);
insert into public.stock_minimums values ('30000000-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000011', 5);

create function pg_temp.act_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
grant execute on all functions in schema pg_temp to authenticated;
set local role authenticated;

select pg_temp.act_as('cccccccc-0000-0000-0000-000000000001');
select results_eq(
  $$select quantity, below_minimum from public.get_stock_balances() where material_id = 'cccccccc-0000-0000-0000-000000000010'$$,
  $$values (0::numeric, true)$$,
  'a minimum without stock shows as zero and below minimum');
select is_empty(
  $$select 1 from public.get_stock_balances() where material_id = 'cccccccc-0000-0000-0000-000000000011'$$,
  'inactive material without stock is left out');

select pg_temp.act_as('cccccccc-0000-0000-0000-000000000002');
select is_empty(
  $$select 1 from public.get_stock_balances() where material_id = 'cccccccc-0000-0000-0000-000000000010'$$,
  'another company does not see it');
select is_empty(
  $$select 1 from public.get_stock_balances() where company_id = '00000000-0000-0000-0000-000000000001'$$,
  'another company sees none of Construtora''s balances');

-- Cost center view: the foreman only sees OB-001, and its totals match the movements
select pg_temp.act_as('cccccccc-0000-0000-0000-000000000003');
select is_empty(
  $$select 1 from public.get_cost_center_balances() where cost_center_id <> '10000000-0000-0000-0000-000000000001'$$,
  'foreman sees only the cost center of his membership');

reset role;
create temp table expected as
  select material_id, sum(public.signed_quantity(kind, quantity)) as quantity
    from public.stock_movements where cost_center_id = '10000000-0000-0000-0000-000000000001'
   group by material_id having sum(public.signed_quantity(kind, quantity)) <> 0;
grant select on expected to authenticated;
set local role authenticated;
select pg_temp.act_as('cccccccc-0000-0000-0000-000000000003');
select set_eq(
  $$select material_id, quantity from public.get_cost_center_balances()$$,
  $$select material_id, quantity from expected$$,
  'charged quantities equal the sum of the cost center''s movements');

reset role;
select * from finish();
rollback;
