-- Decisión de Nicolás sobre la Decisión abierta 3 de MSF-140 (spec 20270201-100000-reportes-de-inventario-y-exportacion):
-- el rol Consulta (y cualquier rol sin la acción `ver_costos` en Stock) ve el reporte de inventario SOLO con
-- cantidades; costo y valor del inventario quedan para quien ya ve costos en el resto del producto.
--
-- Esquema (Principio VII): SIN tablas nuevas.
--   · `analitica` (solo vistas): vista nueva `inventario_productos_stock_cantidades`, SIN ninguna columna de costo ni
--     valor y sin leer `dominio.producto_costos`: lo que la vista no trae, el tablero no puede mostrarlo ni exportarlo.
--   · `public` (plataforma): columna `reportes.accion_requerida` (nullable) y helper `private.cumple_accion_reporte`.
--
-- Cómo funciona:
--   1. `reportes.accion_requerida` declara una acción de la matriz (p. ej. `ver_costos`) que, además de la sección,
--      el reporte exige para emitir el token y para aparecer en la lista del usuario. Se evalúa con
--      `private.puede_accion(seccion, accion)`: respeta la matriz por rol de cada organización. Falla cerrado: una
--      acción sin sección, o desconocida, no da acceso.
--   2. `resolver_organizacion_reporte` (misma firma) y `reportes_visibles_para_mi` (misma firma) aplican esa exigencia:
--      sin `ver_costos` no hay token (403 en `emitir-acceso-reporte`) ni el reporte con costos figura en la lista.
--   3. «Inventario · Productos y stock» queda con `accion_requerida = 'ver_costos'`; el tablero «Inventario · Productos y
--      stock (cantidades)» (sin exigencia extra, sección `stock`) lo registra el importador de dashboards.
--
-- Hasta que el importador registre el reporte de cantidades, un rol sin `ver_costos` ve el aviso de tablero «todavía no
-- disponible» (falla segura: nunca los costos).
--
-- Migración aditiva e idempotente. Reversión (migración posterior):
--   restaurar public.resolver_organizacion_reporte al cuerpo de 20261130100400_reportes_seccion.sql y
--   public.reportes_visibles_para_mi al de 20260909140000_analitica_embebida.sql;
--   drop function private.cumple_accion_reporte(uuid);
--   alter table public.reportes drop column accion_requerida;
--   drop view analitica.inventario_productos_stock_cantidades;

-- ---------------------------------------------------------------------------
-- 1. Columna: acción de la matriz que exige el reporte.
-- ---------------------------------------------------------------------------

alter table public.reportes
  add column if not exists accion_requerida text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.reportes'::regclass and conname = 'reportes_accion_requerida_check'
  ) then
    alter table public.reportes
      add constraint reportes_accion_requerida_check
      check (accion_requerida is null or btrim(accion_requerida) <> '');
  end if;
end
$$;

comment on column public.reportes.accion_requerida is
  'Acción de la matriz de permisos (p. ej. ver_costos) que el reporte exige, sobre su sección, para emitir el token y figurar en la lista. Nula = sin exigencia extra. Sin sección o con una acción desconocida no da acceso.';

-- ---------------------------------------------------------------------------
-- 2. Helper: ¿cumple quien llama la acción que exige el reporte?
-- ---------------------------------------------------------------------------

create or replace function private.cumple_accion_reporte(p_reporte_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select case
              when r.accion_requerida is null then true
              when r.seccion is null then false
              else coalesce(private.puede_accion(r.seccion, r.accion_requerida), false)
            end
       from public.reportes r
      where r.id = p_reporte_id),
    true
  );
$$;

comment on function private.cumple_accion_reporte(uuid) is
  'Verdadero si el reporte no exige una acción extra (reportes.accion_requerida) o quien llama la tiene sobre la sección del reporte. Falla cerrado: acción sin sección o desconocida = falso.';

revoke execute on function private.cumple_accion_reporte(uuid) from public, anon;
grant execute on function private.cumple_accion_reporte(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Emisión del token y lista de reportes visibles: aplican la exigencia.
-- ---------------------------------------------------------------------------

create or replace function public.resolver_organizacion_reporte(p_reporte_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.puede_ver_asignacion(p_reporte_id, private.organizacion_id())
      and exists (
        select 1 from public.reportes_organizaciones ro
         where ro.reporte_id = p_reporte_id and ro.organizacion_id = private.organizacion_id()
      )
      and coalesce(
        (select private.nivel_seccion(r.seccion) in ('lectura', 'edicion')
           from public.reportes r
          where r.id = p_reporte_id and r.seccion is not null),
        true
      )
      and private.cumple_accion_reporte(p_reporte_id)
      then private.organizacion_id()
    else null
  end;
$$;

comment on function public.resolver_organizacion_reporte(uuid) is
  'Contrato: specs/007-analitica-embebida/contracts/acceso-reporte.md. Resuelve la organización con la que emitir-acceso-reporte arma la cláusula rls del guest token; si el reporte declara una sección (reportes.seccion) exige lectura o edición en ella (F-REN-01) y, si declara una acción (reportes.accion_requerida, p. ej. ver_costos), también esa acción. Devuelve null si no hay acceso.';

revoke execute on function public.resolver_organizacion_reporte(uuid) from public, anon;
grant execute on function public.resolver_organizacion_reporte(uuid) to authenticated;

create or replace function public.reportes_visibles_para_mi()
returns table (id uuid, nombre text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.nombre
  from public.reportes r
  join public.reportes_organizaciones ro on ro.reporte_id = r.id
  where ro.organizacion_id = (select private.organizacion_id())
    and private.puede_ver_asignacion(ro.reporte_id, ro.organizacion_id)
    and private.cumple_accion_reporte(r.id);
$$;

comment on function public.reportes_visibles_para_mi() is
  'Usada por apps/web/src/hooks/useReportesAsignados.ts: los reportes asignados a la organización activa que el usuario puede abrir; no lista los que exigen una acción (reportes.accion_requerida, p. ej. ver_costos) que no tiene.';

revoke execute on function public.reportes_visibles_para_mi() from public, anon;
grant execute on function public.reportes_visibles_para_mi() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. El reporte con costos exige `ver_costos` (idempotente; el importador lo mantiene).
-- ---------------------------------------------------------------------------

update public.reportes
   set accion_requerida = 'ver_costos'
 where nombre = 'Inventario · Productos y stock'
   and seccion = 'stock'
   and accion_requerida is distinct from 'ver_costos';

-- ---------------------------------------------------------------------------
-- 5. Vista de solo cantidades para el tablero sin costos.
-- ---------------------------------------------------------------------------

create or replace view analitica.inventario_productos_stock_cantidades as
select
  p.organizacion_id,
  p.id as producto_id,
  p.nombre as producto_nombre,
  p.sku,
  c.nombre as categoria,
  e.cantidad,
  e.minimo,
  case
    when e.cantidad = 0 then 'sin_stock'
    when e.cantidad <= e.minimo then 'stock_bajo'
    else 'disponible'
  end as estado
from dominio.productos p
join dominio.existencias e
  on e.producto_id = p.id and e.organizacion_id = p.organizacion_id
left join dominio.categorias c
  on c.id = p.categoria_id and c.organizacion_id = p.organizacion_id
where p.activo;

comment on view analitica.inventario_productos_stock_cantidades is
  'Productos activos con cantidad, mínimo y estado (misma regla que public.stock_estados), SIN costo ni valor: para los roles sin la acción ver_costos. No lee dominio.producto_costos. Contrato en specs/20270201-100000-reportes-de-inventario-y-exportacion/contracts/analitica-inventario.md.';

revoke all on analitica.inventario_productos_stock_cantidades from public, anon, authenticated;
grant select on analitica.inventario_productos_stock_cantidades to superset_analitica;
