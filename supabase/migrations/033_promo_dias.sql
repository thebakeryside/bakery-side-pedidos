-- Promociones por día de la semana: un producto con días marcados solo se vende esos días
-- (según el día en que se hace el pedido, hora de Guayaquil). 0 = domingo … 6 = sábado. Vacío = todos los días.
alter table public.products
  add column if not exists promo_days smallint[];

alter table public.products
  drop constraint if exists products_promo_days_chk;
alter table public.products
  add constraint products_promo_days_chk check (promo_days is null or promo_days <@ array[0,1,2,3,4,5,6]::smallint[]);

comment on column public.products.promo_days is 'Días de la semana en que se vende (0 = domingo … 6 = sábado, hora de Guayaquil). Null o vacío = todos los días.';
