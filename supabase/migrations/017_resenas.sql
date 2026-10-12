-- The Bakery Side: reseñas de productos
-- · Solo clientes con cuenta. "Compra comprobada" si tienen un pedido entregado con ese producto.
-- · Todas se revisan antes de publicarse (cocina o master).
-- · El promedio de estrellas cuenta solo las comprobadas y publicadas.
-- · Campaña: 1 sello por pedido cuando el cliente calificó TODOS los productos de ese pedido (y se publicaron).

alter table public.settings add column if not exists review_stamp boolean not null default true;

alter table public.stamp_ledger drop constraint if exists stamp_ledger_reason_check;
alter table public.stamp_ledger add constraint stamp_ledger_reason_check
  check (reason in ('bienvenida', 'referido_nuevo', 'referido_invita', 'pedido', 'premio', 'ajuste', 'resena'));

create table if not exists public.reviews (
  id bigint generated always as identity primary key,
  product_id bigint not null references public.products(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  author text not null default '',
  rating int not null check (rating between 1 and 5),
  comment text check (char_length(comment) <= 500),
  verified boolean not null default false,
  status text not null default 'pendiente' check (status in ('pendiente', 'publicada', 'oculta')),
  stamp_granted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz,
  unique (product_id, user_id)
);
create index if not exists reviews_product on public.reviews (product_id, status);
alter table public.reviews enable row level security;
revoke all on public.reviews from anon, authenticated;
grant select on public.reviews to authenticated;
drop policy if exists "reseñas publicadas o mías" on public.reviews;
create policy "mis reseñas o cocina" on public.reviews for select
  using (user_id = auth.uid() or private.is_admin() or private.is_master());

-- El cliente escribe o edita su reseña (al editarla vuelve a revisión)
create or replace function public.submit_review(p_product bigint, p_rating int, p_comment text)
returns text language plpgsql security definer set search_path = public, private as $$
declare uid uuid := auth.uid(); v boolean; nm text;
begin
  if uid is null then raise exception 'Inicia sesión para opinar'; end if;
  if p_rating not between 1 and 5 then raise exception 'Elige de 1 a 5 estrellas'; end if;
  select exists (select 1 from public.orders o join public.order_items i on i.order_id = o.id
                  where o.user_id = uid and o.status = 'entregado' and i.product_id = p_product) into v;
  select coalesce(nullif(split_part(full_name, ' ', 1), ''), 'Cliente') into nm from public.customers where user_id = uid;
  insert into public.reviews (product_id, user_id, author, rating, comment, verified, status, updated_at)
  values (p_product, uid, coalesce(nm, 'Cliente'), p_rating, nullif(left(trim(coalesce(p_comment, '')), 500), ''), v, 'pendiente', now())
  on conflict (product_id, user_id) do update
    set rating = excluded.rating, comment = excluded.comment, verified = excluded.verified,
        author = excluded.author, status = 'pendiente', updated_at = now();
  return case when v then 'comprobada' else 'sin_compra' end;
end $$;
revoke execute on function public.submit_review(bigint, int, text) from public, anon;
grant execute on function public.submit_review(bigint, int, text) to authenticated;

-- Sello por pedido calificado completo: se marca en el pedido para darlo una sola vez
alter table public.orders add column if not exists review_stamp_at timestamptz;

-- Da el sello a cada pedido entregado de ese cliente en el que ya calificó todos los productos
-- (reseñas publicadas y escritas después de la entrega, para que un pedido nuevo pida reseñas nuevas)
create or replace function private.review_stamps(p_user uuid) returns int
language plpgsql security definer set search_path = public, private as $$
declare o record; n int := 0; give boolean;
begin
  select review_stamp into give from public.settings limit 1;
  if not coalesce(give, false) then return 0; end if;
  for o in
    select ord.id from public.orders ord
     where ord.user_id = p_user and ord.status = 'entregado' and ord.review_stamp_at is null
       and not exists (
         select 1 from public.order_items i
          where i.order_id = ord.id and i.line_total > 0
            and not exists (select 1 from public.reviews r
                             where r.user_id = p_user and r.product_id = i.product_id and r.status = 'publicada'
                               and r.updated_at >= coalesce(ord.delivered_at, ord.created_at)))
       and exists (select 1 from public.order_items i where i.order_id = ord.id and i.line_total > 0)
  loop
    perform private.grant_stamps(p_user, 1, 'resena', o.id);
    update public.orders set review_stamp_at = now() where id = o.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function private.review_stamps(uuid) from public, anon, authenticated;

-- Cocina o master aprueba u oculta; al publicar revisa si algún pedido quedó calificado completo
drop function if exists public.moderate_review(bigint, text);
create or replace function public.moderate_review(p_id bigint, p_status text)
returns int language plpgsql security definer set search_path = public, private as $$
declare r public.reviews;
begin
  if not (private.is_admin() or private.is_master()) then raise exception 'Sin permiso'; end if;
  if p_status not in ('publicada', 'oculta') then raise exception 'Estado no válido'; end if;
  update public.reviews set status = p_status, approved_at = case when p_status = 'publicada' then now() else approved_at end
   where id = p_id returning * into r;
  if r.id is null then raise exception 'Reseña no encontrada'; end if;
  if p_status = 'publicada' then return private.review_stamps(r.user_id); end if;
  return 0;
end $$;
revoke execute on function public.moderate_review(bigint, text) from public, anon;
grant execute on function public.moderate_review(bigint, text) to authenticated;

-- Estrellas por producto: solo reseñas comprobadas y publicadas
create or replace function public.product_ratings()
returns table(product_id bigint, avg_rating numeric, n int, total int)
language sql stable security definer set search_path = public as $$
  select product_id,
         round(avg(rating) filter (where verified), 1),
         (count(*) filter (where verified))::int,
         count(*)::int
  from public.reviews where status = 'publicada' group by product_id;
$$;
grant execute on function public.product_ratings() to anon, authenticated;

-- Reseñas publicadas de un producto (para la tienda; primero las comprobadas)
create or replace function public.product_reviews(p_product bigint)
returns table(author text, rating int, comment text, verified boolean, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select author, rating, comment, verified, coalesce(approved_at, created_at)
  from public.reviews where product_id = p_product and status = 'publicada'
  order by verified desc, coalesce(approved_at, created_at) desc limit 50;
$$;
grant execute on function public.product_reviews(bigint) to anon, authenticated;
