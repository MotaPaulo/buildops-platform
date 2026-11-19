-- Integrity rules on master data (migrations 20261120, 20261122 and 20261123).
-- Run with `pnpm db:test`. Everything happens inside a transaction that is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

-- Fixtures: a material, a warehouse and a cost center created just for this test
insert into public.materials (id, name, unit) values ('bbbbbbbb-0000-0000-0000-000000000001', 'Teste pgTAP', 'kg');
insert into public.warehouses (id, company_id, name)
values ('bbbbbbbb-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Depósito pgTAP');
insert into public.cost_centers (id, company_id, code, name)
values ('bbbbbbbb-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'PGTAP', 'Teste');

-- Material unit
select lives_ok($$update public.materials set unit = 'sc' where id = 'bbbbbbbb-0000-0000-0000-000000000001'$$,
  'unit can change while the material has no movements');

insert into public.stock_movements (kind, company_id, warehouse_id, cost_center_id, material_id, quantity, source, external_system, external_ref)
values ('in', '00000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002',
        'bbbbbbbb-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000001', 10, 'import', 'test', 'master-data-rules');

select throws_ok($$update public.materials set unit = 'kg' where id = 'bbbbbbbb-0000-0000-0000-000000000001'$$,
  'P0001', null, 'unit is fixed once the material has movements');

-- Rule 9: no deactivation while stock remains
select throws_ok($$update public.warehouses set active = false where id = 'bbbbbbbb-0000-0000-0000-000000000002'$$,
  'P0001', null, 'warehouse with stock cannot be deactivated');
select throws_ok($$update public.materials set active = false where id = 'bbbbbbbb-0000-0000-0000-000000000001'$$,
  'P0001', null, 'material with stock cannot be deactivated');

insert into public.stock_movements (kind, company_id, warehouse_id, cost_center_id, material_id, quantity, source, external_system, external_ref)
values ('out', '00000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002',
        'bbbbbbbb-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000001', 10, 'import', 'test', 'master-data-rules-2');

select lives_ok($$update public.warehouses set active = false where id = 'bbbbbbbb-0000-0000-0000-000000000002'$$,
  'warehouse can be deactivated once its balance is zero');

-- Warehouse and site belong to the same company (composite FK)
select throws_ok($$insert into public.warehouses (company_id, site_id, name)
  values ('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', 'Errado')$$,
  '23503', null, 'warehouse cannot point at another company''s site');

-- Cost centers
select throws_ok($$insert into public.cost_centers (company_id, code, name)
  values ('00000000-0000-0000-0000-000000000001', 'ob-009', 'minúsculo')$$,
  '23514', null, 'cost center codes are uppercase');
select throws_ok($$update public.cost_centers set active = false where id = '10000000-0000-0000-0000-000000000001'$$,
  'P0001', null, 'cost center of an unfinished site cannot be deactivated');

-- Rule 10 from the sites side
update public.sites set status = 'finished' where id = '20000000-0000-0000-0000-000000000002';
select lives_ok($$update public.cost_centers set active = false where id = '10000000-0000-0000-0000-000000000002'$$,
  'cost center can be deactivated once its site is finished');
select throws_ok($$update public.sites set status = 'active' where id = '20000000-0000-0000-0000-000000000002'$$,
  'P0001', null, 'a site cannot be reopened onto an inactive cost center');
select throws_ok($$insert into public.sites (company_id, cost_center_id, name)
  values ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'Nova')$$,
  'P0001', null, 'a new site cannot use an inactive cost center');

select * from finish();
rollback;
