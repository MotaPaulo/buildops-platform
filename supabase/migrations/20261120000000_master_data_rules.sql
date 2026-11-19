-- Integrity rules for master data edited in the app.

-- -----------------------------------------------------------------------------
-- A warehouse tied to a site must belong to the same company as that site.
-- The original foreign key only checked that the site exists, so a warehouse of one company
-- could point to another company's site. Replace it with a composite key, like the ones used
-- for cost centers. Warehouses without a site (site_id null) are not affected.
-- -----------------------------------------------------------------------------

alter table public.sites
  add constraint sites_id_company_id_key unique (id, company_id);

alter table public.warehouses
  drop constraint warehouses_site_id_fkey;

alter table public.warehouses
  add constraint warehouses_site_company_fkey
  foreign key (site_id, company_id) references public.sites (id, company_id);

-- -----------------------------------------------------------------------------
-- A material's unit cannot change once it has movements: "40 sc" in the history
-- would silently become "40 kg". Fix the catalog by creating a new material instead.
-- -----------------------------------------------------------------------------

create function public.prevent_material_unit_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.unit is distinct from old.unit
     and exists (select 1 from public.stock_movements where material_id = old.id) then
    raise exception 'A unidade não pode mudar: o material já tem movimentações'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger materials_prevent_unit_change
  before update of unit on public.materials
  for each row execute function public.prevent_material_unit_change();
