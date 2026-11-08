-- Cuánto tarda el Uber en llegar a la cocina desde que se pide. Cocina lo usa para avisar
-- a qué hora pedirlo: hora de entrega − trayecto a la casa del cliente − esta espera.
alter table public.settings
  add column if not exists uber_wait_minutes integer not null default 15 check (uber_wait_minutes between 0 and 90);

comment on column public.settings.uber_wait_minutes is 'Minutos que tarda el Uber en llegar a la cocina desde que se pide (para avisar a cocina cuándo pedirlo).';

-- Marca de "ya pedí el Uber" (compartida entre los dispositivos de cocina)
alter table public.orders add column if not exists uber_requested_at timestamptz;
comment on column public.orders.uber_requested_at is 'Cuándo cocina pidió el Uber para este pedido (null = todavía no).';
