-- =============================================================================
-- Etapa 1 · Controle de estoque
--
-- Modelo:
--   companies ─┬─ cost_centers ── sites (obras)
--              └─ warehouses (depósitos, opcionalmente ligados a uma obra)
--   materials (catálogo único do grupo)
--   stock_movements: livro-razão imutável de entradas, saídas, transferências e ajustes
--   transfers: agrupa o par saída/entrada de uma transferência e registra quem autorizou
--
-- O saldo físico é sempre calculado a partir das movimentações (por depósito e material).
-- O centro de custo de cada movimentação define a quem a entrada ou o consumo é apropriado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tipos
-- -----------------------------------------------------------------------------

create type public.app_role as enum (
  'director',     -- diretoria: vê e opera todo o grupo
  'manager',      -- gestor: administra sua empresa ou centro de custo
  'storekeeper',  -- almoxarife: entradas, saídas e cadastros de estoque
  'foreman'       -- mestre de obras: registra saídas (consumo) na obra
);

create type public.movement_kind as enum (
  'in',            -- entrada (compra, devolução)
  'out',           -- saída (consumo na obra)
  'transfer_out',  -- saída por transferência
  'transfer_in',   -- entrada por transferência
  'adjustment'     -- ajuste de inventário (quantidade com sinal)
);

create type public.record_source as enum (
  'app',          -- registrado no aplicativo
  'integration',  -- lido de um sistema legado
  'import'        -- importado de planilha
);

-- -----------------------------------------------------------------------------
-- Estrutura organizacional
-- -----------------------------------------------------------------------------

create table public.companies (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  tax_id     text unique,                 -- CNPJ
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.cost_centers (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  code       text not null,
  name       text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, code),
  unique (id, company_id)                 -- alvo das FKs compostas
);

create table public.sites (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id),
  cost_center_id uuid not null,
  name           text not null,
  address        text,
  status         text not null default 'active'
                 check (status in ('planned', 'active', 'finished')),
  created_at     timestamptz not null default now(),
  foreign key (cost_center_id, company_id) references public.cost_centers (id, company_id)
);

create table public.warehouses (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  site_id    uuid references public.sites (id),
  name       text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, company_id)
);

-- -----------------------------------------------------------------------------
-- Usuários e permissões
-- -----------------------------------------------------------------------------

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text not null,
  created_at timestamptz not null default now()
);

-- Um usuário pode ter vários vínculos. Diretoria não precisa de empresa.
-- Sem cost_center_id, o vínculo vale para a empresa inteira.
create table public.memberships (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  role           public.app_role not null,
  company_id     uuid references public.companies (id),
  cost_center_id uuid,
  created_at     timestamptz not null default now(),
  check (role = 'director' or company_id is not null),
  foreign key (cost_center_id, company_id) references public.cost_centers (id, company_id)
);

create index memberships_user_idx on public.memberships (user_id);

-- -----------------------------------------------------------------------------
-- Catálogo
-- -----------------------------------------------------------------------------

create table public.materials (
  id         uuid primary key default gen_random_uuid(),
  sku        text unique,
  name       text not null,
  unit       text not null,               -- un, kg, m, m², m³, sc, l...
  category   text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.stock_minimums (
  warehouse_id uuid not null references public.warehouses (id) on delete cascade,
  material_id  uuid not null references public.materials (id),
  min_quantity numeric(14, 3) not null check (min_quantity >= 0),
  primary key (warehouse_id, material_id)
);

-- -----------------------------------------------------------------------------
-- Movimentações
-- -----------------------------------------------------------------------------

create table public.transfers (
  id                  uuid primary key default gen_random_uuid(),
  material_id         uuid not null references public.materials (id),
  from_warehouse_id   uuid not null references public.warehouses (id),
  to_warehouse_id     uuid not null references public.warehouses (id),
  from_cost_center_id uuid not null references public.cost_centers (id),
  to_cost_center_id   uuid not null references public.cost_centers (id),
  quantity            numeric(14, 3) not null check (quantity > 0),
  authorized_by       uuid not null references public.profiles (id),
  notes               text,
  created_at          timestamptz not null default now(),
  check (from_warehouse_id <> to_warehouse_id or from_cost_center_id <> to_cost_center_id)
);

create table public.stock_movements (
  id             uuid primary key default gen_random_uuid(),
  kind           public.movement_kind not null,
  company_id     uuid not null references public.companies (id),
  warehouse_id   uuid not null,
  cost_center_id uuid not null,
  material_id    uuid not null references public.materials (id),
  quantity       numeric(14, 3) not null,
  unit_cost      numeric(14, 4) check (unit_cost >= 0),
  transfer_id    uuid references public.transfers (id),
  invoice_number text,
  photo_path     text,                    -- caminho no bucket movement-photos
  notes          text,
  source         public.record_source not null default 'app',
  external_system text,
  external_ref   text,
  occurred_at    timestamptz not null default now(),
  created_by     uuid references public.profiles (id) default auth.uid(),
  created_at     timestamptz not null default now(),

  -- depósito e centro de custo precisam ser da mesma empresa da movimentação
  foreign key (warehouse_id, company_id)   references public.warehouses (id, company_id),
  foreign key (cost_center_id, company_id) references public.cost_centers (id, company_id),

  check (case when kind = 'adjustment' then quantity <> 0 else quantity > 0 end),
  check ((kind in ('transfer_in', 'transfer_out')) = (transfer_id is not null)),
  check (source = 'app' or external_system is not null),
  unique (external_system, external_ref)  -- evita importar o mesmo registro duas vezes
);

create index stock_movements_balance_idx on public.stock_movements (warehouse_id, material_id);
create index stock_movements_cost_center_idx on public.stock_movements (cost_center_id, occurred_at desc);
create index stock_movements_company_idx on public.stock_movements (company_id, occurred_at desc);

-- Quantidade com sinal: positiva aumenta o saldo, negativa reduz.
create function public.signed_quantity(p_kind public.movement_kind, p_quantity numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when p_kind in ('out', 'transfer_out') then -p_quantity else p_quantity end;
$$;

-- -----------------------------------------------------------------------------
-- Funções de permissão (usadas pelas políticas RLS)
-- -----------------------------------------------------------------------------

create function public.is_director()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships
    where user_id = (select auth.uid()) and role = 'director'
  );
$$;

create function public.has_company_access(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = (select auth.uid())
      and (m.role = 'director' or m.company_id = p_company_id)
  );
$$;

create function public.has_cost_center_access(p_cost_center_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.cost_centers cc on cc.id = p_cost_center_id
    where m.user_id = (select auth.uid())
      and (
        m.role = 'director'
        or (m.company_id = cc.company_id
            and (m.cost_center_id is null or m.cost_center_id = cc.id))
      )
  );
$$;

-- Verdadeiro se o usuário tem um dos papéis na empresa (diretoria sempre tem).
create function public.has_role_in_company(p_company_id uuid, p_roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = (select auth.uid())
      and (m.role = 'director' or (m.company_id = p_company_id and m.role = any (p_roles)))
  );
$$;

-- Quem pode registrar cada tipo de movimentação manual no app.
create function public.can_register_movement(
  p_company_id uuid,
  p_cost_center_id uuid,
  p_kind public.movement_kind
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_cost_center_access(p_cost_center_id)
     and case p_kind
           when 'in'         then public.has_role_in_company(p_company_id, '{manager,storekeeper}')
           when 'out'        then public.has_role_in_company(p_company_id, '{manager,storekeeper,foreman}')
           when 'adjustment' then public.has_role_in_company(p_company_id, '{manager}')
           else false  -- transferências só via create_transfer()
         end;
$$;

-- -----------------------------------------------------------------------------
-- Regras de integridade
-- -----------------------------------------------------------------------------

-- Bloqueia saída maior que o saldo físico do depósito.
-- O lock por (depósito, material) evita que duas saídas simultâneas furem o saldo.
create function public.prevent_negative_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance numeric;
begin
  if public.signed_quantity(new.kind, new.quantity) >= 0 then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(new.warehouse_id::text || ':' || new.material_id::text, 0)
  );

  select coalesce(sum(public.signed_quantity(kind, quantity)), 0)
    into v_balance
    from public.stock_movements
   where warehouse_id = new.warehouse_id
     and material_id = new.material_id;

  if v_balance + public.signed_quantity(new.kind, new.quantity) < 0 then
    raise exception 'Saldo insuficiente: disponível %, solicitado %',
      v_balance, abs(new.quantity)
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger stock_movements_prevent_negative
  before insert on public.stock_movements
  for each row execute function public.prevent_negative_stock();

-- Cria o perfil quando um usuário é cadastrado no Supabase Auth.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- Operações (RPC)
-- -----------------------------------------------------------------------------

-- Transferência entre depósitos, obras ou empresas.
-- Dentro da mesma empresa: gestor da empresa autoriza. Entre empresas: só a diretoria.
-- Quem chama a função fica registrado como quem autorizou.
create function public.create_transfer(
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
  select company_id into v_from_company from public.warehouses where id = p_from_warehouse_id;
  select company_id into v_to_company   from public.warehouses where id = p_to_warehouse_id;

  if v_from_company is null or v_to_company is null then
    raise exception 'Depósito não encontrado';
  end if;

  if v_from_company = v_to_company then
    if not public.has_role_in_company(v_from_company, '{manager}') then
      raise exception 'Somente gestores ou a diretoria autorizam transferências' using errcode = '42501';
    end if;
  elsif not public.is_director() then
    raise exception 'Transferência entre empresas exige autorização da diretoria' using errcode = '42501';
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

-- Saldo físico por depósito e material, com estoque mínimo e alerta.
-- Calcula sobre todas as movimentações do depósito (inclusive de centros de custo
-- que o usuário não vê), mas só retorna depósitos das empresas que ele acessa.
create function public.get_stock_balances(p_company_id uuid default null)
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
    b.quantity,
    sm.min_quantity,
    coalesce(b.quantity < sm.min_quantity, false),
    b.last_movement_at
  from (
    select warehouse_id, material_id,
           sum(public.signed_quantity(kind, quantity)) as quantity,
           max(occurred_at) as last_movement_at
      from public.stock_movements
     group by warehouse_id, material_id
  ) b
  join public.warehouses w   on w.id = b.warehouse_id
  join public.materials  mat on mat.id = b.material_id
  left join public.stock_minimums sm
         on sm.warehouse_id = b.warehouse_id and sm.material_id = b.material_id
  where public.has_company_access(w.company_id)
    and (p_company_id is null or w.company_id = p_company_id)
  order by w.name, mat.name;
$$;

-- Funções expostas só a usuários autenticados.
revoke execute on function public.create_transfer(uuid, uuid, uuid, uuid, uuid, numeric, text) from public, anon;
revoke execute on function public.get_stock_balances(uuid) from public, anon;
grant execute on function public.create_transfer(uuid, uuid, uuid, uuid, uuid, numeric, text) to authenticated;
grant execute on function public.get_stock_balances(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

alter table public.companies       enable row level security;
alter table public.cost_centers    enable row level security;
alter table public.sites           enable row level security;
alter table public.warehouses      enable row level security;
alter table public.profiles        enable row level security;
alter table public.memberships     enable row level security;
alter table public.materials       enable row level security;
alter table public.stock_minimums  enable row level security;
alter table public.transfers       enable row level security;
alter table public.stock_movements enable row level security;

-- Empresas: cada um vê as suas; só a diretoria cadastra.
create policy companies_select on public.companies
  for select to authenticated using (public.has_company_access(id));
create policy companies_write on public.companies
  for all to authenticated using (public.is_director()) with check (public.is_director());

-- Centros de custo, obras e depósitos: leitura por empresa; gestor administra.
create policy cost_centers_select on public.cost_centers
  for select to authenticated using (public.has_company_access(company_id));
create policy cost_centers_write on public.cost_centers
  for all to authenticated
  using (public.has_role_in_company(company_id, '{manager}'))
  with check (public.has_role_in_company(company_id, '{manager}'));

create policy sites_select on public.sites
  for select to authenticated using (public.has_company_access(company_id));
create policy sites_write on public.sites
  for all to authenticated
  using (public.has_role_in_company(company_id, '{manager}'))
  with check (public.has_role_in_company(company_id, '{manager}'));

create policy warehouses_select on public.warehouses
  for select to authenticated using (public.has_company_access(company_id));
create policy warehouses_write on public.warehouses
  for all to authenticated
  using (public.has_role_in_company(company_id, '{manager,storekeeper}'))
  with check (public.has_role_in_company(company_id, '{manager,storekeeper}'));

-- Perfis: nomes visíveis para todos (aparecem em "registrado por" e "autorizado por").
create policy profiles_select on public.profiles
  for select to authenticated using (true);
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Vínculos: cada um vê os seus; diretoria vê e administra todos.
create policy memberships_select on public.memberships
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_director());
create policy memberships_write on public.memberships
  for all to authenticated using (public.is_director()) with check (public.is_director());

-- Materiais: catálogo único do grupo.
create policy materials_select on public.materials
  for select to authenticated using (true);
create policy materials_insert on public.materials
  for insert to authenticated
  with check (exists (
    select 1 from public.memberships m
    where m.user_id = (select auth.uid())
      and m.role in ('director', 'manager', 'storekeeper')
  ));
create policy materials_update on public.materials
  for update to authenticated
  using (exists (
    select 1 from public.memberships m
    where m.user_id = (select auth.uid())
      and m.role in ('director', 'manager', 'storekeeper')
  ));

-- Estoque mínimo: por depósito.
create policy stock_minimums_select on public.stock_minimums
  for select to authenticated
  using (exists (
    select 1 from public.warehouses w
    where w.id = warehouse_id and public.has_company_access(w.company_id)
  ));
create policy stock_minimums_write on public.stock_minimums
  for all to authenticated
  using (exists (
    select 1 from public.warehouses w
    where w.id = warehouse_id
      and public.has_role_in_company(w.company_id, '{manager,storekeeper}')
  ))
  with check (exists (
    select 1 from public.warehouses w
    where w.id = warehouse_id
      and public.has_role_in_company(w.company_id, '{manager,storekeeper}')
  ));

-- Transferências: leitura para quem acessa a origem ou o destino. Escrita só via create_transfer().
create policy transfers_select on public.transfers
  for select to authenticated
  using (public.has_cost_center_access(from_cost_center_id)
      or public.has_cost_center_access(to_cost_center_id));

-- Movimentações: imutáveis. Correções são feitas com novo lançamento de ajuste.
create policy stock_movements_select on public.stock_movements
  for select to authenticated
  using (public.has_cost_center_access(cost_center_id));
create policy stock_movements_insert on public.stock_movements
  for insert to authenticated
  with check (
    source = 'app'
    and created_by = (select auth.uid())
    and public.can_register_movement(company_id, cost_center_id, kind)
  );

-- -----------------------------------------------------------------------------
-- Storage: fotos de nota fiscal e de material
-- Caminho dos arquivos: {company_id}/{yyyy}/{mm}/{uuid}.jpg
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('movement-photos', 'movement-photos', false)
on conflict (id) do nothing;

create policy movement_photos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'movement-photos'
    and public.has_company_access(((storage.foldername(name))[1])::uuid)
  );

create policy movement_photos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'movement-photos'
    and public.has_company_access(((storage.foldername(name))[1])::uuid)
  );
