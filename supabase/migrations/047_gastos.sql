-- The Bakery Side: gastos del negocio (Master → Gastos, solo master). 25 nov 2026.
-- Los registra Claude cada semana (viajes de Uber, fotos de facturas que sube Boris, correos) y también se pueden poner a mano.
-- status: 'ok' = cuenta en el resultado · 'revisar' = Claude no está seguro (p. ej. un Uber que no coincide con un pedido) · 'por_leer' = foto subida que Claude aún no leyó.
create table if not exists public.expenses (
  id bigserial primary key,
  spent_on date not null default ((now() at time zone 'America/Guayaquil')::date),
  category text not null default 'otros' check (category in
    ('insumos','empaque','delivery','publicidad','servicios','software','equipos','personal','impuestos','otros')),
  description text not null default '',
  supplier text,
  amount numeric(10,2) check (amount is null or amount >= 0),
  payment_method text check (payment_method in ('efectivo','transferencia','tarjeta','otro')),
  status text not null default 'ok' check (status in ('ok','revisar','por_leer')),
  source text not null default 'manual' check (source in ('manual','claude','foto')),
  source_ref text unique,                      -- para no duplicar: 'uber:<viaje>', 'gmail:<id>', 'mensual:<id>:<AAAA-MM>'
  receipt_path text,                           -- foto en el bucket privado 'gastos'
  order_id uuid references public.orders(id) on delete set null,  -- pedido que se entregó con ese Uber
  repeat_monthly boolean not null default false, -- gasto fijo: la tarea semanal lo copia cada mes
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expenses_amount_ok check (status = 'por_leer' or amount is not null)
);
create index if not exists expenses_spent_on_idx on public.expenses (spent_on);

alter table public.expenses enable row level security;
drop policy if exists "solo master" on public.expenses;
create policy "solo master" on public.expenses for all using (private.is_master()) with check (private.is_master());

-- Fotos de facturas: bucket privado, solo master
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gastos', 'gastos', false, 10485760, array['image/jpeg','image/png','image/webp','image/heic','application/pdf'])
on conflict (id) do nothing;
drop policy if exists "master maneja fotos de gastos" on storage.objects;
create policy "master maneja fotos de gastos" on storage.objects for all
  using (bucket_id = 'gastos' and private.is_master()) with check (bucket_id = 'gastos' and private.is_master());
