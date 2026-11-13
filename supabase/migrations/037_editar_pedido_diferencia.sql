-- Cocina puede editar un pedido ya hecho: agregar productos y cambiar el envío.
-- Si el pedido ya estaba pagado (o con transferencia por revisar), lo que cambia el total queda como diferencia:
--   extra_due > 0  → falta cobrarle al cliente
--   extra_due < 0  → hay que devolverle
-- Al confirmar el cobro, extra_due vuelve a 0 y se suma en extra_paid.
alter table public.orders
  add column if not exists extra_due numeric(10,2) not null default 0,
  add column if not exists extra_paid numeric(10,2) not null default 0,
  add column if not exists extra_paid_at timestamptz,
  add column if not exists extra_ref text,
  add column if not exists fee_edited boolean not null default false;
