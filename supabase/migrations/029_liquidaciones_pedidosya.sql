-- Liquidaciones semanales de apps de delivery (PedidosYa). Semana de lunes a domingo;
-- PedidosYa manda el estado de cuenta el jueves siguiente. Claude las registra cada viernes.
create table if not exists public.channel_settlements (
  id bigint generated always as identity primary key,
  channel text not null default 'pedidosya',
  period_from date not null,                 -- lunes
  period_to date not null,                   -- domingo
  settled_on date,                           -- día del estado de cuenta (jueves)
  orders int,                                -- pedidos de la semana
  gross numeric(10,2),                       -- precio de lista de lo vendido
  discounts numeric(10,2) default 0,         -- descuentos que pone el negocio
  commission numeric(10,2),                  -- comisión de la app
  commission_tax numeric(10,2),              -- IVA de la comisión
  other_charges numeric(10,2) default 0,     -- cancelaciones, publicidad, Plus, etc.
  net numeric(10,2) not null,                -- lo que deposita la app
  app_discounts numeric(10,2),               -- descuentos que puso la app (informativo, no resta)
  bank text,                                 -- cuenta donde se acredita
  source text,                               -- de dónde salió el dato
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel, period_from)
);

alter table public.channel_settlements enable row level security;
drop policy if exists "master ve liquidaciones" on public.channel_settlements;
create policy "master ve liquidaciones" on public.channel_settlements
  for all using (private.is_master()) with check (private.is_master());
