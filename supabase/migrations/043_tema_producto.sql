-- Tema visual por producto en la tienda (ej.: 'azul' para el Día del Hombre).
-- null = normal; los navideños siguen usando products.seasonal (rojo).
alter table public.products add column if not exists theme text;
comment on column public.products.theme is 'Tema de la tarjeta en la tienda: null (normal) o ''azul'' (Día del Hombre). Recuadro, nombre y franja a rayas en ese color.';
