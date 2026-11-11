-- F-IA-01 (MSF-411, épica MSF-233) · FR-021: las cuatro fuentes de consulta del asistente con IA.
-- Vistas de SOLO LECTURA `public.ia_consulta_catalogo / _stock / _precios / _ventas`, con `organizacion_id` y
-- `security_invoker = true`: el chat las lee con la sesión del usuario, así que rige la RLS de las tablas base
-- (organización y nivel de la sección: `productos`, `stock`, `ventas`); el servidor MCP arma el
-- `where organizacion_id = <sesión>` dentro de `private.mcp_leer_fila`. Columnas EXACTAS de
-- `specs/20270203-100000-api-e-asistente-con-ia/contracts/ia-consulta.md` (D-7): sin costos, márgenes, datos de
-- contacto de clientes ni precio final por empresa/IVA.
--
-- Esquema: solo vistas en `public` (superficie de lectura sin datos propios; Principio VII). `anon` sin acceso.
-- Migración aditiva. Reversión (migración posterior):
--   drop view public.ia_consulta_ventas, public.ia_consulta_precios, public.ia_consulta_stock, public.ia_consulta_catalogo;

-- Catálogo: producto, nombre, SKU, categoría (ruta «Padre > Hija» o nombre de la raíz) y estado.
create or replace view public.ia_consulta_catalogo
with (security_invoker = true) as
select
  p.organizacion_id,
  p.id as producto_id,
  p.nombre,
  p.sku,
  p.categoria_id,
  case when padre.id is not null then padre.nombre || ' > ' || c.nombre else c.nombre end as categoria,
  p.activo,
  p.updated_at as actualizado_en
from dominio.productos p
left join dominio.categorias c
  on c.id = p.categoria_id and c.organizacion_id = p.organizacion_id
left join dominio.categorias padre
  on padre.id = c.padre_id and padre.organizacion_id = c.organizacion_id;

-- Stock por depósito: cantidad, reservado y disponible (cantidad − reservado).
create or replace view public.ia_consulta_stock
with (security_invoker = true) as
select
  e.organizacion_id,
  e.producto_id,
  p.nombre,
  p.sku,
  e.deposito_id,
  d.nombre as deposito,
  e.cantidad,
  e.reservado,
  e.cantidad - e.reservado as disponible,
  e.updated_at as actualizado_en
from dominio.existencias_deposito e
join dominio.productos p
  on p.id = e.producto_id and p.organizacion_id = e.organizacion_id
join dominio.depositos d
  on d.id = e.deposito_id and d.organizacion_id = e.organizacion_id;

-- Precios: precio de lista neto central y escalas x5/x10/x50 (null = escala sin precio). Sin IVA ni precio por empresa.
create or replace view public.ia_consulta_precios
with (security_invoker = true) as
select
  p.organizacion_id,
  p.id as producto_id,
  p.nombre,
  p.sku,
  p.moneda,
  p.precio_lista,
  (select s.precio from dominio.producto_precios_escala s
    where s.producto_id = p.id and s.organizacion_id = p.organizacion_id and s.escala = 'x5') as precio_x5,
  (select s.precio from dominio.producto_precios_escala s
    where s.producto_id = p.id and s.organizacion_id = p.organizacion_id and s.escala = 'x10') as precio_x10,
  (select s.precio from dominio.producto_precios_escala s
    where s.producto_id = p.id and s.organizacion_id = p.organizacion_id and s.escala = 'x50') as precio_x50,
  greatest(
    p.updated_at,
    coalesce((select max(s.updated_at) from dominio.producto_precios_escala s
               where s.producto_id = p.id and s.organizacion_id = p.organizacion_id), p.updated_at)
  ) as actualizado_en
from dominio.productos p;

-- Ventas: solo facturas confirmadas (mismo criterio que la API pública). Sin cliente ni contacto.
create or replace view public.ia_consulta_ventas
with (security_invoker = true) as
select
  c.organizacion_id,
  c.id as comprobante_id,
  c.numero,
  c.fecha,
  c.empresa_id,
  c.total_sin_iva,
  c.total_con_iva,
  c.estado,
  c.confirmado_en
from dominio.comprobantes_venta c
where c.tipo = 'factura'
  and c.estado = 'confirmada';

comment on view public.ia_consulta_catalogo is 'F-IA-01: fuente de consulta del asistente (catálogo). Solo lectura; rige la RLS de la sesión.';
comment on view public.ia_consulta_stock is 'F-IA-01: fuente de consulta del asistente (stock por depósito). Solo lectura; rige la RLS de la sesión.';
comment on view public.ia_consulta_precios is 'F-IA-01: fuente de consulta del asistente (precio de lista y escalas, sin costos ni IVA). Solo lectura; rige la RLS de la sesión.';
comment on view public.ia_consulta_ventas is 'F-IA-01: fuente de consulta del asistente (facturas confirmadas, sin datos del cliente). Solo lectura; rige la RLS de la sesión.';

revoke all on public.ia_consulta_catalogo, public.ia_consulta_stock, public.ia_consulta_precios, public.ia_consulta_ventas
  from public, anon, authenticated;
grant select on public.ia_consulta_catalogo, public.ia_consulta_stock, public.ia_consulta_precios, public.ia_consulta_ventas
  to authenticated;
