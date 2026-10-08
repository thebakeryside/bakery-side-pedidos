-- The Bakery Side: usuario master (bjcucalon@gmail.com)
-- Solo el master puede: archivar o eliminar motorizados, dar o quitar acceso a cocina,
-- eliminar productos y categorías, ver reportes y ajustar sellos.

alter table public.profiles add column if not exists is_master boolean not null default false;
update public.profiles p set is_master = true, role = 'admin'
  from auth.users u where u.id = p.user_id and lower(u.email) = 'bjcucalon@gmail.com';

create or replace function private.is_master() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where user_id = auth.uid() and is_master);
$$;
grant execute on function private.is_master() to anon, authenticated;

-- ===== Motorizados: archivar en lugar de borrar =====
alter table public.riders add column if not exists archived_at timestamptz;

-- Solo el master puede archivar o desarchivar
create or replace function private.guard_rider_archive() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  if new.archived_at is distinct from old.archived_at and not private.is_master() and auth.uid() is not null then
    raise exception 'Solo el master puede archivar motorizados';
  end if;
  if new.archived_at is not null then new.active := false; end if;
  return new;
end $$;
revoke execute on function private.guard_rider_archive() from public, anon, authenticated;
drop trigger if exists riders_guard_archive on public.riders;
create trigger riders_guard_archive before update on public.riders
  for each row execute function private.guard_rider_archive();

-- Un motorizado archivado no puede entrar a su panel
create or replace function private.my_rider_id() returns bigint
language sql stable security definer set search_path = public as $$
  select id from public.riders where user_id = auth.uid() and active and archived_at is null;
$$;

-- Cocina gestiona; solo el master elimina
drop policy if exists "admin gestiona motorizados" on public.riders;
create policy "admin crea motorizados" on public.riders for insert with check (private.is_admin());
create policy "admin edita motorizados" on public.riders for update using (private.is_admin()) with check (private.is_admin());
create policy "master elimina motorizados" on public.riders for delete using (private.is_master());

drop policy if exists "admin gestiona productos" on public.products;
create policy "admin crea productos" on public.products for insert with check (private.is_admin());
create policy "admin edita productos" on public.products for update using (private.is_admin()) with check (private.is_admin());
create policy "master elimina productos" on public.products for delete using (private.is_master());

drop policy if exists "admin gestiona categorías" on public.categories;
create policy "admin crea categorías" on public.categories for insert with check (private.is_admin());
create policy "admin edita categorías" on public.categories for update using (private.is_admin()) with check (private.is_admin());
create policy "master elimina categorías" on public.categories for delete using (private.is_master());

-- Eliminar del todo solo si nunca hizo una entrega
create or replace function public.master_delete_rider(p_rider bigint) returns text
language plpgsql security definer set search_path = public, private as $$
begin
  if not private.is_master() then raise exception 'Solo el master puede hacer esto'; end if;
  if exists(select 1 from public.orders where rider_id = p_rider) then
    update public.riders set archived_at = coalesce(archived_at, now()), active = false where id = p_rider;
    return 'archivado';
  end if;
  delete from public.riders where id = p_rider;
  return 'eliminado';
end $$;

-- ===== Accesos a cocina =====
create or replace function public.master_list_admins()
returns table(email text, registered boolean, is_master boolean)
language sql stable security definer set search_path = public, private as $$
  select a.email, u.id is not null, coalesce(p.is_master, false)
  from private.admin_emails a
  left join auth.users u on lower(u.email) = lower(a.email)
  left join public.profiles p on p.user_id = u.id
  where private.is_master()
  order by 3 desc, 1;
$$;

create or replace function public.master_add_admin(p_email text) returns void
language plpgsql security definer set search_path = public, private as $$
declare e text := lower(trim(p_email)); uid uuid;
begin
  if not private.is_master() then raise exception 'Solo el master puede hacer esto'; end if;
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Correo no válido'; end if;
  insert into private.admin_emails values (e) on conflict do nothing;
  select id into uid from auth.users where lower(email) = e;
  if uid is not null then
    insert into public.profiles(user_id, role) values (uid, 'admin') on conflict (user_id) do update set role = 'admin';
  end if;
end $$;

create or replace function public.master_remove_admin(p_email text) returns void
language plpgsql security definer set search_path = public, private as $$
declare e text := lower(trim(p_email));
begin
  if not private.is_master() then raise exception 'Solo el master puede hacer esto'; end if;
  if exists(select 1 from public.profiles p join auth.users u on u.id = p.user_id where lower(u.email) = e and p.is_master) then
    raise exception 'No puedes quitarle el acceso al master';
  end if;
  delete from private.admin_emails where lower(email) = e;
  -- si también es motorizado activo, conserva ese rol; si no, pierde el acceso
  update public.profiles p set role = case when exists(select 1 from public.riders r where r.user_id = p.user_id and r.archived_at is null) then 'rider' else 'admin' end
    from auth.users u where u.id = p.user_id and lower(u.email) = e;
  delete from public.profiles p using auth.users u
    where u.id = p.user_id and lower(u.email) = e and p.role = 'admin' and not p.is_master;
end $$;

-- ===== Clientes y sellos =====
create or replace function public.master_customers()
returns table(user_id uuid, full_name text, email text, phone text, stamps bigint, rewards bigint, orders bigint, spent numeric, created_at timestamptz)
language sql stable security definer set search_path = public, private as $$
  select c.user_id, c.full_name, c.email, c.phone,
    coalesce((select sum(delta) from public.stamp_ledger l where l.user_id = c.user_id), 0),
    (select count(*) from public.rewards r where r.user_id = c.user_id and r.status in ('disponible','reservado')),
    (select count(*) from public.orders o where o.user_id = c.user_id and o.payment_status = 'pagado'),
    coalesce((select sum(o.subtotal - o.discount) from public.orders o where o.user_id = c.user_id and o.payment_status = 'pagado'), 0),
    c.created_at
  from public.customers c
  where private.is_master()
  order by c.created_at desc;
$$;

create or replace function public.master_adjust_stamps(p_user uuid, p_delta int) returns bigint
language plpgsql security definer set search_path = public, private as $$
declare bal bigint;
begin
  if not private.is_master() then raise exception 'Solo el master puede hacer esto'; end if;
  if p_delta = 0 or abs(p_delta) > 8 then raise exception 'El ajuste debe ser entre -8 y 8 sellos'; end if;
  select coalesce(sum(delta), 0) into bal from public.stamp_ledger where user_id = p_user;
  if bal + p_delta < 0 then raise exception 'El cliente no tiene tantos sellos'; end if;
  perform private.grant_stamps(p_user, p_delta, 'ajuste', null);
  select coalesce(sum(delta), 0) into bal from public.stamp_ledger where user_id = p_user;
  return bal;
end $$;

-- Permisos de ejecución: solo usuarios con sesión (cada función revisa que sea el master)
revoke execute on function public.master_delete_rider(bigint) from public, anon;
revoke execute on function public.master_list_admins() from public, anon;
revoke execute on function public.master_add_admin(text) from public, anon;
revoke execute on function public.master_remove_admin(text) from public, anon;
revoke execute on function public.master_customers() from public, anon;
revoke execute on function public.master_adjust_stamps(uuid, int) from public, anon;
grant execute on function public.master_delete_rider(bigint), public.master_list_admins(), public.master_add_admin(text),
  public.master_remove_admin(text), public.master_customers(), public.master_adjust_stamps(uuid, int) to authenticated;
