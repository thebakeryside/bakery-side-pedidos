-- The Bakery Side: cocina opera el día; master configura
-- Incluye lo de 006 (el master entra a cocina sin estar en la lista de accesos).
-- Pegar completo en Supabase → SQL Editor → New query → Run

-- ===== 006: master fuera de la lista de cocina =====
create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where user_id = auth.uid() and (role = 'admin' or is_master));
$$;
delete from private.admin_emails where lower(email) = 'bjcucalon@gmail.com';

-- ===== Stock del día =====
alter table public.products
  add column if not exists sold_out_day date,
  add column if not exists stock_left int check (stock_left is null or stock_left >= 0),
  add column if not exists stock_day date;
comment on column public.products.sold_out_day is 'Agotado solo ese día (Guayaquil); al día siguiente vuelve a estar disponible.';
comment on column public.products.stock_left is 'Porciones que quedan hoy; solo vale si stock_day es hoy (Guayaquil). Null = sin límite.';

create or replace function private.today_gye() returns date
language sql stable as $$ select (now() at time zone 'America/Guayaquil')::date $$;
grant execute on function private.today_gye() to anon, authenticated;

-- Si un pedido se cancela sin haberse entregado, sus porciones vuelven al stock del día
create or replace function private.restore_stock_on_cancel() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  if new.status = 'cancelado' and old.status <> 'cancelado' and old.status <> 'entregado' then
    update public.products p set stock_left = p.stock_left + i.qty
    from (select product_id, sum(quantity) qty from public.order_items where order_id = new.id and line_total > 0 group by product_id) i
    where p.id = i.product_id and p.stock_left is not null and p.stock_day = private.today_gye()
      and (coalesce(new.scheduled_for, new.created_at) at time zone 'America/Guayaquil')::date = private.today_gye();
  end if;
  return new;
end $$;
revoke execute on function private.restore_stock_on_cancel() from public, anon, authenticated;
drop trigger if exists orders_restore_stock on public.orders;
create trigger orders_restore_stock after update of status on public.orders
  for each row execute function private.restore_stock_on_cancel();

-- ===== Cocina solo cambia stock en productos =====
create or replace function private.guard_products() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  if auth.uid() is null or private.is_master() then return new; end if; -- servidor o master
  if (new.name, new.description, new.price, new.prep_minutes, new.lead_hours, new.image_url, new.active, new.sort, new.category_id)
     is distinct from (old.name, old.description, old.price, old.prep_minutes, old.lead_hours, old.image_url, old.active, old.sort, old.category_id) then
    raise exception 'Solo el master puede cambiar el menú. En cocina puedes marcar agotado o las porciones del día.';
  end if;
  return new;
end $$;
revoke execute on function private.guard_products() from public, anon, authenticated;
drop trigger if exists products_guard on public.products;
create trigger products_guard before update on public.products for each row execute function private.guard_products();

drop policy if exists "admin crea productos" on public.products;
create policy "master crea productos" on public.products for insert with check (private.is_master());
drop policy if exists "admin crea categorías" on public.categories;
drop policy if exists "admin edita categorías" on public.categories;
create policy "master crea categorías" on public.categories for insert with check (private.is_master());
create policy "master edita categorías" on public.categories for update using (private.is_master()) with check (private.is_master());

-- ===== Cocina solo cambia horario y apertura =====
create or replace function private.guard_settings() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  if auth.uid() is null or private.is_master() then return new; end if;
  if (new.fee_base, new.fee_included_km, new.fee_per_km, new.fee_round_to, new.max_km, new.slot_minutes, new.slot_capacity,
      new.whatsapp_number, new.bank_info, new.kitchen_address, new.kitchen_lat, new.kitchen_lng, new.map_provider, new.route_factor, new.business_name, new.timezone)
     is distinct from
     (old.fee_base, old.fee_included_km, old.fee_per_km, old.fee_round_to, old.max_km, old.slot_minutes, old.slot_capacity,
      old.whatsapp_number, old.bank_info, old.kitchen_address, old.kitchen_lat, old.kitchen_lng, old.map_provider, old.route_factor, old.business_name, old.timezone) then
    raise exception 'Solo el master puede cambiar envíos, pagos y datos del negocio.';
  end if;
  return new;
end $$;
revoke execute on function private.guard_settings() from public, anon, authenticated;
drop trigger if exists settings_guard on public.settings;
create trigger settings_guard before update on public.settings for each row execute function private.guard_settings();

-- ===== Motorizados: cocina solo consulta =====
drop policy if exists "admin crea motorizados" on public.riders;
drop policy if exists "admin edita motorizados" on public.riders;
create policy "master crea motorizados" on public.riders for insert with check (private.is_master());
create policy "master edita motorizados" on public.riders for update using (private.is_master()) with check (private.is_master());

-- ===== Fotos del menú: solo master =====
drop policy if exists "admin sube fotos de productos" on storage.objects;
create policy "master sube fotos de productos" on storage.objects for all
  using (bucket_id = 'productos' and private.is_master()) with check (bucket_id = 'productos' and private.is_master());
