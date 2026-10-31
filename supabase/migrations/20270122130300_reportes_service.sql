-- F-SVC-23 (MSF-168, épica MSF-124): reporte «Service técnico» en el catálogo de reportes embebidos
-- (FR-063, T044).
--
-- Esquema (Principio VII): `public.reportes` es plataforma (spec 007) y NO cambia de estructura: esta
-- migración solo agrega el DATO del reporte de Service (una fila) y su asignación a las organizaciones.
-- No crea ni altera tablas, columnas ni políticas: siguen vigentes las RLS de `reportes`,
-- `reportes_organizaciones` y `reportes_organizaciones_roles` de la spec 007.
--
-- Qué resuelve:
--   1. La fila del reporte «Service técnico» con `seccion = 'service_tecnico'`: la sección que
--      `public.resolver_organizacion_reporte` exige (20261130100400) para emitir el token de invitado,
--      igual que los tableros de Rentabilidad. Sin sección, la fila no exigiría `lectura` en Service.
--   2. Los roles por defecto del reporte (`administracion` y `consulta`, los mismos que declara
--      `infra/superset/dashboards/service/reportes.json`): son los que la asignación hereda al freezing
--      de la spec 007 (`reportes_organizaciones_heredar_roles`).
--   3. La asignación a las organizaciones, como la de Rentabilidad pero automática: el reporte se asigna a
--      las organizaciones que tienen el módulo `service-tecnico` habilitado (las mismas donde el menú y las
--      rutas del módulo existen). Si una organización habilita el módulo más adelante, también lo recibe.
--      El superadmin puede desasignarlo como con cualquier otro reporte.
--
-- Aislamiento: el token de invitado lleva la cláusula `rls` `organizacion_id = '<org>'`
-- (`emitir-acceso-reporte`), así que cada organización ve SOLO sus propias reparaciones. Asignar el
-- reporte a una organización NO le da datos de otra: las vistas `analitica.service_*` exponen
-- `organizacion_id` y el tablero filtra por él. Además `resolver_organizacion_reporte` exige `lectura`
-- o `edicion` en la sección `service_tecnico` (FR-065).
--
-- `superset_dashboard_uuid`: al crearse la fila todavía no se conoce el UUID de embebido que genera
-- Superset al importar el tablero (nace en `infra/superset/importar-dashboards.mjs`), así que la fila
-- nace con el slug del tablero y el importador la ACTUALIZA (por nombre) con el UUID real. Por eso la
-- fila se crea solo si no hay otra con el mismo nombre, y el importador nunca duplica.
--
-- Idempotente: se puede volver a aplicar sin duplicar fila, asignaciones ni roles.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop trigger if exists reportes_service_organizacion_feature on public.organizaciones_features;
--   drop function if exists private.asignar_reporte_service_organizacion();
--   drop trigger if exists reportes_service_roles_default on public.reportes_roles_default;
--   drop function if exists private.sincronizar_roles_reporte_service();
--   drop trigger if exists reportes_service_organizaciones on public.reportes;
--   drop function if exists private.asignar_reporte_service_organizaciones();
--   delete from public.reportes_organizaciones_roles where reporte_id in (select id from public.reportes where nombre = 'Service técnico');
--   delete from public.reportes_organizaciones where reporte_id in (select id from public.reportes where nombre = 'Service técnico');
--   delete from public.reportes_roles_default where reporte_id in (select id from public.reportes where nombre = 'Service técnico');
--   delete from public.reportes where nombre = 'Service técnico';

-- ---------------------------------------------------------------------------
-- 1. La fila del reporte.
--
-- En un reset limpio las migraciones corren ANTES que el seed, así que todavía no hay ningún
-- `auth.users` y `reportes.creado_por` (FK a `auth.users`) no se puede cumplir: ahí la fila la crea
-- el importador de dashboards, que sí conoce el UUID de embebido. Cuando ya hay un usuario (staging,
-- producción, un seed ya aplicado) la migración deja la fila lista y el importador la actualiza.
-- ---------------------------------------------------------------------------

insert into public.reportes (id, superset_dashboard_uuid, nombre, creado_por, seccion)
select
  'f1e5c0de-0000-4000-8000-000000005168'::uuid,
  'service-tecnico',
  'Service técnico',
  u.user_id,
  'service_tecnico'
from (select id as user_id from auth.users order by created_at limit 1) u
where not exists (select 1 from public.reportes where nombre = 'Service técnico')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. Roles por defecto: los mismos que declara el manifiesto del tablero
-- (`infra/superset/dashboards/service/reportes.json`).
-- ---------------------------------------------------------------------------

insert into public.reportes_roles_default (reporte_id, rol_id)
select r.id, d.rol_id
from public.reportes r
cross join (values ('administracion'), ('consulta')) as d(rol_id)
where r.nombre = 'Service técnico'
  and r.seccion = 'service_tecnico'
on conflict (reporte_id, rol_id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Triggers: el reporte queda asignado a las organizaciones que usan el módulo.
--
-- El trigger de herencia de la spec 007 (`reportes_organizaciones_heredar_roles`) corre una sola vez,
-- al insertarse la asignación: si los roles por defecto llegan después (el importador registra la
-- fila y después los roles), la herencia queda vacía. Por eso el trigger de abajo los sincroniza.
-- ---------------------------------------------------------------------------

create or replace function private.asignar_reporte_service_organizaciones()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.seccion is distinct from 'service_tecnico' then
    return new;
  end if;

  insert into public.reportes_organizaciones (reporte_id, organizacion_id, asignado_por)
  select new.id, o.id, new.creado_por
  from public.organizaciones o
  join public.organizaciones_features f on f.organizacion_id = o.id and f.feature_id = 'service-tecnico'
  on conflict (reporte_id, organizacion_id) do nothing;

  insert into public.reportes_organizaciones_roles (reporte_id, organizacion_id, rol_id)
  select new.id, o.id, d.rol_id
  from public.organizaciones o
  join public.organizaciones_features f on f.organizacion_id = o.id and f.feature_id = 'service-tecnico'
  cross join public.reportes_roles_default d
  where d.reporte_id = new.id
  on conflict (reporte_id, organizacion_id, rol_id) do nothing;

  return new;
end;
$$;

comment on function private.asignar_reporte_service_organizaciones() is
  'F-SVC-23: al registrarse el reporte «Service técnico» (seccion service_tecnico) lo asigna a las organizaciones que tienen el módulo service-tecnico habilitado. El aislamiento NO depende de esta asignación: el token filtra por organizacion_id y resolver_organizacion_reporte exige lectura o edicion en la sección.';

create or replace function private.asignar_reporte_service_organizacion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.feature_id is distinct from 'service-tecnico' then
    return new;
  end if;

  insert into public.reportes_organizaciones (reporte_id, organizacion_id, asignado_por)
  select r.id, new.organizacion_id, r.creado_por
  from public.reportes r
  where r.nombre = 'Service técnico'
    and r.seccion = 'service_tecnico'
  on conflict (reporte_id, organizacion_id) do nothing;

  return new;
end;
$$;

comment on function private.asignar_reporte_service_organizacion() is
  'F-SVC-23: cuando una organización habilita el módulo service-tecnico, recibe el reporte «Service técnico» (si el reporte ya está registrado).';

create or replace function private.sincronizar_roles_reporte_service()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select r.seccion from public.reportes r where r.id = new.reporte_id) is distinct from 'service_tecnico' then
    return new;
  end if;

  insert into public.reportes_organizaciones_roles (reporte_id, organizacion_id, rol_id)
  select new.reporte_id, ro.organizacion_id, d.rol_id
  from public.reportes_organizaciones ro
  cross join public.reportes_roles_default d
  where ro.reporte_id = new.reporte_id
    and d.reporte_id = new.reporte_id
  on conflict (reporte_id, organizacion_id, rol_id) do nothing;

  return new;
end;
$$;

comment on function private.sincronizar_roles_reporte_service() is
  'F-SVC-23: cuando se agrega un rol por defecto del reporte «Service técnico», lo propaga a las organizaciones ya asignadas (la herencia congelada de la spec 007 corre una sola vez, al insertarse la asignación).';

drop trigger if exists reportes_service_organizaciones on public.reportes;
create trigger reportes_service_organizaciones
  after insert on public.reportes
  for each row execute function private.asignar_reporte_service_organizaciones();

drop trigger if exists reportes_service_organizacion_feature on public.organizaciones_features;
create trigger reportes_service_organizacion_feature
  after insert on public.organizaciones_features
  for each row execute function private.asignar_reporte_service_organizacion();

drop trigger if exists reportes_service_roles_default on public.reportes_roles_default;
create trigger reportes_service_roles_default
  after insert on public.reportes_roles_default
  for each row execute function private.sincronizar_roles_reporte_service();

-- No hace falta revocar el EXECUTE: una función de trigger solo se puede invocar como trigger
-- (Postgres la rechaza si se la llama directo), y estas viven en el esquema `private`, que no se
-- expone. Es el mismo criterio que los triggers de la spec 007.
