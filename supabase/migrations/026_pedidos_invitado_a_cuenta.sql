-- The Bakery Side: al crear la cuenta, los pedidos como invitado se pasan a la cuenta (20 oct 2026)
-- Se toman los pedidos sin cuenta de los últimos 30 días hechos con el mismo correo (el de Google, ya verificado),
-- que no estén cancelados. Pasan al historial del cliente y los ya pagados suman sus sellos (1 por cada $10).
-- Los que todavía no se pagan suman sus sellos solos cuando se confirme el pago (trigger orders_paid).

create or replace function public.claim_guest_orders(p_user uuid, p_email text)
returns int language plpgsql security definer set search_path = public as $$
declare o record; n int; total int := 0; mail text := lower(trim(coalesce(p_email, '')));
begin
  if mail = '' or not exists(select 1 from public.customers where user_id = p_user) then return 0; end if;
  for o in
    update public.orders set user_id = p_user
     where user_id is null
       and lower(trim(customer_email)) = mail
       and created_at >= now() - interval '30 days'
       and status <> 'cancelado'
    returning id, payment_status, subtotal, discount
  loop
    if o.payment_status = 'pagado'
       and not exists(select 1 from public.stamp_ledger where reason = 'pedido' and order_id = o.id) then
      n := floor(greatest(o.subtotal - o.discount, 0) / 10)::int;
      perform private.grant_stamps(p_user, n, 'pedido', o.id);
      total := total + n;
    end if;
  end loop;
  return total;
end $$;
revoke execute on function public.claim_guest_orders(uuid, text) from public, anon, authenticated;
