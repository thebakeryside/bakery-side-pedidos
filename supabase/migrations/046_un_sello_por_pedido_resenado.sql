-- The Bakery Side: 1 sello por PEDIDO calificado, no por cada reseña (aplicado el 22 nov 2026; no se quitaron los sellos de más ya dados, decisión de Boris)
-- En la base seguía una versión vieja de moderate_review que daba 1 sello por cada reseña publicada
-- (un pedido de 4 productos = 4 sellos). Ahora, al publicar, solo se revisa si algún pedido entregado
-- quedó calificado completo (private.review_stamps: todos sus productos, el mismo día de la entrega) y
-- se da 1 sello por ese pedido, una sola vez (orders.review_stamp_at).

-- La columna de 017 nunca llegó a la base: sin ella review_stamps fallaba
alter table public.orders add column if not exists review_stamp_at timestamptz;

-- Pedidos que ya recibieron sello(s) por reseñas con la regla vieja: quedan marcados para no darles otro
update public.orders o set review_stamp_at = now()
 where o.review_stamp_at is null and o.status = 'entregado'
   and exists (select 1 from public.stamp_ledger l where l.user_id = o.user_id and l.reason = 'resena')
   and exists (select 1 from public.order_items i join public.reviews r
                 on r.user_id = o.user_id and r.product_id = i.product_id and r.stamp_granted
                where i.order_id = o.id);

drop function if exists public.moderate_review(bigint, text);
create function public.moderate_review(p_id bigint, p_status text)
returns int language plpgsql security definer set search_path = public, private as $$
declare r public.reviews;
begin
  if not (private.is_admin() or private.is_master()) then raise exception 'Sin permiso'; end if;
  if p_status not in ('publicada', 'oculta') then raise exception 'Estado no válido'; end if;
  update public.reviews set status = p_status, approved_at = case when p_status = 'publicada' then now() else approved_at end
   where id = p_id returning * into r;
  if r.id is null then raise exception 'Reseña no encontrada'; end if;
  if p_status = 'publicada' then return private.review_stamps(r.user_id); end if; -- 1 sello por pedido completo
  return 0;
end $$;
revoke execute on function public.moderate_review(bigint, text) from public, anon;
grant execute on function public.moderate_review(bigint, text) to authenticated;
