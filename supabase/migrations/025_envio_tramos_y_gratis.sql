-- The Bakery Side: envío en dos tramos, envío gratis desde un monto y primer envío gratis con cuenta (20 oct 2026)
--
-- Envío = base (cubre los km incluidos)
--       + precio por km hasta fee_break_km
--       + precio por km lejano después de fee_break_km
--       redondeado hacia arriba a fee_round_to.
-- Envío gratis: pedidos desde free_ship_min en productos (0 = apagado), hasta free_ship_max_km;
--   más lejos el cliente paga solo la diferencia.
-- Primer envío gratis: clientes con cuenta y sin pedidos pagados, desde welcome_ship_min (0 = apagado).

alter table public.settings add column if not exists fee_break_km numeric(6,2) check (fee_break_km is null or fee_break_km >= 0);
alter table public.settings add column if not exists fee_per_km_far numeric(6,2) check (fee_per_km_far is null or fee_per_km_far >= 0);
alter table public.settings add column if not exists free_ship_min numeric(8,2) not null default 0 check (free_ship_min >= 0);
alter table public.settings add column if not exists free_ship_max_km numeric(6,2) not null default 10 check (free_ship_max_km >= 0);
alter table public.settings add column if not exists welcome_ship_min numeric(8,2) not null default 0 check (welcome_ship_min >= 0);

-- Lo que gana el motorizado (envío completo) aunque el cliente no lo pague, y por qué fue gratis
alter table public.orders add column if not exists rider_fee numeric(8,2);
alter table public.orders add column if not exists delivery_promo text;
update public.orders set rider_fee = delivery_fee where rider_fee is null;

-- Valores decididos el 20 oct: $2,00 hasta 4 km, +$0,25/km hasta 10 km, +$0,70/km después;
-- gratis desde $30 (hasta 10 km); primer pedido con cuenta gratis desde $12.
update public.settings set
  fee_base = 2.00, fee_included_km = 4, fee_per_km = 0.25,
  fee_break_km = 10, fee_per_km_far = 0.70,
  free_ship_min = 30, free_ship_max_km = 10, welcome_ship_min = 12,
  updated_at = now();

-- Solo el master cambia envíos (se suman los campos nuevos a la protección)
create or replace function private.guard_settings() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  if auth.uid() is null or private.is_master() then return new; end if;
  if (new.fee_base, new.fee_included_km, new.fee_per_km, new.fee_round_to, new.max_km, new.slot_minutes, new.slot_capacity,
      new.whatsapp_number, new.bank_info, new.kitchen_address, new.kitchen_lat, new.kitchen_lng, new.map_provider, new.route_factor,
      new.business_name, new.timezone, new.open_time, new.close_time, new.weekly_hours,
      new.eta_window_minutes, new.transfer_extra_minutes, new.open_lead_minutes, new.reward_max_value, new.next_day_only,
      new.fee_break_km, new.fee_per_km_far, new.free_ship_min, new.free_ship_max_km, new.welcome_ship_min)
     is distinct from
     (old.fee_base, old.fee_included_km, old.fee_per_km, old.fee_round_to, old.max_km, old.slot_minutes, old.slot_capacity,
      old.whatsapp_number, old.bank_info, old.kitchen_address, old.kitchen_lat, old.kitchen_lng, old.map_provider, old.route_factor,
      old.business_name, old.timezone, old.open_time, old.close_time, old.weekly_hours,
      old.eta_window_minutes, old.transfer_extra_minutes, old.open_lead_minutes, old.reward_max_value, old.next_day_only,
      old.fee_break_km, old.fee_per_km_far, old.free_ship_min, old.free_ship_max_km, old.welcome_ship_min) then
    raise exception 'Solo el master puede cambiar horarios, envíos, pagos y datos del negocio.';
  end if;
  return new;
end $$;
