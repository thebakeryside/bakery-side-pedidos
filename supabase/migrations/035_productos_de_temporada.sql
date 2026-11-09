-- Productos de temporada (navideños): van primero en su categoría y con recuadro especial en la tienda
alter table public.products add column if not exists seasonal boolean not null default false;
comment on column public.products.seasonal is 'Producto de temporada (navideño): se muestra primero y con recuadro especial en la tienda';
update public.products set seasonal = true where name in ('Brownie Mint','Tres Leches de Rompope','Carlota de Mango','Christmas Cocoa (11oz)','Rompope (300 ml)');
