-- The Bakery Side: cuentas de cliente, tarjeta de sellos y recompensas
-- Reglas: 8 sellos por tarjeta; 1 sello por cada $10 en productos de un pedido pagado;
-- al completar 8 se gana una cookie gratis y la tarjeta reinicia; 2 sellos de bienvenida (+1 si llega referido);
-- quien invita gana 1 sello cuando el referido paga su primer pedido; $4 de cumpleaños durante su mes.

create table public.customers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text,
  phone text,
  address text,
  reference text,
  lat double precision,
  lng double precision,
  birthday date,
  referral_code text not null unique,
  referred_by uuid references public.customers(user_id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.stamp_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.customers(user_id) on delete cascade,
  delta int not null,
  reason text not null check (reason in ('bienvenida','referido_nuevo','referido_invita','pedido','premio','ajuste')),
  order_id uuid references public.orders(id) on delete set null,
  created_at timestamptz not null default now()
);
create index stamp_ledger_user_idx on public.stamp_ledger(user_id);

create table public.rewards (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.customers(user_id) on delete cascade,
  kind text not null default 'galleta' check (kind in ('galleta')),
  status text not null default 'disponible' check (status in ('disponible','reservado','usado')),
  order_id uuid references public.orders(id) on delete set null,
  created_at timestamptz not null default now(),
  used_at timestamptz
);
create index rewards_user_idx on public.rewards(user_id);

alter table public.orders
  add column user_id uuid references auth.users(id) on delete set null,
  add column discount numeric(10,2) not null default 0,
  add column birthday_discount boolean not null default false,
  add column reward_id bigint references public.rewards(id) on delete set null;
create index orders_user_idx on public.orders(user_id);

-- Suma o resta sellos; cada vez que el saldo llega a 8 se crea una recompensa y la tarjeta reinicia
create or replace function private.grant_stamps(p_user uuid, p_n int, p_reason text, p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
declare bal int;
begin
  if p_n = 0 then return; end if;
  insert into public.stamp_ledger(user_id, delta, reason, order_id) values (p_user, p_n, p_reason, p_order);
  select coalesce(sum(delta),0) into bal from public.stamp_ledger where user_id = p_user;
  while bal >= 8 loop
    insert into public.rewards(user_id) values (p_user);
    insert into public.stamp_ledger(user_id, delta, reason) values (p_user, -8, 'premio');
    bal := bal - 8;
  end loop;
end $$;
revoke execute on function private.grant_stamps(uuid,int,text,uuid) from public, anon, authenticated;

-- Al confirmarse el pago de un pedido con cuenta: sellos, recompensa usada y premio al referidor
create or replace function private.on_order_paid() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.customers; first_paid boolean;
begin
  if new.user_id is null or new.payment_status <> 'pagado' or old.payment_status = 'pagado' then return new; end if;
  select * into c from public.customers where user_id = new.user_id;
  if c.user_id is null then return new; end if;
  if new.reward_id is not null then
    update public.rewards set status = 'usado', used_at = now(), order_id = new.id where id = new.reward_id;
  end if;
  perform private.grant_stamps(new.user_id, floor(greatest(new.subtotal - new.discount, 0) / 10)::int, 'pedido', new.id);
  select not exists(select 1 from public.orders where user_id = new.user_id and payment_status = 'pagado' and id <> new.id) into first_paid;
  if first_paid and c.referred_by is not null
     and not exists(select 1 from public.stamp_ledger where reason = 'referido_invita' and order_id = new.id) then
    perform private.grant_stamps(c.referred_by, 1, 'referido_invita', new.id);
  end if;
  return new;
end $$;
revoke execute on function private.on_order_paid() from public, anon, authenticated;
create trigger orders_paid after update of payment_status on public.orders
  for each row execute function private.on_order_paid();

-- Si un pedido con premio reservado se cancela, el premio vuelve a estar disponible
create or replace function private.on_order_cancelled() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'cancelado' and old.status <> 'cancelado' and new.reward_id is not null and new.payment_status <> 'pagado' then
    update public.rewards set status = 'disponible', order_id = null where id = new.reward_id and status = 'reservado';
  end if;
  return new;
end $$;
revoke execute on function private.on_order_cancelled() from public, anon, authenticated;
create trigger orders_cancelled after update of status on public.orders
  for each row execute function private.on_order_cancelled();

-- Permisos: cada cliente ve solo lo suyo; la cocina ve todo
alter table public.customers enable row level security;
alter table public.stamp_ledger enable row level security;
alter table public.rewards enable row level security;
create policy "cliente ve su perfil" on public.customers for select using (user_id = auth.uid() or private.is_admin());
create policy "cliente ve sus sellos" on public.stamp_ledger for select using (user_id = auth.uid() or private.is_admin());
create policy "cliente ve sus premios" on public.rewards for select using (user_id = auth.uid() or private.is_admin());
create policy "cliente ve sus pedidos" on public.orders for select using (user_id = auth.uid());
create policy "items: cliente dueño del pedido" on public.order_items for select using (
  exists(select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid()));
