-- Primer envío gratis con su propio tope de km (vacío = el mismo de "Gratis hasta (km)").
-- Desde el 1 dic 2026: primer envío gratis desde $15 y hasta 8 km; el de $30 sigue hasta 10 km.
alter table public.settings add column if not exists welcome_ship_max_km numeric(6,2) check (welcome_ship_max_km is null or welcome_ship_max_km >= 0);

create or replace function private.guard_settings() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  if auth.uid() is null or private.is_master() then return new; end if;
  if (new.fee_base, new.fee_included_km, new.fee_per_km, new.fee_round_to, new.max_km, new.slot_minutes, new.slot_capacity,
      new.whatsapp_number, new.bank_info, new.kitchen_address, new.kitchen_lat, new.kitchen_lng, new.map_provider, new.route_factor,
      new.business_name, new.timezone, new.open_time, new.close_time, new.weekly_hours,
      new.eta_window_minutes, new.transfer_extra_minutes, new.open_lead_minutes, new.reward_max_value, new.next_day_only,
      new.fee_break_km, new.fee_per_km_far, new.free_ship_min, new.free_ship_max_km, new.welcome_ship_min, new.welcome_ship_max_km)
     is distinct from
     (old.fee_base, old.fee_included_km, old.fee_per_km, old.fee_round_to, old.max_km, old.slot_minutes, old.slot_capacity,
      old.whatsapp_number, old.bank_info, old.kitchen_address, old.kitchen_lat, old.kitchen_lng, old.map_provider, old.route_factor,
      old.business_name, old.timezone, old.open_time, old.close_time, old.weekly_hours,
      old.eta_window_minutes, old.transfer_extra_minutes, old.open_lead_minutes, old.reward_max_value, old.next_day_only,
      old.fee_break_km, old.fee_per_km_far, old.free_ship_min, old.free_ship_max_km, old.welcome_ship_min, old.welcome_ship_max_km) then
    raise exception 'Solo el master puede cambiar horarios, envíos, pagos y datos del negocio.';
  end if;
  return new;
end $$;
