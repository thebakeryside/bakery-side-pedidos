-- The Bakery Side: calculadora de costos y rentabilidad (solo master)
alter table public.settings
  add column if not exists cost_target_margin numeric(5,4) not null default 0.65,
  add column if not exists iva_rate numeric(5,4) not null default 0.15;

create table if not exists public.cost_items (
  id bigserial primary key,
  name text not null,
  kind text not null default 'ingrediente' check (kind in ('ingrediente','envase')),
  price numeric(10,4) not null default 0,          -- precio de compra SIN IVA
  pack_qty numeric(12,3) not null default 1 check (pack_qty > 0),
  unit text not null default 'g' check (unit in ('g','ml','uni')),
  iva boolean not null default true,               -- si paga IVA al comprarlo
  updated_at timestamptz not null default now()
);
create table if not exists public.cost_recipes (
  id bigserial primary key,
  name text not null,
  yield_qty numeric(10,2) not null default 1 check (yield_qty > 0),
  yield_unit text not null default 'porciones',
  notes text,
  updated_at timestamptz not null default now()
);
create table if not exists public.cost_recipe_items (
  id bigserial primary key,
  recipe_id bigint not null references public.cost_recipes(id) on delete cascade,
  item_id bigint not null references public.cost_items(id) on delete restrict,
  qty numeric(12,3) not null default 0
);
create table if not exists public.cost_presentations (
  id bigserial primary key,
  recipe_id bigint not null references public.cost_recipes(id) on delete cascade,
  name text not null,
  product_id bigint references public.products(id) on delete set null,
  units numeric(10,2) not null default 1 check (units > 0),  -- cuántas unidades de la receta lleva
  price numeric(10,2)                                        -- precio manual si no está ligado al menú
);
create table if not exists public.cost_presentation_items (
  id bigserial primary key,
  presentation_id bigint not null references public.cost_presentations(id) on delete cascade,
  item_id bigint not null references public.cost_items(id) on delete restrict,
  qty numeric(10,3) not null default 1
);

do $$ declare t text; begin
  foreach t in array array['cost_items','cost_recipes','cost_recipe_items','cost_presentations','cost_presentation_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "solo master" on public.%I', t);
    execute format('create policy "solo master" on public.%I for all using (private.is_master()) with check (private.is_master())', t);
  end loop;
end $$;
