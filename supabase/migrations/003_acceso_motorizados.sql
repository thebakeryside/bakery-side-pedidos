-- The Bakery Side: acceso de motorizados
-- Pegar completo en Supabase → SQL Editor → New query → Run

alter table public.riders add column if not exists email text unique;

-- Al registrarse: admin si su correo está autorizado; motorizado si cocina lo registró con ese correo
create or replace function private.assign_role_on_signup() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  if exists (select 1 from private.admin_emails where lower(email) = lower(new.email)) then
    insert into public.profiles(user_id, role, full_name)
    values (new.id, 'admin', coalesce(new.raw_user_meta_data->>'full_name',''))
    on conflict (user_id) do update set role = 'admin';
  elsif exists (select 1 from public.riders where lower(email) = lower(new.email)) then
    update public.riders set user_id = new.id where lower(email) = lower(new.email);
    insert into public.profiles(user_id, role) values (new.id, 'rider')
    on conflict (user_id) do nothing;
  end if;
  return new;
end $$;
revoke execute on function private.assign_role_on_signup() from public, anon, authenticated;

-- Si cocina registra a un motorizado cuyo correo ya tiene cuenta, se vincula de inmediato
create or replace function private.link_rider_user() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare uid uuid;
begin
  new.email := lower(trim(new.email));
  if new.email is not null and (tg_op = 'INSERT' or new.email is distinct from old.email) then
    select id into uid from auth.users where lower(email) = new.email;
    new.user_id := uid;
    if uid is not null then
      insert into public.profiles(user_id, role) values (uid, 'rider') on conflict (user_id) do nothing;
    end if;
  end if;
  return new;
end $$;
revoke execute on function private.link_rider_user() from public, anon, authenticated;
drop trigger if exists riders_link_user on public.riders;
create trigger riders_link_user before insert or update on public.riders
  for each row execute function private.link_rider_user();

-- Las fotos del menú son públicas
drop policy if exists "fotos públicas del menú" on storage.objects;
create policy "fotos públicas del menú" on storage.objects for select using (bucket_id = 'productos');
