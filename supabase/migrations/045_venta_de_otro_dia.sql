-- Registrar ventas de días anteriores: después de "＋ Pedido WhatsApp" → "Ya se entregó / venta de otro día",
-- la pantalla llama a esta función para dejar la venta en su fecha real (Ventas cuenta por created_at).
-- Solo cocina o master, solo pedidos recién registrados como "Registrado después de entregar" (últimos 15 min),
-- y como máximo 60 días atrás. Si la venta es de otro día, devuelve el stock de hoy que se descontó al registrarla.
create or replace function public.backdate_manual_order(p_code text, p_sold_at timestamptz)
returns text language plpgsql security definer set search_path = public as $$
declare
  o public.orders%rowtype;
  v_today date := (now() at time zone 'America/Guayaquil')::date;
  v_day date := (p_sold_at at time zone 'America/Guayaquil')::date;
  v_txt text := to_char(p_sold_at at time zone 'America/Guayaquil', 'DD/MM HH24:MI');
begin
  if not exists (select 1 from public.profiles where user_id = auth.uid() and (role = 'admin' or is_master)) then
    raise exception 'Solo cocina o master pueden cambiar la fecha de una venta.';
  end if;
  if p_sold_at > now() + interval '5 minutes' then raise exception 'La venta no puede ser en el futuro.'; end if;
  if p_sold_at < now() - interval '61 days' then raise exception 'Solo se pueden registrar ventas de los últimos 60 días.'; end if;
  select * into o from public.orders where code = p_code;
  if not found then raise exception 'Pedido no encontrado.'; end if;
  if o.status <> 'entregado' or o.delivery_note is distinct from 'Registrado después de entregar' or o.created_at < now() - interval '15 minutes' then
    raise exception 'Solo se puede cambiar la fecha de una venta recién registrada como entregada.';
  end if;
  if v_day <> v_today then
    update public.products p set stock_left = p.stock_left + q.qty
    from (select product_id, sum(quantity)::int qty from public.order_items where order_id = o.id and product_id is not null group by 1) q
    where p.id = q.product_id and p.stock_day = v_today and p.stock_left is not null;
  end if;
  update public.orders set
    created_at = p_sold_at, paid_at = p_sold_at, picked_at = p_sold_at, delivered_at = p_sold_at, eta = p_sold_at,
    delivery_note = case when v_day <> v_today then 'Venta del ' || v_txt || ' registrada después' else 'Registrado después de entregar (' || v_txt || ')' end,
    payment_ref = coalesce(payment_ref, '') || ' · venta del ' || v_txt
  where id = o.id;
  return o.code;
end $$;
revoke all on function public.backdate_manual_order(text, timestamptz) from public, anon;
grant execute on function public.backdate_manual_order(text, timestamptz) to authenticated;
