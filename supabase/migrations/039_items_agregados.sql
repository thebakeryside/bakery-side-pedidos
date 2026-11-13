-- Productos agregados a un pedido ya hecho (Cocina → Editar pedido): se marcan con la hora en que se agregaron.
-- Los del pedido original se guardan en el mismo momento en que se crea el pedido, así que quedan sin marca.
alter table public.order_items add column if not exists added_at timestamptz;

create or replace function private.mark_added_item()
 returns trigger language plpgsql security definer set search_path to 'public'
as $$
begin
  if new.added_at is null and exists(select 1 from public.orders where id = new.order_id and created_at < now() - interval '2 minutes') then
    new.added_at := now();
  end if;
  return new;
end $$;

drop trigger if exists order_items_added on public.order_items;
create trigger order_items_added before insert on public.order_items for each row execute function private.mark_added_item();
