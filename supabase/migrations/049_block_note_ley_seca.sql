-- Producto visible en la tienda pero sin poder pedirse, con el motivo en la tarjeta (ej.: ley seca)
alter table products add column if not exists block_note text;
