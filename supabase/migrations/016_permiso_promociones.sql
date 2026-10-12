-- The Bakery Side: permiso del cliente para recibir promociones (Ley Orgánica de Protección de Datos Personales)
alter table public.customers add column if not exists marketing_opt_in boolean not null default false;
alter table public.customers add column if not exists marketing_opt_in_at timestamptz;
create or replace function public.set_marketing(p_opt boolean) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Inicia sesión'; end if;
  update public.customers set marketing_opt_in = p_opt, marketing_opt_in_at = case when p_opt then now() else null end
   where user_id = auth.uid();
  return p_opt;
end $$;
revoke execute on function public.set_marketing(boolean) from public, anon;
grant execute on function public.set_marketing(boolean) to authenticated;
