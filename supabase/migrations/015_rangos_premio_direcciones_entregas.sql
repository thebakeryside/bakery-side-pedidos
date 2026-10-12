-- The Bakery Side: rango de entrega, postre sorpresa, varias direcciones y facturas, dos entregas en un pago

-- 1) Ajustes que el master puede cambiar
alter table public.settings add column if not exists eta_window_minutes int not null default 30 check (eta_window_minutes between 10 and 120);
alter table public.settings add column if not exists transfer_extra_minutes int not null default 5 check (transfer_extra_minutes between 0 and 60);
alter table public.settings add column if not exists open_lead_minutes int not null default 60 check (open_lead_minutes between 0 and 240);
alter table public.settings add column if not exists reward_max_value numeric(6,2) not null default 4 check (reward_max_value between 0 and 50);

create or replace function private.guard_settings() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  if auth.uid() is null or private.is_master() then return new; end if;
  if (new.fee_base, new.fee_included_km, new.fee_per_km, new.fee_round_to, new.max_km, new.slot_minutes, new.slot_capacity,
      new.whatsapp_number, new.bank_info, new.kitchen_address, new.kitchen_lat, new.kitchen_lng, new.map_provider, new.route_factor,
      new.business_name, new.timezone, new.open_time, new.close_time, new.weekly_hours,
      new.eta_window_minutes, new.transfer_extra_minutes, new.open_lead_minutes, new.reward_max_value)
     is distinct from
     (old.fee_base, old.fee_included_km, old.fee_per_km, old.fee_round_to, old.max_km, old.slot_minutes, old.slot_capacity,
      old.whatsapp_number, old.bank_info, old.kitchen_address, old.kitchen_lat, old.kitchen_lng, old.map_provider, old.route_factor,
      old.business_name, old.timezone, old.open_time, old.close_time, old.weekly_hours,
      old.eta_window_minutes, old.transfer_extra_minutes, old.open_lead_minutes, old.reward_max_value) then
    raise exception 'Solo el master puede cambiar horarios, envíos, pagos y datos del negocio.';
  end if;
  return new;
end $$;

-- 2) Postre sorpresa: premio de la tarjeta de sellos (no aparece en el menú)
insert into public.products (name, description, price, prep_minutes, lead_hours, active, sort)
select 'Postre sorpresa', 'Premio de la tarjeta de sellos: cocina elige el postre del día.', 0, 10, 0, false, 999
where not exists (select 1 from public.products where name = 'Postre sorpresa');

-- 3) Varias direcciones y varios datos de factura por cliente
create table if not exists public.customer_addresses (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 30),
  address text not null check (char_length(address) between 1 and 200),
  reference text check (char_length(reference) <= 200),
  loc_label text check (char_length(loc_label) <= 200),
  lat double precision not null,
  lng double precision not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.customer_invoices (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  id_number text not null check (id_number ~ '^\d{10}(\d{3})?$'),
  name text not null check (char_length(name) between 1 and 120),
  email text not null check (char_length(email) between 3 and 120),
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
do $$ declare t text; begin
  foreach t in array array['customer_addresses', 'customer_invoices'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "cada cliente ve lo suyo" on public.%I', t);
    execute format('create policy "cada cliente ve lo suyo" on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create index if not exists %I on public.%I (user_id)', t || '_user', t);
  end loop;
end $$;

-- Las direcciones que ya estaban guardadas en la cuenta pasan a ser "Casa"
insert into public.customer_addresses (user_id, label, address, reference, lat, lng, is_default)
select c.user_id, 'Casa', split_part(c.address, ' · Ubicación del mapa: ', 1), c.reference, c.lat, c.lng, true
from public.customers c
where c.address is not null and c.lat is not null
  and not exists (select 1 from public.customer_addresses a where a.user_id = c.user_id);

-- 4) Dos entregas en un solo pago: los pedidos del mismo pago comparten group_id
alter table public.orders add column if not exists group_id uuid;
create index if not exists orders_group on public.orders (group_id) where group_id is not null;

-- Cuando uno del grupo queda pagado, los demás también (un solo pago cubre ambos)
create or replace function private.pay_group() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.group_id is not null and new.payment_status = 'pagado' and old.payment_status is distinct from 'pagado' then
    update public.orders
       set payment_status = 'pagado', paid_at = coalesce(paid_at, new.paid_at, now()),
           status = case when status in ('pendiente_pago', 'por_confirmar') then 'confirmado' else status end,
           payment_ref = coalesce(payment_ref, new.payment_ref)
     where group_id = new.group_id and id <> new.id and payment_status <> 'pagado' and status <> 'cancelado';
  end if;
  return new;
end $$;
revoke execute on function private.pay_group() from public, anon, authenticated;
drop trigger if exists orders_pay_group on public.orders;
create trigger orders_pay_group after update of payment_status on public.orders
  for each row execute function private.pay_group();

-- Seguimiento: incluye la otra entrega del mismo pago
drop function if exists public.track_order(uuid);
create or replace function public.track_order(p_token uuid)
returns table(code text, status text, payment_status text, scheduled_for timestamptz, eta timestamptz, created_at timestamptz,
  paid_at timestamptz, prep_started_at timestamptz, ready_at timestamptz, picked_at timestamptz, delivered_at timestamptz,
  subtotal numeric, delivery_fee numeric, total numeric, rider_name text, rider_plate text, items jsonb,
  delivery_pin text, is_gift boolean, payment_method text, has_receipt boolean, eta_window int, linked jsonb, group_total numeric)
language sql stable security definer set search_path = public as $$
  select o.code, o.status, o.payment_status, o.scheduled_for, o.eta, o.created_at, o.paid_at, o.prep_started_at,
         o.ready_at, o.picked_at, o.delivered_at, o.subtotal, o.delivery_fee, o.total,
         split_part(r.full_name,' ',1), r.plate,
         coalesce((select jsonb_agg(jsonb_build_object('name',i.name,'quantity',i.quantity,'line_total',i.line_total) order by i.id)
                   from public.order_items i where i.order_id = o.id), '[]'::jsonb),
         case when o.status in ('confirmado','preparando','listo','en_camino') then p.pin end,
         o.recipient_name is not null, o.payment_method, o.transfer_receipt_path is not null,
         (select s.eta_window_minutes from public.settings s limit 1),
         (select jsonb_agg(jsonb_build_object('code', g.code, 'tracking_token', g.tracking_token, 'scheduled_for', g.scheduled_for, 'eta', g.eta, 'status', g.status) order by g.created_at)
            from public.orders g where o.group_id is not null and g.group_id = o.group_id and g.id <> o.id),
         case when o.group_id is null then o.total else (select sum(g.total) from public.orders g where g.group_id = o.group_id) end
  from public.orders o
  left join public.riders r on r.id = o.rider_id
  left join public.order_pins p on p.order_id = o.id
  where o.tracking_token = p_token;
$$;
grant execute on function public.track_order(uuid) to anon, authenticated;
