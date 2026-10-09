-- The Bakery Side: quién firma la tarjeta de regalo ("de parte de")
alter table public.orders add column if not exists gift_from text check (char_length(gift_from) <= 80);
