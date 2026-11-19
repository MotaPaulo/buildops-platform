-- Fixes from the code review of the Stage 1 screens.
--   * Inactive master data no longer leaks into the rules: transfers reject inactive cost centers,
--     and an unfinished site can't point at an inactive cost center (rule 10, from the sites side).
--   * A warehouse or material can't be deactivated while it still holds stock (rule 9).
--   * Balances leave out inactive warehouses and materials that hold no stock, so their minimums
--     stop raising alerts.
--   * New get_cost_center_balances(): net quantity charged to each cost center.

-- -----------------------------------------------------------------------------
-- Transfers: both cost centers must be active
-- -----------------------------------------------------------------------------

create or replace function public.create_transfer(
  p_material_id uuid,
  p_from_warehouse_id uuid,
  p_from_cost_center_id uuid,
  p_to_warehouse_id uuid,
  p_to_cost_center_id uuid,
  p_quantity numeric,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from_company uuid;
  v_to_company   uuid;
  v_transfer_id  uuid;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'A quantidade deve ser maior que zero' using errcode = '22023';
  end if;

  if p_from_warehouse_id = p_to_warehouse_id and p_from_cost_center_id = p_to_cost_center_id then
    raise exception 'Origem e destino são iguais' using errcode = '22023';
  end if;

  select company_id into v_from_company from public.warehouses where id = p_from_warehouse_id and active;
  select company_id into v_to_company   from public.warehouses where id = p_to_warehouse_id and active;

  if v_from_company is null or v_to_company is null then
    raise exception 'Depósito não encontrado ou inativo' using errcode = '22023';
  end if;

  if not exists (select 1 from public.materials where id = p_material_id and active) then
    raise exception 'Material não encontrado ou inativo' using errcode = '22023';
  end if;

  if not exists (select 1 from public.cost_centers where id = p_from_cost_center_id and active)
     or not exists (select 1 from public.cost_centers where id = p_to_cost_center_id and active) then
    raise exception 'Centro de custo não encontrado ou inativo' using errcode = '22023';
  end if;

  if v_from_company = v_to_company then
    if not public.has_role_in_company(v_from_company, '{manager}') then
      raise exception 'Somente gestores ou a diretoria autorizam transferências' using errcode = '42501';
    end if;
  elsif not public.is_director() then
    raise exception 'Transferência entre empresas exige autorização da diretoria' using errcode = '42501';
  end if;

  if not (public.has_cost_center_access(p_from_cost_center_id)
          and public.has_cost_center_access(p_to_cost_center_id)) then
    raise exception 'Seu perfil não tem acesso a um dos centros de custo' using errcode = '42501';
  end if;

  insert into public.transfers (
    material_id, from_warehouse_id, to_warehouse_id,
    from_cost_center_id, to_cost_center_id, quantity, authorized_by, notes
  ) values (
    p_material_id, p_from_warehouse_id, p_to_warehouse_id,
    p_from_cost_center_id, p_to_cost_center_id, p_quantity, auth.uid(), p_notes
  )
  returning id into v_transfer_id;

  insert into public.stock_movements
    (kind, company_id, warehouse_id, cost_center_id, material_id, quantity, transfer_id, notes)
  values
    ('transfer_out', v_from_company, p_from_warehouse_id, p_from_cost_center_id, p_material_id, p_quantity, v_transfer_id, p_notes),
    ('transfer_in',  v_to_company,   p_to_warehouse_id,   p_to_cost_center_id,   p_material_id, p_quantity, v_transfer_id, p_notes);

  return v_transfer_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Rule 10 from the sites side
-- -----------------------------------------------------------------------------

create function public.prevent_site_on_inactive_cost_center()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'finished' and not exists (
    select 1 from public.cost_centers where id = new.cost_center_id and active
  ) then
    raise exception 'O centro de custo desta obra está inativo. Reative-o ou escolha outro'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger sites_prevent_inactive_cost_center
  before insert or update of status, cost_center_id on public.sites
  for each row execute function public.prevent_site_on_inactive_cost_center();

-- -----------------------------------------------------------------------------
-- Rule 9: no deactivation while stock remains
-- -----------------------------------------------------------------------------

create function public.prevent_deactivation_with_stock()
returns trigger
language plpgsql
security definer  -- the balance spans cost centers the user may not see
set search_path = ''
as $$
declare
  v_column text;
  v_message text;
  v_has_stock boolean;
begin
  if not (old.active and not new.active) then
    return new;
  end if;

  if tg_table_name = 'warehouses' then
    v_column := 'warehouse_id';
    v_message := 'Este depósito ainda tem saldo. Transfira ou dê baixa antes de desativá-lo';
  else
    v_column := 'material_id';
    v_message := 'Este material ainda tem saldo em algum depósito. Zere o saldo antes de desativá-lo';
  end if;

  execute format(
    'select exists (
       select 1 from public.stock_movements
        where %I = $1
        group by warehouse_id, material_id
       having sum(public.signed_quantity(kind, quantity)) <> 0)',
    v_column)
  into v_has_stock
  using new.id;

  if v_has_stock then
    raise exception '%', v_message using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger warehouses_prevent_deactivation_with_stock
  before update of active on public.warehouses
  for each row execute function public.prevent_deactivation_with_stock();

create trigger materials_prevent_deactivation_with_stock
  before update of active on public.materials
  for each row execute function public.prevent_deactivation_with_stock();

-- -----------------------------------------------------------------------------
-- Balances: inactive items only while they still hold stock
-- -----------------------------------------------------------------------------

create or replace function public.get_stock_balances(p_company_id uuid default null)
returns table (
  company_id       uuid,
  warehouse_id     uuid,
  warehouse_name   text,
  site_id          uuid,
  material_id      uuid,
  material_name    text,
  unit             text,
  quantity         numeric,
  min_quantity     numeric,
  below_minimum    boolean,
  last_movement_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    w.company_id,
    w.id,
    w.name,
    w.site_id,
    mat.id,
    mat.name,
    mat.unit,
    coalesce(b.quantity, 0),
    sm.min_quantity,
    w.active and mat.active and coalesce(coalesce(b.quantity, 0) < sm.min_quantity, false),
    b.last_movement_at
  from (
    select warehouse_id, material_id,
           sum(public.signed_quantity(kind, quantity)) as quantity,
           max(occurred_at) as last_movement_at
      from public.stock_movements
     group by warehouse_id, material_id
  ) b
  full join public.stock_minimums sm
         on sm.warehouse_id = b.warehouse_id and sm.material_id = b.material_id
  join public.warehouses w   on w.id = coalesce(b.warehouse_id, sm.warehouse_id)
  join public.materials  mat on mat.id = coalesce(b.material_id, sm.material_id)
  where public.has_company_access(w.company_id)
    and (p_company_id is null or w.company_id = p_company_id)
    and ((w.active and mat.active) or coalesce(b.quantity, 0) <> 0)
  order by w.name, mat.name;
$$;

-- -----------------------------------------------------------------------------
-- Net quantity charged to each cost center
-- -----------------------------------------------------------------------------

-- Receipts and incoming transfers add, issues and outgoing transfers subtract, adjustments keep
-- their sign: what each cost center has been charged with, across all warehouses. It is not a
-- physical balance (that stays per warehouse). Runs with the caller's rights, so RLS limits it to
-- the cost centers the user can see.
create function public.get_cost_center_balances()
returns table (
  company_id       uuid,
  cost_center_id   uuid,
  cost_center_code text,
  cost_center_name text,
  material_id      uuid,
  material_name    text,
  unit             text,
  quantity         numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select cc.company_id, cc.id, cc.code, cc.name, mat.id, mat.name, mat.unit,
         sum(public.signed_quantity(sm.kind, sm.quantity))
    from public.stock_movements sm
    join public.cost_centers cc on cc.id = sm.cost_center_id
    join public.materials mat   on mat.id = sm.material_id
   group by cc.company_id, cc.id, cc.code, cc.name, mat.id, mat.name, mat.unit
  having sum(public.signed_quantity(sm.kind, sm.quantity)) <> 0
   order by cc.code, mat.name;
$$;

revoke execute on function public.get_cost_center_balances() from public, anon;
grant execute on function public.get_cost_center_balances() to authenticated;
