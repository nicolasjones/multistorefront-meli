-- Prueba de catálogo (menores de la revisión retroactiva de #1008): toda función de baja de organización
-- (`baja_organizacion*`, en cualquier esquema) debe exigir superadmin (`private.is_superadmin`) y registrar la actividad
-- (`private.registrar_actividad`). Hoy no existe ninguna (ver docs/tecnico/administracion-organizacion.md); la prueba falla el día
-- que aparezca una sin esas dos condiciones, para que la primera RPC de baja no nazca sin control de acceso ni auditoría.
begin;

select plan(3);

select is(
  (select count(*)::integer
     from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where p.proname like 'baja\_organizacion%'
      and n.nspname not in ('pg_catalog', 'information_schema')
      and not (p.prosrc like '%is\_superadmin%')),
  0,
  'ninguna función baja_organizacion* existe sin exigir superadmin (private.is_superadmin)');

select is(
  (select count(*)::integer
     from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where p.proname like 'baja\_organizacion%'
      and n.nspname not in ('pg_catalog', 'information_schema')
      and not (p.prosrc like '%registrar\_actividad%')),
  0,
  'ninguna función baja_organizacion* existe sin registrar la actividad (private.registrar_actividad)');

-- Las dos funciones de las que depende el contrato existen (si se renombraran, la prueba de arriba dejaría de decir algo).
select ok(
  to_regprocedure('private.is_superadmin()') is not null and exists (
    select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private' and p.proname = 'registrar_actividad'),
  'private.is_superadmin y private.registrar_actividad existen');

select * from finish();
rollback;
