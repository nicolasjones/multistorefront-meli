-- F-REP-04 (MSF-236, épica MSF-192, spec 20270201-100000-rentabilidad-real-y-reportes-de-ventas, FR-010, FR-011):
-- vista `analitica.consultas_producto_mas_consultado` (Productos más consultados por WhatsApp) para el
-- tablero de «Ventas · Reportes», y RPC `public.consultas_reportes_conteo` para su estado vacío.
--
-- Esquema (Principio VII), verificado objeto por objeto:
--   analitica.consultas_producto_mas_consultado  analitica (nueva)  vista de lectura, SIN tablas nuevas.
--   public.consultas_reportes_conteo             public (nueva)     RPC de la app (plataforma/superficie).
--   dominio.intereses_whatsapp                   dominio (existente, F-CON-02): solo se lee.
-- `analitica` no tiene tablas → `rls_en_toda_tabla` (public + dominio) sigue verde.
--
-- Aislamiento: la vista NO es `security_invoker`; no tiene acceso para `anon` ni `authenticated`. La lee
-- el rol de solo lectura `superset_analitica` y la separación por organización Y por empresa la fuerza la
-- cláusula `rls` del guest token: por eso cada fila expone `organizacion_id`, `empresa_id` y
-- `empresa_nombre`. NO expone costo ni margen (decisión 3 de la spec: solo cantidades).
--
-- Cálculo (FR-010): una fila por empresa × producto × fecha. `consultas` = cantidad de toques en
-- «Consultar por WhatsApp» (un registro de `dominio.intereses_whatsapp` = un toque). `fecha` es el día en
-- la zona de la organización (America/Argentina/Buenos_Aires, la misma con que la app calcula «hoy») para
-- que el filtro de rango de fechas coincida con lo que ve la gente. `ultima_consulta` = instante del último
-- toque de la fila; el tablero toma el máximo del período.
--
-- Rendimiento: `organizacion_id` y `empresa_id` son columnas del GROUP BY, así que los filtros de la
-- cláusula `rls` se empujan al escaneo de `intereses_whatsapp` (índices por organización y por empresa);
-- no se agrega el histórico entero para después descartar.
--
-- RPC de conteo: mismo patrón que `public.ventas_reportes_conteo` (F-VTA-22). `SECURITY DEFINER` con la
-- autorización adentro: exige lectura o edición en `reportes` (42501 si no) y cuenta solo toques de la
-- organización y de las empresas accesibles (`private.empresas_accesibles()`, las mismas que acotan el
-- token); `p_empresa_id` nunca amplía el alcance. Existe porque la tabla exige la sección `consultas` y el
-- reporte se rige por `reportes`; `anon` sin ejecución.
--
-- Migración aditiva. Reversión (migración posterior; las vistas no guardan datos):
--   drop function public.consultas_reportes_conteo(date, date, uuid);
--   drop view analitica.consultas_producto_mas_consultado;

create or replace view analitica.consultas_producto_mas_consultado as
select
  i.organizacion_id,
  i.empresa_id,
  e.nombre as empresa_nombre,
  i.producto_id,
  p.nombre as producto_nombre,
  p.sku,
  (i.created_at at time zone 'America/Argentina/Buenos_Aires')::date as fecha,
  count(*)::bigint as consultas,
  max(i.created_at) as ultima_consulta
from dominio.intereses_whatsapp i
join dominio.empresas e
  on e.id = i.empresa_id and e.organizacion_id = i.organizacion_id
join dominio.productos p
  on p.id = i.producto_id and p.organizacion_id = i.organizacion_id
group by
  i.organizacion_id, i.empresa_id, e.nombre, i.producto_id, p.nombre, p.sku,
  (i.created_at at time zone 'America/Argentina/Buenos_Aires')::date;

comment on view analitica.consultas_producto_mas_consultado is
  'F-REP-04: productos más consultados por WhatsApp. Una fila por empresa × producto × fecha: cantidad de toques en «Consultar por WhatsApp» y el instante del último. Sin costo ni margen. Contrato en specs/20270201-100000-rentabilidad-real-y-reportes-de-ventas/contracts/rentabilidad-real-y-reportes.md.';

revoke all on analitica.consultas_producto_mas_consultado from public, anon, authenticated;
grant select on analitica.consultas_producto_mas_consultado to superset_analitica;

create or replace function public.consultas_reportes_conteo(
  p_desde date,
  p_hasta date,
  p_empresa_id uuid default null
)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_conteo integer;
begin
  if v_organizacion is null or (select private.nivel_seccion('reportes')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver los reportes de ventas' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or p_desde > p_hasta then
    raise exception 'El rango de fechas no es válido' using errcode = '22023';
  end if;
  select count(*)::integer
    into v_conteo
    from dominio.intereses_whatsapp i
   where i.organizacion_id = v_organizacion
     and (i.created_at at time zone 'America/Argentina/Buenos_Aires')::date between p_desde and p_hasta
     and i.empresa_id = any (select private.empresas_accesibles())
     and (p_empresa_id is null or i.empresa_id = p_empresa_id);
  return coalesce(v_conteo, 0);
end;
$$;

comment on function public.consultas_reportes_conteo(date, date, uuid) is
  'F-REP-04: toques en «Consultar por WhatsApp» del período (mismo alcance de organización y empresas accesibles que el tablero). 42501 sin la sección reportes.';

revoke execute on function public.consultas_reportes_conteo(date, date, uuid) from public, anon;
grant execute on function public.consultas_reportes_conteo(date, date, uuid) to authenticated;
