-- Lo que realmente se pagó a Uber por cada pedido (sale del historial de viajes de Uber; nadie lo anota a mano)
alter table public.orders
  add column if not exists uber_cost numeric(10,2),
  add column if not exists uber_trip text,
  add column if not exists uber_match_sure boolean;
