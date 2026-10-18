-- The Bakery Side: fechas especiales del cliente (cumpleaños de mamá, aniversario…)
-- Unos días antes le llega un correo para enviar un detalle de regalo.
create table if not exists public.customer_dates (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 60),
  kind text not null default 'cumple' check (kind in ('cumple', 'aniversario', 'otro')),
  month int not null check (month between 1 and 12),
  day int not null check (day between 1 and 31),
  last_reminded_year int,
  created_at timestamptz not null default now()
);
create index if not exists customer_dates_md on public.customer_dates (month, day);
alter table public.customer_dates enable row level security;
create policy "cada cliente ve sus fechas" on public.customer_dates
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Máximo 20 fechas por cliente
create or replace function private.dates_limit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.customer_dates where user_id = new.user_id) >= 20 then
    raise exception 'Puedes guardar hasta 20 fechas.';
  end if;
  return new;
end $$;
create trigger customer_dates_limit before insert on public.customer_dates for each row execute function private.dates_limit();

-- Todos los días a las 9h00 de Guayaquil (14h00 UTC) se envían los recordatorios
create extension if not exists pg_cron;
create or replace function private.send_date_reminders() returns void language plpgsql security definer set search_path = public, extensions as $$
declare sec text;
begin
  select value into sec from public.app_secrets where key = 'push_hook';
  if sec is null then return; end if;
  perform net.http_post(
    url := 'https://btwuncihlkecnkjrgfhz.supabase.co/functions/v1/push',
    body := jsonb_build_object('action', 'recordatorios'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', sec)
  );
end $$;
select cron.schedule('recordatorios-fechas', '0 14 * * *', $$select private.send_date_reminders()$$);
