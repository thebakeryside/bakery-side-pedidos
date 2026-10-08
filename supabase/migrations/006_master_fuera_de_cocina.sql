-- The Bakery Side: el master entra a cocina por ser master, sin estar en la lista de accesos de cocina
-- Pegar completo en Supabase → SQL Editor → New query → Run

create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where user_id = auth.uid() and (role = 'admin' or is_master));
$$;

delete from private.admin_emails where lower(email) = 'bjcucalon@gmail.com';
