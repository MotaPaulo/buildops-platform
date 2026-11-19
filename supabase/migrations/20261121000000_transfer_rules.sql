-- Tightens create_transfer():
--   * the caller must have access to both cost centers (a manager limited to one cost center
--     can't move stock charged to another);
--   * inactive warehouses and materials can't be used;
--   * clearer errors for invalid quantities and same-place transfers.
-- Company consistency between warehouse and cost center is still enforced by the composite
-- foreign keys on stock_movements, and the balance by prevent_negative_stock().

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

-- create or replace keeps the existing grants (authenticated only).
