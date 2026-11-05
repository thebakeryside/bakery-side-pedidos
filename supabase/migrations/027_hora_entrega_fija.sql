-- La hora de entrega que pidió el cliente (eta) no cambia después de crear el pedido.
-- Protege aunque una pantalla de cocina tenga una versión vieja guardada.
create or replace function private.keep_eta()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.eta is not null and new.eta is distinct from old.eta then
    new.eta := old.eta;
  end if;
  return new;
end $$;

drop trigger if exists orders_keep_eta on public.orders;
create trigger orders_keep_eta before update of eta on public.orders
for each row execute function private.keep_eta();
