-- The Bakery Side: el sello por calificar el pedido solo vale si las reseñas se escriben el mismo día de la entrega (ya aplicado)
create or replace function private.review_stamps(p_user uuid) returns int
language plpgsql security definer set search_path = public, private as $$
declare o record; n int := 0; give boolean;
begin
  select review_stamp into give from public.settings limit 1;
  if not coalesce(give, false) then return 0; end if;
  for o in
    select ord.id from public.orders ord
     where ord.user_id = p_user and ord.status = 'entregado' and ord.review_stamp_at is null
       and not exists (
         select 1 from public.order_items i
          where i.order_id = ord.id and i.line_total > 0
            and not exists (select 1 from public.reviews r
                             where r.user_id = p_user and r.product_id = i.product_id and r.status = 'publicada'
                               and r.updated_at >= coalesce(ord.delivered_at, ord.created_at)
                               and (r.updated_at at time zone 'America/Guayaquil')::date = (coalesce(ord.delivered_at, ord.created_at) at time zone 'America/Guayaquil')::date))
       and exists (select 1 from public.order_items i where i.order_id = ord.id and i.line_total > 0)
  loop
    perform private.grant_stamps(p_user, 1, 'resena', o.id);
    update public.orders set review_stamp_at = now() where id = o.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function private.review_stamps(uuid) from public, anon, authenticated;
