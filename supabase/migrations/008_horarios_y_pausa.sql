-- The Bakery Side: horario por día de la semana, excepciones (feriados) y "más tiempo de entrega"
-- Pegar completo en Supabase → SQL Editor → New query → Run

-- Horario semanal: {"0": {"open":"09:00","close":"21:00"}, ...}; 0 = domingo; null = cerrado ese día
alter table public.settings
  add column if not exists weekly_hours jsonb,
  add column if not exists busy_until timestamptz,
  add column if not exists busy_extra_minutes int not null default 30 check (busy_extra_minutes between 0 and 120);

update public.settings
   set weekly_hours = (select jsonb_object_agg(d::text, jsonb_build_object('open', to_char(open_time, 'HH24:MI'), 'close', to_char(close_time, 'HH24:MI')))
                         from generate_series(0, 6) d)
 where weekly_hours is null;

-- Días especiales: cerrado o con otro horario
create table if not exists public.store_exceptions (
  day date primary key,
  closed boolean not null default true,
  open_time time,
  close_time time,
  note text check (char_length(note) <= 60),
  created_at timestamptz not null default now(),
  check (closed or (open_time is not null and close_time is not null and open_time < close_time))
);
alter table public.store_exceptions enable row level security;
drop policy if exists "excepciones visibles" on public.store_exceptions;
create policy "excepciones visibles" on public.store_exceptions for select using (true);
drop policy if exists "master crea excepciones" on public.store_exceptions;
create policy "master crea excepciones" on public.store_exceptions for insert with check (private.is_master());
drop policy if exists "master edita excepciones" on public.store_exceptions;
create policy "master edita excepciones" on public.store_exceptions for update using (private.is_master()) with check (private.is_master());
drop policy if exists "master borra excepciones" on public.store_exceptions;
create policy "master borra excepciones" on public.store_exceptions for delete using (private.is_master());
grant select on public.store_exceptions to anon, authenticated;
grant insert, update, delete on public.store_exceptions to authenticated;

-- Cocina solo puede abrir/cerrar la tienda y poner "más tiempo de entrega"; el horario lo define el master
create or replace function private.guard_settings() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  if auth.uid() is null or private.is_master() then return new; end if;
  if (new.fee_base, new.fee_included_km, new.fee_per_km, new.fee_round_to, new.max_km, new.slot_minutes, new.slot_capacity,
      new.whatsapp_number, new.bank_info, new.kitchen_address, new.kitchen_lat, new.kitchen_lng, new.map_provider, new.route_factor,
      new.business_name, new.timezone, new.open_time, new.close_time, new.weekly_hours)
     is distinct from
     (old.fee_base, old.fee_included_km, old.fee_per_km, old.fee_round_to, old.max_km, old.slot_minutes, old.slot_capacity,
      old.whatsapp_number, old.bank_info, old.kitchen_address, old.kitchen_lat, old.kitchen_lng, old.map_provider, old.route_factor,
      old.business_name, old.timezone, old.open_time, old.close_time, old.weekly_hours) then
    raise exception 'Solo el master puede cambiar horarios, envíos, pagos y datos del negocio.';
  end if;
  return new;
end $$;
revoke execute on function private.guard_settings() from public, anon, authenticated;
