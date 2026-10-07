# The Bakery Side · Pedidos

Sistema propio de pedidos a domicilio, sin comisiones de apps de delivery.

| Página | Para quién | Qué hace |
| --- | --- | --- |
| `/` | Clientes | Menú, carrito, ubicación en el mapa, envío calculado, agenda y pago |
| `/pedido?t=…` | Clientes | Seguimiento del pedido |
| `/pago` | Clientes | Página de regreso de Payphone; confirma el pago |
| `/cocina` | Dueños | Pedidos en tiempo real, transferencias, motorizados, menú y ajustes |
| `/moto` | Motorizados | Sus entregas, ruta en Maps/Waze y botones de recogido/entregado |

## Partes

- **`public/`**: el sitio web estático, publicado en Cloudflare Pages (directorio de salida `public`, sin comando de compilación).
- **`supabase/functions/api/`**: la función del servidor (Supabase Edge Function `api`). Calcula precios, envío y horarios del lado del servidor, crea pedidos y confirma pagos con Payphone.
- **`supabase/migrations/`**: cambios a la base de datos. El esquema inicial (tablas, permisos y la función `track_order`) se aplicó directamente en el proyecto `bakery-side-pedidos`.

## Secretos (Supabase → Edge Functions → Secrets)

| Nombre | Para qué |
| --- | --- |
| `PAYPHONE_TOKEN` | Token de la aplicación web en Payphone Developer |
| `PAYPHONE_STORE_ID` | Store ID de la tienda en Payphone |
| `GOOGLE_MAPS_SERVER_KEY` | Opcional. Distancia por calles con Google Routes; si falta se usa línea recta × 1,4 |

Nunca se guardan claves en este repositorio. La clave publicable de Supabase en `public/assets/config.js` está hecha para ir en el navegador.

## Envío

`envío = máx(base, base + precio_km × (km − km_incluidos))`, redondeado hacia arriba a $0,25. Los valores se editan en `/cocina` → Ajustes.
