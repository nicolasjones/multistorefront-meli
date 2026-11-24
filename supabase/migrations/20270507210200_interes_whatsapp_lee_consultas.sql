-- MSF-993 (lote 38): el «Interés por WhatsApp» y «Productos más consultados» leen las CONSULTAS de origen WhatsApp.
-- Decisión tomada: sin tabla aparte. Cada toque en «Consultar por WhatsApp» de la ficha ya entra a la bandeja como
-- una consulta `origen = 'whatsapp'` con su producto (`publico.registrar_consulta_whatsapp` → `private.entregar_a_bandeja`);
-- `registrar_interes_whatsapp` es interna desde MSF-657 y NO carga `dominio.intereses_whatsapp`, así que las pantallas
-- que la leían quedaban vacías en producción.
--
-- Esquema (Principio VII): sin tablas ni columnas nuevas. Se redefinen TRES objetos de lectura sobre `dominio.consultas`
-- (con las MISMAS columnas, tipos y nombres que la definición vigente: los consumidores no cambian) y se agrega un índice
-- parcial para el agrupado. `dominio.intereses_whatsapp` queda en la base SOLO para el sembrado demo hasta retirarla en
-- otro lote (ya nada de la app la lee).
--   · public.interes_whatsapp_por_producto (vista, security_invoker): parte de 20261214100200. Rige la RLS de
--     `dominio.consultas` (organización de la sesión, empresa accesible y sección `consultas` ≥ lectura), de empresas y de
--     productos. anon sin acceso.
--   · analitica.consultas_producto_mas_consultado (vista de Superset, NO invoker, solo `superset_analitica`): parte de
--     20270202201003. La separación por organización y empresa la fuerza la cláusula `rls` del guest token.
--   · public.consultas_reportes_conteo (RPC definer): parte de 20270202201003. Misma autorización (sección `reportes`,
--     empresas accesibles); ahora cuenta consultas de origen WhatsApp con producto.
-- Cada fila cuenta una consulta: un visitante repetido dentro del límite anti-abuso (5 por hora) cuenta una vez por
-- envío aceptado; el reintento idempotente (misma clave de envío) no duplica.
--
-- Migración aditiva. Reversión (migración posterior): volver a crear las tres definiciones de 20261214100200 y
-- 20270202201003 (que leen `dominio.intereses_whatsapp`) y `drop index dominio.consultas_whatsapp_producto_idx`.

create index if not exists consultas_whatsapp_producto_idx
  on dominio.consultas (organizacion_id, empresa_id, producto_id, created_at)
  where origen = 'whatsapp' and producto_id is not null;

create or replace view public.interes_whatsapp_por_producto
with (security_invoker = true) as
select c.organizacion_id,
       c.empresa_id,
       e.nombre as empresa_nombre,
       c.producto_id,
       p.nombre as producto_nombre,
       p.sku,
       count(*)::bigint as total,
       max(c.created_at) as ultimo_interes_at
  from dominio.consultas c
  join dominio.empresas e on e.id = c.empresa_id and e.organizacion_id = c.organizacion_id
  join dominio.productos p on p.id = c.producto_id and p.organizacion_id = c.organizacion_id
 where c.origen = 'whatsapp' and c.producto_id is not null
 group by c.organizacion_id, c.empresa_id, e.nombre, c.producto_id, p.nombre, p.sku;

revoke all on public.interes_whatsapp_por_producto from public, anon, authenticated;
grant select on public.interes_whatsapp_por_producto to authenticated;

comment on view public.interes_whatsapp_por_producto is
  'F-CON-02: veces y último interés por WhatsApp por empresa y producto, contados sobre las consultas de origen WhatsApp (MSF-993). security_invoker: aplica la RLS de dominio.consultas (sección consultas ≥ lectura y empresa accesible). Contrato de lectura de F-REP-04.';

create or replace view analitica.consultas_producto_mas_consultado as
select
  c.organizacion_id,
  c.empresa_id,
  e.nombre as empresa_nombre,
  c.producto_id,
  p.nombre as producto_nombre,
  p.sku,
  (c.created_at at time zone 'America/Argentina/Buenos_Aires')::date as fecha,
  count(*)::bigint as consultas,
  max(c.created_at) as ultima_consulta
from dominio.consultas c
join dominio.empresas e
  on e.id = c.empresa_id and e.organizacion_id = c.organizacion_id
join dominio.productos p
  on p.id = c.producto_id and p.organizacion_id = c.organizacion_id
where c.origen = 'whatsapp' and c.producto_id is not null
group by
  c.organizacion_id, c.empresa_id, e.nombre, c.producto_id, p.nombre, p.sku,
  (c.created_at at time zone 'America/Argentina/Buenos_Aires')::date;

comment on view analitica.consultas_producto_mas_consultado is
  'F-REP-04: productos más consultados por WhatsApp. Una fila por empresa × producto × fecha: cantidad de consultas de origen WhatsApp (MSF-993) y el instante de la última. Sin costo ni margen.';

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
    from dominio.consultas c
   where c.organizacion_id = v_organizacion
     and c.origen = 'whatsapp' and c.producto_id is not null
     and (c.created_at at time zone 'America/Argentina/Buenos_Aires')::date between p_desde and p_hasta
     and c.empresa_id = any (select private.empresas_accesibles())
     and (p_empresa_id is null or c.empresa_id = p_empresa_id);
  return coalesce(v_conteo, 0);
end;
$$;

comment on function public.consultas_reportes_conteo(date, date, uuid) is
  'F-REP-04: consultas de origen WhatsApp del período (MSF-993), con el mismo alcance de organización y empresas accesibles que el tablero. 42501 sin la sección reportes.';

revoke execute on function public.consultas_reportes_conteo(date, date, uuid) from public, anon;
grant execute on function public.consultas_reportes_conteo(date, date, uuid) to authenticated;
