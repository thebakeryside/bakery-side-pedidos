-- The Bakery Side: cuentas para "Transferencia directa" (sin cédula) + Banco de Machala
update public.settings set bank_info = '{"holder":"Boris Alejandro Cucalón Lucas","email":"thebakeryside@gmail.com","accounts":[{"bank":"Banco Amazonas","type":"Ahorros","number":"4502477868"},{"bank":"Banco de Machala","type":"Ahorros","number":"1130164958"},{"bank":"Banco del Pacífico","type":"Ahorros","number":"1039583082"},{"bank":"Banco Guayaquil","type":"Ahorros","number":"0021386159"},{"bank":"Banco Pichincha","type":"Ahorros","number":"2205811538"}]}',
  updated_at = now();
