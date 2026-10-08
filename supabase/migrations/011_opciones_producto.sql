-- The Bakery Side: opciones de producto (por ejemplo, endulzante de las bebidas)
create table if not exists public.option_groups (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 1 and 40),
  required boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.option_choices (
  id bigint generated always as identity primary key,
  group_id bigint not null references public.option_groups(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  price_delta numeric(10,2) not null default 0 check (price_delta >= 0),
  sort int not null default 0,
  active boolean not null default true
);
create table if not exists public.product_option_groups (
  product_id bigint not null references public.products(id) on delete cascade,
  group_id bigint not null references public.option_groups(id) on delete cascade,
  primary key (product_id, group_id)
);
alter table public.order_items add column if not exists options jsonb;

alter table public.option_groups enable row level security;
alter table public.option_choices enable row level security;
alter table public.product_option_groups enable row level security;
do $$ declare t text; begin
  foreach t in array array['option_groups', 'option_choices', 'product_option_groups'] loop
    execute format('drop policy if exists "opciones visibles" on public.%I', t);
    execute format('create policy "opciones visibles" on public.%I for select using (true)', t);
    execute format('drop policy if exists "master edita opciones" on public.%I', t);
    execute format('create policy "master edita opciones" on public.%I for all using (private.is_master()) with check (private.is_master())', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Endulzante para las bebidas (menos Coconut Water), sin costo adicional, obligatorio
do $$ declare g bigint; begin
  if not exists (select 1 from public.option_groups where name = 'Endulzante') then
    insert into public.option_groups (name, required) values ('Endulzante', true) returning id into g;
    insert into public.option_choices (group_id, name, sort) values
      (g, 'Sin azúcar', 1), (g, 'Azúcar blanca', 2), (g, 'Azúcar morena', 3), (g, 'Stevia', 4);
    insert into public.product_option_groups (product_id, group_id)
      select id, g from public.products where name in ('Pink Lemonade', 'Cold Brew', 'Hibiscus Tea');
  end if;
end $$;
