-- create_transfer(): who may authorize, and which inputs are rejected.
-- Run with `pnpm db:test`. Everything happens inside a transaction that is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

-- Seed ids (supabase/seed.sql)
--   companies: A ...0001 Construtora, B ...0002 Urbanismo
--   cost centers: OB-001 1...0001, OB-002 1...0002, LT-001 1...0003 (B), ADM 1...0004
--   warehouses: central 3...0001 (A), canteiro Jardim 3...0002 (A), canteiro Vale Verde 3...0003 (B)
--   material: cimento 4...0001

-- Test users, one per persona
insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'test-director@buildops.test', '{"full_name":"T Diretoria"}'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'test-manager@buildops.test', '{"full_name":"T Gestor"}'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'test-manager-ob1@buildops.test', '{"full_name":"T Gestor OB-001"}'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'test-storekeeper@buildops.test', '{"full_name":"T Almox"}');
insert into public.memberships (user_id, role, company_id, cost_center_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'director', null, null),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'manager', '00000000-0000-0000-0000-000000000001', null),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'manager', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'storekeeper', '00000000-0000-0000-0000-000000000001', null);

-- Stock to move: 50 bags of cement in the central warehouse, charged to ADM
insert into public.stock_movements (kind, company_id, warehouse_id, cost_center_id, material_id, quantity, source, external_system, external_ref)
values ('in', '00000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
        '10000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000001', 50, 'import', 'test', 'transfer-rules');

create function pg_temp.act_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- Central (ADM) -> canteiro Jardim (OB-001), 1 bag
create function pg_temp.central_to_jardim(p_qty numeric default 1) returns uuid language sql as $$
  select public.create_transfer('40000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004',
    '30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', p_qty, 'pgtap');
$$;

-- Central (ADM) -> canteiro Vale Verde (LT-001, other company)
create function pg_temp.central_to_vale() returns uuid language sql as $$
  select public.create_transfer('40000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004',
    '30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', 1, 'pgtap');
$$;

grant execute on all functions in schema pg_temp to authenticated;
set local role authenticated;

select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000002');
select lives_ok($$select pg_temp.central_to_jardim()$$, 'manager transfers within the company');
select throws_ok($$select pg_temp.central_to_vale()$$, '42501', null, 'manager cannot transfer to another company');
select throws_ok($$select pg_temp.central_to_jardim(0)$$, '22023', null, 'quantity must be positive');
select throws_ok($$select pg_temp.central_to_jardim(999999)$$, 'P0001', null, 'cannot transfer more than the balance');

select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001');
select lives_ok($$select pg_temp.central_to_vale()$$, 'director transfers between companies');

select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000003');
select throws_ok($$select pg_temp.central_to_jardim()$$, '42501', null,
  'manager limited to OB-001 cannot move stock charged to ADM');

select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000004');
select throws_ok($$select pg_temp.central_to_jardim()$$, '42501', null, 'storekeeper cannot authorize transfers');

-- Each successful transfer is one transfers row + an out/in pair, authorized by the caller
reset role;
select results_eq(
  $$select count(*)::int from public.stock_movements sm join public.transfers t on t.id = sm.transfer_id where t.notes = 'pgtap'$$,
  $$values (4)$$,
  'two transfers recorded as two movements each');

-- An inactive cost center is rejected (ADM has no site, so it can be deactivated)
update public.cost_centers set active = false where id = '10000000-0000-0000-0000-000000000004';
set local role authenticated;
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000002');
select throws_ok($$select pg_temp.central_to_jardim()$$, '22023', null, 'inactive cost center is rejected');

reset role;
select * from finish();
rollback;
