-- The Bakery Side: PIN de entrega, correo del cliente y quién marcó la entrega

alter table public.orders add column if not exists customer_email text;
alter table public.orders add column if not exists delivered_by text;   -- 'moto' (con PIN) o 'cocina'
alter table public.orders add column if not exists delivery_note text;  -- motivo cuando cocina marca entregado sin PIN

-- PIN de 4 dígitos por pedido. Lo ve el cliente (seguimiento y correo) y cocina/master; el motorizado NO lo puede leer.
create table if not exists public.order_pins (
  order_id uuid primary key references public.orders(id) on delete cascade,
  pin text not null check (pin ~ '^\d{4}$'),
  attempts int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.order_pins enable row level security;
revoke all on public.order_pins from anon, authenticated;
grant select on public.order_pins to authenticated;
drop policy if exists "cocina ve los pin" on public.order_pins;
create policy "cocina ve los pin" on public.order_pins for select using (private.is_admin() or private.is_master());

create or replace function private.new_order_pin() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into public.order_pins (order_id, pin)
  values (new.id, lpad((floor(random() * 10000))::int::text, 4, '0'))
  on conflict (order_id) do nothing;
  return new;
end $$;
revoke execute on function private.new_order_pin() from public, anon, authenticated;
drop trigger if exists orders_pin on public.orders;
create trigger orders_pin after insert on public.orders for each row execute function private.new_order_pin();

-- PIN para los pedidos que ya existen y siguen en curso
insert into public.order_pins (order_id, pin)
select id, lpad((floor(random() * 10000))::int::text, 4, '0') from public.orders
where status not in ('entregado', 'cancelado')
on conflict (order_id) do nothing;

-- Motorizado: recoger y entregar. Entregar exige el PIN del cliente (5 intentos; luego cocina debe confirmarlo).
drop function if exists public.rider_action(uuid, text);
create or replace function public.rider_action(p_order uuid, p_action text, p_pin text default null)
returns text language plpgsql security definer set search_path = public as $$
-- devuelve 'ok' o un mensaje para el motorizado (un PIN equivocado no se lanza como error para que cuente el intento)
declare rid bigint := private.my_rider_id(); o public.orders; pp public.order_pins;
begin
  if rid is null then raise exception 'No eres un motorizado activo'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null or o.rider_id is distinct from rid then raise exception 'Pedido no asignado a ti'; end if;
  if p_action = 'aceptar' then
    update public.orders set rider_accepted_at = now() where id = p_order;
  elsif p_action = 'rechazar' and o.status in ('confirmado','preparando','listo') then
    update public.orders set rider_id = null, rider_accepted_at = null where id = p_order;
  elsif p_action = 'recoger' and o.status = 'listo' then
    update public.orders set status = 'en_camino', picked_at = now() where id = p_order;
  elsif p_action = 'entregar' and o.status = 'en_camino' then
    select * into pp from public.order_pins where order_id = p_order for update;
    if pp.order_id is not null then
      if pp.attempts >= 5 then return 'PIN bloqueado: llama a cocina para que confirme la entrega.'; end if;
      if coalesce(trim(p_pin), '') <> pp.pin then
        update public.order_pins set attempts = attempts + 1 where order_id = p_order;
        return case when pp.attempts >= 4 then 'PIN incorrecto. Se bloqueó: llama a cocina para que confirme la entrega.'
                    else format('PIN incorrecto. Te quedan %s intentos.', 4 - pp.attempts) end;
      end if;
    end if;
    update public.orders set status = 'entregado', delivered_at = now(), delivered_by = 'moto' where id = p_order;
  else
    raise exception 'Acción no permitida en el estado actual (%)', o.status;
  end if;
  return 'ok';
end $$;
revoke execute on function public.rider_action(uuid, text, text) from public, anon;
grant execute on function public.rider_action(uuid, text, text) to authenticated;

-- Seguimiento del cliente: ahora incluye el PIN (solo mientras el pedido está pagado y en curso) y si es regalo
drop function if exists public.track_order(uuid);
create or replace function public.track_order(p_token uuid)
returns table(code text, status text, payment_status text, scheduled_for timestamptz, eta timestamptz, created_at timestamptz,
  paid_at timestamptz, prep_started_at timestamptz, ready_at timestamptz, picked_at timestamptz, delivered_at timestamptz,
  subtotal numeric, delivery_fee numeric, total numeric, rider_name text, rider_plate text, items jsonb,
  delivery_pin text, is_gift boolean, payment_method text, has_receipt boolean)
language sql stable security definer set search_path = public as $$
  select o.code, o.status, o.payment_status, o.scheduled_for, o.eta, o.created_at, o.paid_at, o.prep_started_at,
         o.ready_at, o.picked_at, o.delivered_at, o.subtotal, o.delivery_fee, o.total,
         split_part(r.full_name,' ',1), r.plate,
         coalesce((select jsonb_agg(jsonb_build_object('name',i.name,'quantity',i.quantity,'line_total',i.line_total) order by i.id)
                   from public.order_items i where i.order_id = o.id), '[]'::jsonb),
         case when o.status in ('confirmado','preparando','listo','en_camino') then p.pin end,
         o.recipient_name is not null, o.payment_method, o.transfer_receipt_path is not null
  from public.orders o
  left join public.riders r on r.id = o.rider_id
  left join public.order_pins p on p.order_id = o.id
  where o.tracking_token = p_token;
$$;
grant execute on function public.track_order(uuid) to anon, authenticated;

-- Avisos: la transferencia confirmada avisa al cliente; y avisamos cuando empieza la preparación
create or replace function private.notify_order() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare ev text;
begin
  if new.status is distinct from old.status then
    ev := case
      when new.status = 'confirmado' and old.status = 'pendiente_pago' then 'pagado'
      when new.status = 'confirmado' and old.status = 'por_confirmar' then 'pago_confirmado' -- solo correo al cliente; cocina ya lo vio
      when new.status = 'por_confirmar' then 'comprobante'
      when new.status in ('preparando', 'listo', 'en_camino', 'entregado', 'cancelado') then new.status
    end;
    if ev is not null then perform private.push_event(new.id, ev); end if;
  end if;
  if new.rider_id is not null and new.rider_id is distinct from old.rider_id then
    perform private.push_event(new.id, 'asignado');
  end if;
  return new;
end $$;

drop trigger if exists orders_push_insert on public.orders;
