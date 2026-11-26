-- The Bakery Side: pedidos que lleva a vender la mamá (página /mama). 25 nov 2026.
-- Ella entra con un enlace secreto (/mama?k=<clave>) sin cuenta ni contraseña: todas las funciones de abajo piden la clave.
-- Sus pedidos son canal 'vendedora', retiro en cocina, siempre 'confirmado' (cocina los prepara aunque aún no le paguen);
-- ella misma marca si ya le pagaron. Cocina los ve agrupados por día en una sola tarjeta.

create table if not exists public.sellers (
  id bigserial primary key,
  name text not null,
  key uuid not null unique default gen_random_uuid(),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.sellers enable row level security;
drop policy if exists "cocina lee vendedoras" on public.sellers;
create policy "cocina lee vendedoras" on public.sellers for select using (private.is_admin() or private.is_master());

alter table public.orders add column if not exists seller_id bigint references public.sellers(id);
create index if not exists orders_seller on public.orders (seller_id) where seller_id is not null;
alter table public.orders drop constraint if exists orders_channel_check;
alter table public.orders add constraint orders_channel_check check (channel in ('web', 'whatsapp', 'vendedora'));

insert into public.sellers (name) select 'Mamá' where not exists (select 1 from public.sellers);

-- vendedora activa por su clave
create or replace function private.seller_by_key(p_key text) returns public.sellers
language plpgsql security definer set search_path = public as $$
declare s public.sellers;
begin
  begin select * into s from public.sellers where key = p_key::uuid and active; exception when invalid_text_representation then s := null; end;
  if s.id is null then raise exception 'Enlace no válido. Pide uno nuevo a la cocina.' using errcode = 'P0001'; end if;
  return s;
end $$;

-- Todo lo que necesita la página: su nombre, el menú y sus pedidos (desde hace 7 días)
create or replace function public.seller_home(p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sellers;
begin
  s := private.seller_by_key(p_key);
  return jsonb_build_object(
    'name', s.name,
    'today', private.today_gye(),
    'products', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'price', p.price, 'cat', c.name) order by c.sort, p.sort)
       from public.products p left join public.categories c on c.id = p.category_id where p.active), '[]'),
    'orders', coalesce((select jsonb_agg(jsonb_build_object(
        'id', o.id, 'code', o.code, 'customer', o.customer_name, 'day', (o.scheduled_for at time zone 'America/Guayaquil')::date,
        'total', o.total, 'paid', o.payment_status = 'pagado', 'status', o.status, 'note', o.reference,
        'items', (select jsonb_agg(jsonb_build_object('product_id', i.product_id, 'name', i.name, 'quantity', i.quantity, 'line_total', i.line_total) order by i.id)
                  from public.order_items i where i.order_id = o.id)) order by o.scheduled_for, o.created_at)
       from public.orders o where o.seller_id = s.id and o.status <> 'cancelado'
        and o.scheduled_for >= (private.today_gye() - 7)::timestamp at time zone 'America/Guayaquil'), '[]'));
end $$;

-- Crear o editar un pedido. p_items: [{"product_id": 1, "quantity": 2}, ...]
create or replace function public.seller_save(p_key text, p_order uuid, p_customer text, p_day date, p_items jsonb, p_paid boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.sellers; o public.orders; st public.settings; v_sub numeric; v_lines jsonb; v_when timestamptz; v_id uuid; v_cnt int;
  today date := private.today_gye();
begin
  s := private.seller_by_key(p_key);
  if coalesce(trim(p_customer), '') = '' then raise exception 'Escribe el nombre de quien pidió.' using errcode = 'P0001'; end if;
  if p_day is null or p_day < today then raise exception 'Elige hoy o un día que viene.' using errcode = 'P0001'; end if;
  if p_day > today + 60 then raise exception 'Elige una fecha más cercana.' using errcode = 'P0001'; end if;

  -- productos válidos y cantidades
  select coalesce(jsonb_agg(jsonb_build_object('product_id', id, 'name', name, 'price', price, 'quantity', q)), '[]') into v_lines from (
    select p.id, p.name, p.price, sum(greatest(least((x->>'quantity')::int, 99), 0))::int q
      from jsonb_array_elements(coalesce(p_items, '[]')) x join public.products p on p.id = (x->>'product_id')::bigint
     group by p.id, p.name, p.price having sum(greatest(least((x->>'quantity')::int, 99), 0)) > 0) t;
  select count(*), coalesce(sum(price * quantity), 0) into v_cnt, v_sub
    from jsonb_to_recordset(v_lines) as l(product_id bigint, name text, price numeric, quantity int);
  if v_cnt = 0 then raise exception 'Agrega al menos un producto.' using errcode = 'P0001'; end if;

  -- hora: 10:00 de ese día (o ahora mismo si ya pasó)
  v_when := greatest((p_day + time '10:00') at time zone 'America/Guayaquil', now());

  if p_order is not null then
    select * into o from public.orders where id = p_order and seller_id = s.id for update;
    if o.id is null then raise exception 'Pedido no encontrado.' using errcode = 'P0001'; end if;
    if o.status not in ('confirmado', 'pendiente_pago') then raise exception 'Cocina ya lo está preparando: pide los cambios a la cocina.' using errcode = 'P0001'; end if;
    -- devuelve el stock de hoy de lo que tenía antes
    update public.products p set stock_left = p.stock_left + i.qty
      from (select product_id, sum(quantity) qty from public.order_items where order_id = o.id group by product_id) i
     where p.id = i.product_id and p.stock_left is not null and p.stock_day = today
       and (o.scheduled_for at time zone 'America/Guayaquil')::date = today;
    delete from public.order_items where order_id = o.id;
    update public.orders set customer_name = left(trim(p_customer), 80), reference = nullif(left(trim(coalesce(p_note, '')), 200), ''),
      scheduled_for = case when (scheduled_for at time zone 'America/Guayaquil')::date = p_day then scheduled_for else v_when end,
      eta = case when (scheduled_for at time zone 'America/Guayaquil')::date = p_day then eta else v_when end,
      subtotal = v_sub, total = v_sub,
      payment_status = case when p_paid then 'pagado' else 'pendiente' end,
      paid_at = case when p_paid then coalesce(paid_at, now()) else null end
     where id = o.id;
    v_id := o.id;
  else
    select * into st from public.settings limit 1;
    insert into public.orders (customer_name, customer_phone, address, reference, lat, lng, distance_km, prep_minutes,
      scheduled_for, eta, subtotal, delivery_fee, total, payment_method, payment_status, status, channel, fulfillment, seller_id, payment_ref, paid_at)
    values (left(trim(p_customer), 80), '', 'Lo lleva ' || s.name, nullif(left(trim(coalesce(p_note, '')), 200), ''), st.kitchen_lat, st.kitchen_lng, 0, 20,
      v_when, v_when, v_sub, 0, v_sub, 'transferencia', case when p_paid then 'pagado' else 'pendiente' end, 'confirmado', 'vendedora', 'pickup', s.id,
      'Venta de ' || s.name, case when p_paid then now() end)
    returning id into v_id;
  end if;

  insert into public.order_items (order_id, product_id, name, unit_price, quantity, line_total)
    select v_id, product_id, name, price, quantity, price * quantity
      from jsonb_to_recordset(v_lines) as l(product_id bigint, name text, price numeric, quantity int);
  -- stock del día: solo si es para hoy
  if p_day = today then
    update public.products p set stock_left = greatest(0, p.stock_left - l.quantity)
      from jsonb_to_recordset(v_lines) as l(product_id bigint, name text, price numeric, quantity int) where p.id = l.product_id and p.stock_left is not null and p.stock_day = today;
  end if;
  return (select jsonb_build_object('id', id, 'code', code, 'total', total) from public.orders where id = v_id);
end $$;

-- Ya me pagó / todavía no
create or replace function public.seller_paid(p_key text, p_order uuid, p_paid boolean) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sellers;
begin
  s := private.seller_by_key(p_key);
  update public.orders set payment_status = case when p_paid then 'pagado' else 'pendiente' end,
    paid_at = case when p_paid then coalesce(paid_at, now()) else null end
   where id = p_order and seller_id = s.id and status <> 'cancelado';
  if not found then raise exception 'Pedido no encontrado.' using errcode = 'P0001'; end if;
end $$;

-- Borrar (queda cancelado; el stock de hoy vuelve solo)
create or replace function public.seller_delete(p_key text, p_order uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sellers;
begin
  s := private.seller_by_key(p_key);
  update public.orders set status = 'cancelado', cancelled_at = now(), cancel_reason = 'Lo borró ' || s.name
   where id = p_order and seller_id = s.id and status in ('confirmado', 'pendiente_pago');
  if not found then raise exception 'Este pedido ya no se puede borrar: cocina ya lo preparó.' using errcode = 'P0001'; end if;
end $$;

revoke all on function private.seller_by_key(text) from public, anon, authenticated;
grant execute on function public.seller_home(text), public.seller_save(text, uuid, text, date, jsonb, boolean, text),
  public.seller_paid(text, uuid, boolean), public.seller_delete(text, uuid) to anon, authenticated;
