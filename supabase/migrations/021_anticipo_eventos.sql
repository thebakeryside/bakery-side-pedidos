-- The Bakery Side: eventos con anticipo (75% para reservar, saldo el día del evento)
alter table public.orders
  add column if not exists deposit numeric(10,2),
  add column if not exists balance_due numeric(10,2) not null default 0,
  add column if not exists balance_paid_at timestamptz;
