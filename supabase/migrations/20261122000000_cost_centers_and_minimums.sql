-- Rules for the cost center and minimum stock screens.

-- A cost center can't be deactivated while a site that isn't finished still charges to it.
create function public.prevent_cost_center_deactivation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.active and not new.active and exists (
    select 1 from public.sites
     where cost_center_id = new.id and status <> 'finished'
  ) then
    raise exception 'Centro de custo em uso por obra não concluída. Conclua a obra antes de desativá-lo'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger cost_centers_prevent_deactivation
  before update of active on public.cost_centers
  for each row execute function public.prevent_cost_center_deactivation();

-- Cost center codes are compared case-insensitively by people; store them uppercase.
update public.cost_centers set code = upper(code) where code <> upper(code);
alter table public.cost_centers add constraint cost_centers_code_upper check (code = upper(code));

-- Balances now also include materials that have a minimum but no movements yet (balance 0),
-- so the "below minimum" alert fires for items that were never received.
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
    coalesce(coalesce(b.quantity, 0) < sm.min_quantity, false),
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
  order by w.name, mat.name;
$$;
