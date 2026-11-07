-- The Bakery Side: grupos de opciones que aplican solo según otra elección del mismo producto.
-- only_if = ids de opciones que activan el grupo (vacío = siempre aplica).
-- Uso: en el Combo Antojo, el endulzante se pide solo si la bebida es Cold Brew, Hibiscus Tea o Pink Lemonade.
alter table public.product_option_groups add column if not exists only_if bigint[];

-- Endulzante en los combos que tienen grupo "Bebida": solo para las bebidas que ya llevan endulzante sueltas
insert into public.product_option_groups (product_id, group_id, only_if)
select pog.product_id, e.id,
       array(select c.id from public.option_choices c
             where c.group_id = b.id and c.active
               and exists (select 1 from public.products p join public.product_option_groups x on x.product_id = p.id and x.group_id = e.id
                           where p.name ilike c.name || '%'))
from public.product_option_groups pog
join public.option_groups b on b.id = pog.group_id and b.name = 'Bebida'
cross join (select id from public.option_groups where name = 'Endulzante') e
on conflict (product_id, group_id) do nothing;
