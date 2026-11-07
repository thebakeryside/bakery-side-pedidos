-- Detalle de cada factura semanal según Partner Portal → Finanzas → Pagos, y estado del pago.
alter table public.channel_settlements
  add column if not exists invoice_no text,
  add column if not exists status text not null default 'pendiente' check (status in ('pendiente','pagado')),
  add column if not exists paid_on date,
  add column if not exists net_sales numeric(10,2),          -- Ventas netas
  add column if not exists extra_income numeric(10,2),       -- Ingresos adicionales
  add column if not exists app_discounts_paid numeric(10,2); -- Descuentos de PedidosYa a cobrar (te los reembolsa)
