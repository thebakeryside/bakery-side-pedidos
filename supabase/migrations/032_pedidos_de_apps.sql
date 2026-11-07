-- Pedidos de apps (PedidosYa) con lo que se vendió en cada uno, sacados del Partner Portal. channel_product_map liga el nombre de la app con los productos de Costos (un combo = varias filas).
create table if not exists public.channel_orders (
  channel text not null, external_id text not null, placed_at timestamptz not null, status text, subtotal numeric(10,2), local_discount numeric(10,2) default 0,
  service_fee numeric(10,2), tax numeric(10,2), net numeric(10,2), payment text, created_at timestamptz default now(), updated_at timestamptz default now(),
  primary key (channel, external_id));
create table if not exists public.channel_order_items (
  id bigint generated always as identity primary key, channel text not null default 'pedidosya', external_id text not null, qty int not null, name text not null, amount numeric(10,2) not null,
  foreign key (channel, external_id) references public.channel_orders(channel, external_id) on delete cascade);
create table if not exists public.channel_product_map (
  channel text not null, app_name text not null, product_id bigint not null references public.products(id), factor numeric not null default 1, primary key (channel, app_name, product_id));
alter table public.channel_orders enable row level security; alter table public.channel_order_items enable row level security; alter table public.channel_product_map enable row level security;
create policy "master pedidos apps" on public.channel_orders for all using (private.is_master()) with check (private.is_master());
create policy "master items apps" on public.channel_order_items for all using (private.is_master()) with check (private.is_master());
create policy "master mapa apps" on public.channel_product_map for all using (private.is_master()) with check (private.is_master());
