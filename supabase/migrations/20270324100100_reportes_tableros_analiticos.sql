-- F-REP-07 (MSF-265, spec 20261114-100000-analitica-avanzada-y-resumen-por-correo, RF-REP-07-6): los dos tableros
-- nuevos de la galería «Tableros analíticos» entran al catálogo de reportes embebidos y quedan asignados a TODAS las
-- organizaciones (las actuales y las que se creen después). El superadmin puede desasignarlos como cualquier reporte.
--
-- Esquema (Principio VII): `public.reportes` y sus tablas hermanas son plataforma (spec 007) y NO cambian de
-- estructura: esta migración agrega DATO (dos filas de catálogo) y tres funciones de disparador en `private`.
-- No crea ni altera tablas, columnas ni políticas: siguen vigentes las RLS de `reportes`, `reportes_organizaciones`
-- y `reportes_organizaciones_roles`.
--
-- Qué resuelve (mismo patrón que `20270219130300_reportes_service.sql`, F-SVC-23):
--   1. Las filas «Analítica · Ventas por tienda y categoría» (seccion `reportes`) y «Analítica · Margen real por
--      tienda, categoría y producto» (seccion `rentabilidad`: expone costo y margen). La sección es la que
--      `public.resolver_organizacion_reporte` exige para emitir el token de invitado.
--   2. Los roles por defecto (`administracion`, igual que los demás tableros de Ventas y Rentabilidad). El
--      `administrador` no se lista: tiene acceso incondicional.
--   3. Tres disparadores: asignar el tablero a las organizaciones al registrarse, asignar los tableros a una
--      organización nueva y propagar los roles por defecto que llegan después de la asignación (la herencia de la
--      spec 007 corre una sola vez, al insertarse la asignación). La marca de un tablero de esta galería es el
--      prefijo «Analítica · » del nombre del reporte.
--
-- Aislamiento: asignar un tablero a una organización NO le da datos de otra. El token de invitado lleva la cláusula
-- `rls` `organizacion_id = '<org>' AND empresa_id IN (…)` que arma `emitir-acceso-reporte` en el servidor, y las vistas
-- (`analitica.ventas_empresa_categoria`, `analitica.margen_real_categoria`) exponen ambas columnas.
--
-- `superset_dashboard_uuid`: al crearse la fila todavía no se conoce el UUID de embebido que genera Superset al
-- importar el tablero, así que nace con el slug y el importador (`infra/superset/importar-dashboards.mjs`) la ACTUALIZA
-- por nombre con el UUID real. La fila se crea solo si no hay otra con el mismo nombre (nunca duplica).
--
-- En un reset limpio las migraciones corren ANTES que el seed (todavía no hay `auth.users` y `reportes.creado_por` no
-- se puede cumplir): ahí las filas las crea el importador. Cuando ya hay un usuario (dev, staging, producción) la
-- migración deja las filas listas.
--
-- Idempotente: se puede volver a aplicar sin duplicar filas, asignaciones ni roles.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop trigger if exists reportes_tableros_analiticos_organizacion on public.organizaciones;
--   drop trigger if exists reportes_tableros_analiticos_roles on public.reportes_roles_default;
--   drop trigger if exists reportes_tableros_analiticos_asignar on public.reportes;
--   drop function if exists private.asignar_tableros_analiticos_organizacion();
--   drop function if exists private.sincronizar_roles_tablero_analitico();
--   drop function if exists private.asignar_tablero_analitico_organizaciones();
--   delete from public.reportes where nombre like 'Analítica · %';  -- arrastra asignaciones, roles y eventos (cascade)

-- ---------------------------------------------------------------------------
-- 1. Las filas del catálogo y 2. sus roles por defecto.
-- ---------------------------------------------------------------------------

insert into public.reportes (id, superset_dashboard_uuid, nombre, creado_por, seccion)
select v.id, v.slug, v.nombre, u.user_id, v.seccion
from (values
  ('f1e5c0de-0000-4000-8000-000000265001'::uuid, 'analitica-ventas-tienda-categoria',
   'Analítica · Ventas por tienda y categoría', 'reportes'),
  ('f1e5c0de-0000-4000-8000-000000265002'::uuid, 'analitica-margen-real',
   'Analítica · Margen real por tienda, categoría y producto', 'rentabilidad')
) as v(id, slug, nombre, seccion)
cross join (select id as user_id from auth.users order by created_at limit 1) u
where not exists (select 1 from public.reportes r where r.nombre = v.nombre)
on conflict do nothing;

insert into public.reportes_roles_default (reporte_id, rol_id)
select r.id, 'administracion'
from public.reportes r
where r.nombre like 'Analítica · %'
on conflict (reporte_id, rol_id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Disparadores.
-- ---------------------------------------------------------------------------

create or replace function private.asignar_tablero_analitico_organizaciones()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.nombre not like 'Analítica · %' then
    return new;
  end if;

  insert into public.reportes_organizaciones (reporte_id, organizacion_id, asignado_por)
  select new.id, o.id, new.creado_por
  from public.organizaciones o
  on conflict (reporte_id, organizacion_id) do nothing;

  return new;
end;
$$;

comment on function private.asignar_tablero_analitico_organizaciones() is
  'F-REP-07: al registrarse un tablero de la galería «Analítica · …» lo asigna a todas las organizaciones. El aislamiento NO depende de esta asignación: el token filtra por organizacion_id y empresa_id y resolver_organizacion_reporte exige la sección del tablero.';

create or replace function private.asignar_tableros_analiticos_organizacion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.reportes_organizaciones (reporte_id, organizacion_id, asignado_por)
  select r.id, new.id, r.creado_por
  from public.reportes r
  where r.nombre like 'Analítica · %'
  on conflict (reporte_id, organizacion_id) do nothing;

  return new;
end;
$$;

comment on function private.asignar_tableros_analiticos_organizacion() is
  'F-REP-07: una organización nueva recibe los tableros de la galería «Analítica · …» ya registrados.';

create or replace function private.sincronizar_roles_tablero_analitico()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select r.nombre from public.reportes r where r.id = new.reporte_id) not like 'Analítica · %' then
    return new;
  end if;

  insert into public.reportes_organizaciones_roles (reporte_id, organizacion_id, rol_id)
  select new.reporte_id, ro.organizacion_id, new.rol_id
  from public.reportes_organizaciones ro
  where ro.reporte_id = new.reporte_id
  on conflict (reporte_id, organizacion_id, rol_id) do nothing;

  return new;
end;
$$;

comment on function private.sincronizar_roles_tablero_analitico() is
  'F-REP-07: cuando se agrega un rol por defecto a un tablero «Analítica · …», lo propaga a las organizaciones ya asignadas (la herencia de la spec 007 corre una sola vez, al insertarse la asignación).';

drop trigger if exists reportes_tableros_analiticos_asignar on public.reportes;
create trigger reportes_tableros_analiticos_asignar
  after insert on public.reportes
  for each row execute function private.asignar_tablero_analitico_organizaciones();

drop trigger if exists reportes_tableros_analiticos_organizacion on public.organizaciones;
create trigger reportes_tableros_analiticos_organizacion
  after insert on public.organizaciones
  for each row execute function private.asignar_tableros_analiticos_organizacion();

drop trigger if exists reportes_tableros_analiticos_roles on public.reportes_roles_default;
create trigger reportes_tableros_analiticos_roles
  after insert on public.reportes_roles_default
  for each row execute function private.sincronizar_roles_tablero_analitico();

-- Una función de trigger solo se puede invocar como trigger y vive en `private` (no expuesto), pero se cierra el
-- EXECUTE igual para que ningún rol de la app pueda llamarla.
revoke execute on function private.asignar_tablero_analitico_organizaciones() from public, anon, authenticated;
revoke execute on function private.asignar_tableros_analiticos_organizacion() from public, anon, authenticated;
revoke execute on function private.sincronizar_roles_tablero_analitico() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Backfill (después de crear los disparadores): las filas del paso 1 y sus roles nacieron ANTES de los
-- disparadores y nadie los disparó. Idempotente.
-- ---------------------------------------------------------------------------

insert into public.reportes_organizaciones (reporte_id, organizacion_id, asignado_por)
select r.id, o.id, r.creado_por
from public.reportes r
cross join public.organizaciones o
where r.nombre like 'Analítica · %'
on conflict (reporte_id, organizacion_id) do nothing;

insert into public.reportes_organizaciones_roles (reporte_id, organizacion_id, rol_id)
select ro.reporte_id, ro.organizacion_id, d.rol_id
from public.reportes_organizaciones ro
join public.reportes r on r.id = ro.reporte_id and r.nombre like 'Analítica · %'
join public.reportes_roles_default d on d.reporte_id = ro.reporte_id
on conflict (reporte_id, organizacion_id, rol_id) do nothing;
