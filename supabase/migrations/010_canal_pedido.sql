-- The Bakery Side: de dónde vino cada pedido (tienda web o WhatsApp)
-- Pegar completo en Supabase → SQL Editor → New query → Run
alter table public.orders add column if not exists channel text not null default 'web' check (channel in ('web', 'whatsapp'));
