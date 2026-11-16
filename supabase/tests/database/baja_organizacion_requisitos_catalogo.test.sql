-- Prueba de catálogo (menores de la revisión retroactiva de #1008): toda función de baja de organización
-- (`baja_organizacion*`, en cualquier esquema) debe exigir superadmin, registrar la actividad y confirmar las claves diferidas,
-- con LLAMADAS reales (`private.is_superadmin(`, `private.registrar_actividad(`, `private.confirmar_claves_diferidas(`): se quitan
-- antes los comentarios `--` y `/* */`, así que nombrarlas sólo en un comentario no alcanza. (Un literal de texto sigue siendo
-- un límite: la prueba no ejecuta la función; la revisión de código cubre eso.) Hoy no existe ninguna función así (ver
-- docs/tecnico/administracion-organizacion.md): la prueba falla el día que aparezca una sin esas condiciones.
begin;

select plan(4);

create function pg_temp.sin_baja_que_no_llame(p_llamada text) returns integer language sql as $f$
  select count(*)::integer
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where p.proname like 'baja\_organizacion%'
     and n.nspname not in ('pg_catalog', 'information_schema')
     and regexp_replace(p.prosrc, '--[^\n]*|/\*.*?\*/', '', 'g') !~ p_llamada
$f$;

select is(pg_temp.sin_baja_que_no_llame('private\.is_superadmin\s*\('), 0,
  'ninguna función baja_organizacion* existe sin llamar a private.is_superadmin()');
select is(pg_temp.sin_baja_que_no_llame('private\.registrar_actividad\s*\('), 0,
  'ninguna función baja_organizacion* existe sin llamar a private.registrar_actividad()');
select is(pg_temp.sin_baja_que_no_llame('private\.confirmar_claves_diferidas\s*\('), 0,
  'ninguna función baja_organizacion* existe sin llamar a private.confirmar_claves_diferidas()');

-- Las funciones de las que depende el contrato existen (si se renombraran, lo de arriba dejaría de decir algo).
select ok(
  (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname in ('is_superadmin', 'registrar_actividad', 'confirmar_claves_diferidas')) >= 3,
  'private.is_superadmin, registrar_actividad y confirmar_claves_diferidas existen');

select * from finish();
rollback;
