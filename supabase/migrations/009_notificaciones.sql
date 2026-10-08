-- The Bakery Side: avisos en el celular (notificaciones push) para cocina, moto y master
-- Pegar completo en Supabase → SQL Editor → New query → Run

create extension if not exists pg_net with schema extensions;

-- Claves internas (las llaves de notificaciones se crean solas la primera vez). Nadie las lee desde la web.
create table if not exists public.app_secrets (
  key text primary key,
  value text not null,
  created_at timestamptz not null default now()
);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;
insert into public.app_secrets (key, value)
values ('push_hook', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (key) do nothing;

-- Cada celular o computadora que activó los avisos
create table if not exists public.push_subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  panel text not null check (panel in ('cocina', 'moto', 'master')),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "cada quien ve sus avisos" on public.push_subscriptions;
create policy "cada quien ve sus avisos" on public.push_subscriptions for select using (user_id = auth.uid());
drop policy if exists "cada quien activa sus avisos" on public.push_subscriptions;
create policy "cada quien activa sus avisos" on public.push_subscriptions for insert with check (user_id = auth.uid());
drop policy if exists "cada quien cambia sus avisos" on public.push_subscriptions;
create policy "cada quien cambia sus avisos" on public.push_subscriptions for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "cada quien quita sus avisos" on public.push_subscriptions;
create policy "cada quien quita sus avisos" on public.push_subscriptions for delete using (user_id = auth.uid());
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- Llama a la función "push" cuando algo pasa con un pedido
create or replace function private.push_event(p_order uuid, p_event text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare sec text;
begin
  select value into sec from public.app_secrets where key = 'push_hook';
  if sec is null then return; end if;
  perform net.http_post(
    url := 'https://btwuncihlkecnkjrgfhz.supabase.co/functions/v1/push',
    body := jsonb_build_object('action', 'notify', 'order_id', p_order, 'event', p_event),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', sec)
  );
exception when others then
  null; -- un aviso que falla nunca debe frenar el pedido
end $$;
revoke execute on function private.push_event(uuid, text) from public, anon, authenticated;

create or replace function private.notify_order() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare ev text;
begin
  if new.status is distinct from old.status then
    ev := case
      when new.status = 'confirmado' and old.status = 'pendiente_pago' then 'pagado'
      when new.status = 'por_confirmar' then 'comprobante'
      when new.status in ('listo', 'en_camino', 'entregado', 'cancelado') then new.status
    end;
    if ev is not null then perform private.push_event(new.id, ev); end if;
  end if;
  if new.rider_id is not null and new.rider_id is distinct from old.rider_id then
    perform private.push_event(new.id, 'asignado');
  end if;
  return new;
end $$;
revoke execute on function private.notify_order() from public, anon, authenticated;
drop trigger if exists orders_push on public.orders;
create trigger orders_push after update of status, rider_id on public.orders
  for each row execute function private.notify_order();
