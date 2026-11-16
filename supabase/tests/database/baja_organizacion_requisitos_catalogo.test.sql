-- Prueba de catálogo (menores de la revisión retroactiva de #1008): toda función de baja de organización
-- (`baja_organizacion*`, en cualquier esquema) debe exigir superadmin, registrar la actividad y confirmar las claves diferidas,
-- con LLAMADAS reales (`private.is_superadmin(`, `private.registrar_actividad(`, `private.confirmar_claves_diferidas(`).
-- Antes de buscar se descartan, en este orden y con regexp_replace separados: comentarios de bloque, comentarios de línea,
-- bloques $tag$…$tag$ y literales de texto '…' (con '' escapado). Así nombrarlas en un comentario o dentro de un texto no alcanza.
-- Límite exacto: el análisis es textual y no ejecuta la función. Un comentario (`--` o `/*`) dentro de un literal produce un FALSO
-- FALLO (recorta o borra de más; nunca un falso pase). Una función de más de 20000 caracteres cuenta como incumplimiento (no se
-- audita: la limpieza de $tag$ es cuadrática). Una llamada real que nunca se ejecuta (rama muerta) sí pasa: eso lo cubre la
-- revisión de código. Hoy no existe ninguna función así (ver docs/tecnico/administracion-organizacion.md).
begin;

select plan(4);

create function pg_temp.limpiar_codigo(p_fuente text) returns text language sql as $f$
  select regexp_replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(p_fuente, '/\*([^*]|\*+[^*/])*\*+/', ' ', 'g'),
               '--[^\n]*', ' ', 'g'),
             '\$([A-Za-z_]{0,30})\$.*?\$\1\$', ' ', 'g'),
           '''([^'']|'''')*''', ' ', 'g')
$f$;

create function pg_temp.sin_baja_que_no_llame(p_llamada text) returns integer language sql as $f$
  select count(*)::integer
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where p.proname like 'baja\_organizacion%'
     and n.nspname not in ('pg_catalog', 'information_schema')
     and case
           -- Tope de tamaño: la limpieza de $tag$ es cuadrática con muchos `$`; más allá del tope no se audita y cuenta como falta.
           when length(p.prosrc) > 20000 then true
           else pg_temp.limpiar_codigo(p.prosrc) !~ p_llamada
         end
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
