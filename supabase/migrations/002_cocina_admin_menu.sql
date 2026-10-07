-- The Bakery Side: ubicación de la cocina, acceso de administradora y menú inicial
-- Pegar completo en Supabase → SQL Editor → New query → Run

update public.settings set
  kitchen_address = '2º Cj. 2B SO 6317, Guayaquil 090615',
  kitchen_lat = -2.1860461,
  kitchen_lng = -79.9149656;

create table if not exists private.admin_emails (email text primary key);
insert into private.admin_emails values ('bjcucalon@gmail.com') on conflict do nothing;

create or replace function private.assign_role_on_signup() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  if exists (select 1 from private.admin_emails where lower(email) = lower(new.email)) then
    insert into public.profiles(user_id, role, full_name)
    values (new.id, 'admin', coalesce(new.raw_user_meta_data->>'full_name',''))
    on conflict (user_id) do update set role = 'admin';
  end if;
  return new;
end $$;
revoke execute on function private.assign_role_on_signup() from public, anon, authenticated;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.assign_role_on_signup();

with c as (
  insert into public.categories(name, sort) values ('Postres', 1), ('Bebidas', 2) returning id, name
)
insert into public.products(category_id, name, description, price, prep_minutes, lead_hours, sort)
select c.id, p.name, p.description, 4.00, 10, 0, p.sort
from c join (values
  ('Postres', 'Caramel Brownie',     'Lata A8 de 250 ml con tapa desprendible.', 1),
  ('Postres', 'Alfajor de Nutella',  'Lata A8 de 250 ml con tapa desprendible.', 2),
  ('Postres', 'Volteado de Piña',    'Bizcocho dorado coronado con piña caramelizada y cereza. Lata A8 de 250 ml con tapa desprendible.', 3),
  ('Bebidas', 'Pink Lemonade',       'Lata A9 de 330 ml con tapa de fácil apertura.', 1),
  ('Bebidas', 'Cold Brew',           'Lata A9 de 330 ml con tapa de fácil apertura.', 2),
  ('Bebidas', 'Hibiscus Tea',        'Lata A9 de 330 ml con tapa de fácil apertura.', 3),
  ('Bebidas', 'Coconut Water',       'Lata A9 de 330 ml con tapa de fácil apertura.', 4)
) as p(cat, name, description, sort) on p.cat = c.name;
