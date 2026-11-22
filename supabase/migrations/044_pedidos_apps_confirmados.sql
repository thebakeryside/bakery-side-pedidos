-- Pedidos de apps: la carga diaria los deja "por confirmar"; la tarea del viernes los cuadra con la factura semanal y pone confirmed_at.
alter table public.channel_orders add column if not exists confirmed_at timestamptz;
-- Semanas ya cuadradas al centavo con su factura (26 oct – 15 nov)
update public.channel_orders o set confirmed_at = now()
where confirmed_at is null and exists (select 1 from public.channel_settlements s where s.channel = o.channel
  and o.placed_at >= (s.period_from::timestamp + interval '5 hours') and o.placed_at < (s.period_to::timestamp + interval '29 hours'));
