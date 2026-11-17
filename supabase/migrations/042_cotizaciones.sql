-- The Bakery Side: cotizaciones (Cocina → Cotizaciones, solo master)
-- Reglas de margen: meta 60 % para precios normales, piso 45 % que ningún descuento puede pasar.
-- Descuentos por cantidad en tramos; cada producto puede tener un tope propio (ej.: bebidas 10 %).

-- ===== Reglas (una sola fila, solo master) =====
create table if not exists public.quote_rules (
  id boolean primary key default true check (id),
  target_margin numeric(5,4) not null default 0.60 check (target_margin between 0 and 0.95),
  floor_margin numeric(5,4) not null default 0.45 check (floor_margin between 0 and 0.95),
  -- tramos: desde X unidades (de la misma categoría) → descuento
  tiers jsonb not null default '[{"min":12,"disc":0.05},{"min":24,"disc":0.10},{"min":50,"disc":0.15},{"min":100,"disc":0.20}]',
  round_to numeric(6,2) not null default 0.05 check (round_to > 0),
  packaging_cost numeric(6,2) not null default 0.43,   -- empaque por pedido (fundas, stickers, servilletas)
  valid_days int not null default 7 check (valid_days between 1 and 90),
  deposit_pct numeric(5,4) not null default 0.50 check (deposit_pct between 0 and 1),
  terms text not null default 'Precios válidos hasta la fecha indicada. Para reservar la fecha se pide el anticipo; el saldo se paga antes de la entrega. Pedidos con 48 horas de anticipación.',
  updated_at timestamptz not null default now()
);
insert into public.quote_rules (id) values (true) on conflict do nothing;
alter table public.quote_rules enable row level security;
drop policy if exists "solo master" on public.quote_rules;
create policy "solo master" on public.quote_rules for all using (private.is_master()) with check (private.is_master());

-- ===== Tope de descuento por producto (null = solo manda el piso de margen) =====
alter table public.products
  add column if not exists quote_max_disc numeric(5,4) check (quote_max_disc is null or quote_max_disc between 0 and 0.9);
comment on column public.products.quote_max_disc is 'Cotizaciones: descuento máximo por cantidad para este producto (0,10 = 10 %). Null = el que permita el piso de margen.';
-- Bebidas: como mucho 10 % (el piso de margen igual puede dejarlo más bajo)
update public.products p set quote_max_disc = 0.10
  from public.categories c where c.id = p.category_id and c.name ilike 'bebidas' and p.quote_max_disc is null;

-- ===== Cotizaciones =====
create sequence if not exists public.quotes_code_seq start 1001;
create table if not exists public.quotes (
  id bigserial primary key,
  code text not null unique default ('COT-' || nextval('public.quotes_code_seq')),
  public_token uuid not null unique default gen_random_uuid(),
  status text not null default 'borrador' check (status in ('borrador','enviada','aceptada','rechazada','vencida')),
  customer_name text,
  customer_phone text,
  customer_email text,
  event_date date,
  delivery text not null default 'por_definir' check (delivery in ('domicilio','retiro','por_definir')),
  delivery_address text,
  delivery_fee numeric(10,2) not null default 0,
  items jsonb not null default '[]',      -- líneas con precio y costo (el costo nunca sale en la página pública)
  notes text,                              -- para el cliente
  internal_notes text,                     -- solo para nosotros
  subtotal_list numeric(10,2) not null default 0,
  discount numeric(10,2) not null default 0,
  subtotal numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  cost_total numeric(10,2) not null default 0,
  deposit_pct numeric(5,4) not null default 0.50,
  valid_until date,
  terms text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);
alter table public.quotes enable row level security;
drop policy if exists "solo master" on public.quotes;
create policy "solo master" on public.quotes for all using (private.is_master()) with check (private.is_master());
grant usage on sequence public.quotes_code_seq to authenticated;

-- ===== Vista pública por enlace (/cotizacion?t=…): sin costos ni notas internas =====
create or replace function public.quote_public(t uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'code', q.code, 'status', q.status, 'customer_name', q.customer_name, 'event_date', q.event_date,
    'delivery', q.delivery, 'delivery_fee', q.delivery_fee,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'name', i->>'name', 'detail', i->>'detail', 'qty', (i->>'qty')::numeric,
        'list_price', (i->>'list_price')::numeric, 'unit_price', (i->>'unit_price')::numeric,
        'line_total', (i->>'line_total')::numeric) order by ord)
      from jsonb_array_elements(q.items) with ordinality as x(i, ord)), '[]'::jsonb),
    'subtotal_list', q.subtotal_list, 'discount', q.discount, 'subtotal', q.subtotal, 'total', q.total,
    'deposit_pct', q.deposit_pct, 'valid_until', q.valid_until, 'notes', q.notes, 'terms', q.terms,
    'created_at', q.created_at,
    'whatsapp', s.whatsapp_number, 'bank_info', s.bank_info
  )
  from public.quotes q cross join public.settings s
  where q.public_token = t and q.status <> 'rechazada'
$$;
revoke all on function public.quote_public(uuid) from public;
grant execute on function public.quote_public(uuid) to anon, authenticated;
