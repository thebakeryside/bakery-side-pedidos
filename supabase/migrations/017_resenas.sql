-- The Bakery Side: reseñas de productos
-- · Solo clientes con cuenta. "Compra comprobada" si tienen un pedido entregado con ese producto.
-- · Todas se revisan antes de publicarse (cocina o master).
-- · El promedio de estrellas cuenta solo las comprobadas y publicadas.
-- · Campaña: 1 sello por reseña comprobada (una por producto), al aprobarla.

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

-- Cocina o master aprueba u oculta; al aprobar una comprobada se da el sello (una vez)
create or replace function public.moderate_review(p_id bigint, p_status text)
returns void language plpgsql security definer set search_path = public, private as $$
declare r public.reviews; give boolean;
begin
  if not (private.is_admin() or private.is_master()) then raise exception 'Sin permiso'; end if;
  if p_status not in ('publicada', 'oculta') then raise exception 'Estado no válido'; end if;
  update public.reviews set status = p_status, approved_at = case when p_status = 'publicada' then now() else approved_at end
   where id = p_id returning * into r;
  if r.id is null then raise exception 'Reseña no encontrada'; end if;
  select review_stamp into give from public.settings limit 1;
  if p_status = 'publicada' and r.verified and not r.stamp_granted and coalesce(give, false) then
    perform private.grant_stamps(r.user_id, 1, 'resena', null);
    update public.reviews set stamp_granted = true where id = r.id;
  end if;
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
