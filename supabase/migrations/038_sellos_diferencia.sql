-- Sellos de los productos agregados a un pedido ya pagado (Cocina → Editar pedido).
-- 1) Al pagarse un pedido, lo que aún falta cobrar de diferencia (extra_due > 0) no suma sellos todavía.
-- 2) top_up_order_stamps: cuando la diferencia queda cobrada, entrega los sellos que faltan
--    (1 por cada $10 de productos del pedido completo, menos los que ya recibió por ese pedido).
create or replace function private.on_order_paid()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare c public.customers; first_paid boolean;
begin
  if new.user_id is null or new.payment_status <> 'pagado' or old.payment_status = 'pagado' then return new; end if;
  select * into c from public.customers where user_id = new.user_id;
  if c.user_id is null then return new; end if;
  if new.reward_id is not null then
    update public.rewards set status = 'usado', used_at = now(), order_id = new.id where id = new.reward_id;
  end if;
  perform private.grant_stamps(new.user_id, floor(greatest(new.subtotal - new.discount - greatest(coalesce(new.extra_due, 0), 0), 0) / 10)::int, 'pedido', new.id);
  select not exists(select 1 from public.orders where user_id = new.user_id and payment_status = 'pagado' and id <> new.id) into first_paid;
  if first_paid and c.referred_by is not null
     and not exists(select 1 from public.stamp_ledger where reason = 'referido_invita' and order_id = new.id) then
    perform private.grant_stamps(c.referred_by, 1, 'referido_invita', new.id);
  end if;
  return new;
end $function$;

create or replace function public.top_up_order_stamps(p_order uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare o public.orders; target int; have int; n int;
begin
  select * into o from public.orders where id = p_order;
  if o.id is null or o.user_id is null or o.payment_status <> 'pagado' or o.status = 'cancelado' or coalesce(o.extra_due, 0) > 0 then return 0; end if;
  if not exists(select 1 from public.customers where user_id = o.user_id) then return 0; end if;
  target := floor(greatest(o.subtotal - o.discount, 0) / 10)::int;
  select coalesce(sum(delta), 0) into have from public.stamp_ledger where reason = 'pedido' and order_id = o.id;
  n := target - have;
  if n <= 0 then return 0; end if;
  perform private.grant_stamps(o.user_id, n, 'pedido', o.id);
  return n;
end $function$;

revoke all on function public.top_up_order_stamps(uuid) from public, anon, authenticated;
grant execute on function public.top_up_order_stamps(uuid) to service_role;
