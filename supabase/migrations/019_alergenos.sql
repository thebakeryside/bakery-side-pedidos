-- The Bakery Side: alérgenos por producto (ya aplicado)
alter table public.products add column if not exists allergens text[] not null default '{}'
  check (allergens <@ array['gluten','lacteos','huevo','frutos_secos','mani','soya']::text[]);
