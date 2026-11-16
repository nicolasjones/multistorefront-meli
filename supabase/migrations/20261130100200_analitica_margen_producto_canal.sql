-- F-REN-01 (MSF-204, épica MSF-120): esquema `analitica` y vista `analitica.margen_producto_canal`.
-- Esquema (Principio VII): `analitica` es un esquema NUEVO, SOLO de vistas y funciones de apoyo —
-- no almacena datos, así que no tiene tablas ni RLS. Es el contrato de lectura para Superset y para
-- otras épicas (ver specs/20261023-170000-rentabilidad-margen/contracts/analitica-margen.md).
--
-- Aislamiento: la vista NO es para `anon` ni `authenticated` (sin USAGE en el esquema, sin SELECT).
-- La lee un rol de solo lectura de Superset (migración siguiente) y la separación por organización
-- la fuerza la cláusula `rls` del guest token (`organizacion_id = '<org>'`); por eso cada fila lleva
-- `organizacion_id`. La vista corre con los privilegios de su dueño (no `security_invoker`): el rol
-- de Superset no tiene `auth.uid()` ni sección de permisos, y `precios_empresa_neto` exige ambos.
--
-- Cálculo (una sola fuente, sin duplicar fórmulas): el neto sale de `private.precio_neto_empresa`
-- (misma regla que `public.precios_empresa_neto`) y el costo de `private.a_pesos` (misma cotización
-- vigente que el precio). Esas funciones son `security invoker`; las envuelven dos funciones
-- SECURITY DEFINER de `analitica` para que el rol de Superset no necesite tocar `private` ni las
-- tablas de cotización.
--
-- Filas: un producto ACTIVO × una empresa ACTIVA con costo cargado, neto positivo y, si el importe es
-- en USD, cotización. Sin alguno de esos datos no hay fila (no se inventa un margen).
--
-- Migración aditiva. Reversión (migración posterior; nada guarda datos):
--   drop view analitica.margen_producto_canal;
--   drop function analitica.a_pesos(numeric, text, uuid);
--   drop function analitica.neto_empresa(uuid, uuid);
--   drop schema analitica;  -- solo si ya no cuelgan más vistas (resumen y consolidado de F-REN-02)

create schema analitica;

comment on schema analitica is
  'Contrato de lectura para Superset y otras épicas (F-REN-01). Solo vistas y funciones de apoyo; sin tablas. Sin acceso para anon ni authenticated.';

revoke all on schema analitica from public, anon, authenticated;

create or replace function analitica.a_pesos(p_importe numeric, p_moneda text, p_organizacion uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select private.a_pesos(p_importe, p_moneda, p_organizacion);
$$;

comment on function analitica.a_pesos(numeric, text, uuid) is
  'F-REN-01: envoltorio SECURITY DEFINER de private.a_pesos para el rol de Superset (misma cotización vigente que el precio).';

create or replace function analitica.neto_empresa(p_producto uuid, p_empresa uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select private.precio_neto_empresa(p_producto, p_empresa);
$$;

comment on function analitica.neto_empresa(uuid, uuid) is
  'F-REN-01: envoltorio SECURITY DEFINER de private.precio_neto_empresa (neto sin IVA, en pesos) para el rol de Superset.';

revoke execute on function analitica.a_pesos(numeric, text, uuid) from public, anon, authenticated;
revoke execute on function analitica.neto_empresa(uuid, uuid) from public, anon, authenticated;

create or replace view analitica.margen_producto_canal as
select
  p.organizacion_id,
  e.id as empresa_id,
  e.nombre as empresa_nombre,
  p.id as producto_id,
  p.nombre as producto_nombre,
  p.sku,
  x.precio_neto,
  x.costo,
  0::numeric as comision,
  x.precio_neto - x.costo as margen,
  (x.precio_neto - x.costo) / x.precio_neto as margen_pct,
  case
    when (x.precio_neto - x.costo) / x.precio_neto < 0 then 'negativo'
    when (x.precio_neto - x.costo) / x.precio_neto < coalesce(c.umbral_margen_bajo, 0.10) then 'bajo'
    else 'ok'
  end as estado
from dominio.productos p
join dominio.empresas e on e.organizacion_id = p.organizacion_id
join dominio.producto_costos k on k.producto_id = p.id and k.organizacion_id = p.organizacion_id
left join dominio.rentabilidad_config c on c.organizacion_id = p.organizacion_id
cross join lateral (
  select
    analitica.neto_empresa(p.id, e.id) as precio_neto,
    analitica.a_pesos(k.costo, p.moneda, p.organizacion_id) as costo
) x
where p.activo
  and e.activa
  and x.precio_neto > 0
  and x.costo is not null;

comment on view analitica.margen_producto_canal is
  'F-REN-01: margen por producto y tienda sobre el neto sin IVA (margen = neto − costo − comisión; comisión 0). Sin fila si falta costo, neto positivo o cotización. Contrato en specs/20261023-170000-rentabilidad-margen/contracts/analitica-margen.md.';

revoke all on analitica.margen_producto_canal from public, anon, authenticated;
