-- Payphone en la misma tabla de liquidaciones (channel = 'payphone'), una fila por semana de lunes a domingo.
-- gross = cobrado, commission = tarifa, other_charges = anulaciones/reembolsos, net = acreditado a la billetera.
alter table public.channel_settlements
  add column if not exists withdrawn numeric(10,2),        -- retiros a la cuenta bancaria en la semana
  add column if not exists balance_end numeric(10,2),      -- saldo en la billetera al consultar
  add column if not exists balance_at timestamptz,         -- cuándo se consultó ese saldo
  add column if not exists web_check numeric(10,2);        -- total de pedidos con tarjeta en la web esa semana (para cuadrar)
