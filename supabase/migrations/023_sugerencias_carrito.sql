-- Sugerencias en el carrito ("¿Le sumas…?"): registro para aprender qué combinaciones funcionan.
-- La tienda solo puede insertar; leer es solo para master.
create table if not exists public.upsell_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  visitor text not null,                -- id anónimo del navegador
  action text not null check (action in ('shown', 'added')),
  suggested_id bigint not null references public.products(id) on delete cascade,
  rule text not null,                   -- por qué se sugirió (p. ej. 'sin_bebida')
  cart jsonb not null default '[]'      -- ids de productos en el carrito en ese momento
);
alter table public.upsell_events enable row level security;
create policy "tienda registra sugerencias" on public.upsell_events for insert to anon, authenticated
  with check (action in ('shown', 'added') and length(visitor) <= 64 and jsonb_array_length(cart) <= 60);
create policy "master lee sugerencias" on public.upsell_events for select using (private.is_master());
create index if not exists upsell_events_created on public.upsell_events (created_at desc);
