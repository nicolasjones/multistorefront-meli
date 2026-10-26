-- MSF-405 · F-STK-17 (épica MSF-368, FR-302): vista de lectura de los faltantes abiertos.
--
-- Esquema (Principio VII): vista de lectura en `public` (contrato de la pantalla, como `stock_estados`);
-- solo lee tablas de `dominio` y `public`, no crea datos. La tabla del aviso es dominio.faltantes_avisos.
--
-- Un faltante es una línea «A pedido» de una FACTURA CONFIRMADA cuya reserva
-- (`comprobante:<id>:linea:<orden>`) sigue activa. Sale sola al descontarse o liberarse la reserva: no hay
-- cierre manual. Solo tiendas con `ventas` en lectura/edición para quien consulta
-- (`private.nivel_ventas_en_empresa`) y con la sección Stock visible (la RLS de reservas la exige).
-- `security_invoker`: rige la RLS de quien consulta. `anon` sin acceso. `organizacion_id` se expone para
-- que `avisar_faltantes` filtre por organización cuando la lee como `security definer`.
--
-- Migración aditiva. Reversión (migración posterior): drop view public.faltantes_listado;

create view public.faltantes_listado
with (security_invoker = true) as
select
  l.id as linea_id,
  c.organizacion_id,
  c.empresa_id,
  e.nombre as empresa,
  c.cliente_id,
  cl.nombre as cliente,
  l.producto_id,
  p.nombre as producto,
  p.sku,
  l.cantidad as pedido,
  c.id as comprobante_id,
  c.numero as comprobante_numero,
  c.confirmado_en::date as desde,
  s.estado as estado_stock,
  s.disponible::integer as disponible,
  case when a.estado in ('pendiente', 'enviado') then 'avisado' else 'sin_avisar' end as aviso
from dominio.comprobantes_venta_lineas l
join dominio.comprobantes_venta c
  on c.id = l.comprobante_id and c.organizacion_id = l.organizacion_id
join dominio.reservas_stock r
  on r.organizacion_id = l.organizacion_id
 and r.referencia = 'comprobante:' || c.id || ':linea:' || l.orden
 and r.estado = 'activa'
join dominio.productos p on p.id = l.producto_id and p.organizacion_id = l.organizacion_id
join dominio.empresas e on e.id = c.empresa_id and e.organizacion_id = c.organizacion_id
join public.clientes cl on cl.id = c.cliente_id and cl.organizacion_id = c.organizacion_id
join public.stock_estados s on s.producto_id = l.producto_id and s.organizacion_id = l.organizacion_id
left join dominio.faltantes_avisos a on a.linea_id = l.id
where c.tipo = 'factura'
  and c.estado = 'confirmada'
  and l.a_pedido
  and (select private.nivel_ventas_en_empresa(c.empresa_id)) in ('lectura', 'edicion');

comment on view public.faltantes_listado is
  'F-STK-17: una fila por línea «A pedido» de factura confirmada con reserva activa (faltante abierto), con el estado de stock del producto y si ya se avisó. security_invoker; solo tiendas con ventas visible. anon sin acceso.';

revoke all on public.faltantes_listado from public, anon, authenticated;
grant select on public.faltantes_listado to authenticated;
