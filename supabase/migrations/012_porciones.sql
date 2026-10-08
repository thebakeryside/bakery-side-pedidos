-- The Bakery Side: porciones recomendadas como dato aparte (ya aplicado el 8 de octubre)
alter table public.products add column if not exists servings text check (servings is null or char_length(servings) <= 30);
update public.products
   set servings = substring(description from '^(\d+\s*a\s*\d+\s*porciones)'),
       description = btrim(regexp_replace(description, '^\d+\s*a\s*\d+\s*porciones\.?\s*', ''))
 where description ~ '^\d+\s*a\s*\d+\s*porciones';
