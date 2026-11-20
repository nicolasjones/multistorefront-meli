-- MSF-520: el gate del simulacro de restauración (private.verificar_restore_simulacro).
--
-- El simulacro de `docs/simulacro-restauracion.md` se firma con el resultado de una corrida real
-- sobre staging. Para que ese resultado no sea un verde mentiroso, después del restore el operador
-- corre `private.verificar_restore_simulacro(<id de la copia>)`: si algún invariante no se
-- cumple, el simulacro se detiene (no se mide, no se firma).
--
-- Este test ejerce la función sobre estados que arma y desarma él mismo (todo dentro de una
-- transacción que termina en `rollback`), así que no depende del estado del ambiente:
--   1. la base restaurada es la de la copia (el restore se aplicó);
--   2. con un respaldo posterior, el restore NO se aplicó (el simulacro no puede firmarse);
--   3. sin SELECT/USAGE, la app no puede servir datos;
--   4. con EXECUTE para PUBLIC, el historial de copias queda falsificable.
--
-- Mismo patrón de permisos que `copias_restauracion_privilegios_msf520.test.sql`: el que llama es
-- postgres (dueño de las funciones), los permisos se comprueban con has_function_privilege /
-- has_table_privilege y los estados que el test rompe se arreglan con
-- `private.reaplicar_privilegios_copias()`.
begin;

select plan(16);

-- ============================================================================
-- La función existe y es de operación (no la puede ejecutar la app)
-- ============================================================================

select ok(
  (select to_regprocedure('private.verificar_restore_simulacro(bigint)') is not null),
  'existe private.verificar_restore_simulacro(bigint)'
);

select is(
  (select has_function_privilege('anon', 'private.verificar_restore_simulacro(bigint)', 'EXECUTE')),
  false,
  'anon no puede ejecutar la verificación del restore'
);

select is(
  (select has_function_privilege('authenticated', 'private.verificar_restore_simulacro(bigint)', 'EXECUTE')),
  false,
  'authenticated no puede ejecutar la verificación del restore'
);

select throws_ok(
  $$select private.verificar_restore_simulacro(null);$$,
  '22023',
  null,
  'sin el id de la copia la verificación se detiene con un error explícito'
);

-- ============================================================================
-- Fixture: la copia restaurada (fila del historial de respaldos)
-- ============================================================================

create temporary table copia_simulacro (id bigint primary key) on commit drop;

with nueva as (
  insert into public.respaldos (origen, estado, iniciado_en, finalizado_en, tamano_bytes, ubicacion)
  values ('manual', 'completado', clock_timestamp(), clock_timestamp(), 1024, 'respaldos:/respaldos/base/msf520-simulacro.dump')
  returning id
)
insert into copia_simulacro (id) select id from nueva;

-- ============================================================================
-- Los ocho invariantes del simulacro (y sólo esos)
-- ============================================================================

select is(
  (
    select array_agg(clave order by clave)
    from private.verificar_restore_simulacro((select id from copia_simulacro))
  ),
  array[
    'anon_no_lee_historial',
    'anon_no_lee_organizaciones',
    'app_lee_empresas',
    'app_lee_organizaciones',
    'app_usa_private',
    'historial_legible',
    'historial_solo_kestra',
    'restore_aplicado'
  ],
  'la verificación devuelve los ocho invariantes del simulacro'
);

-- ============================================================================
-- El restore se aplicó: la copia tiene que ser la más reciente del historial
-- ============================================================================

select is(
  (
    select cumple
    from private.verificar_restore_simulacro((select id from copia_simulacro))
    where clave = 'restore_aplicado'
  ),
  true,
  'con la copia como respaldo más reciente, el restore se aplicó'
);

-- Un respaldo posterior al de la copia: la base viva siguió ahí (el restore no corrió).
with posterior as (
  insert into public.respaldos (origen, estado, iniciado_en, finalizado_en, tamano_bytes, ubicacion)
  values ('manual', 'completado', clock_timestamp(), clock_timestamp(), 2048, 'respaldos:/respaldos/base/msf520-posterior.dump')
  returning id
)
select 1 from posterior;

select is(
  (
    select cumple
    from private.verificar_restore_simulacro((select id from copia_simulacro))
    where clave = 'restore_aplicado'
  ),
  false,
  'con un respaldo posterior, el restore no se aplicó: el simulacro no se puede firmar verde'
);

-- ============================================================================
-- La app tiene que poder servir datos después del restore
-- ============================================================================

revoke select on table public.organizaciones from public, anon, authenticated;

select is(
  (
    select cumple
    from private.verificar_restore_simulacro((select id from copia_simulacro))
    where clave = 'app_lee_organizaciones'
  ),
  false,
  'sin SELECT sobre las organizaciones, la app no puede listar nada'
);

grant select on table public.organizaciones to authenticated;

select is(
  (
    select cumple
    from private.verificar_restore_simulacro((select id from copia_simulacro))
    where clave = 'app_lee_organizaciones'
  ),
  true,
  'con SELECT sobre las organizaciones, la app vuelve a poder listar'
);

revoke usage on schema private from public, anon, authenticated;

select is(
  (
    select cumple
    from private.verificar_restore_simulacro((select id from copia_simulacro))
    where clave = 'app_usa_private'
  ),
  false,
  'sin USAGE sobre private, las políticas de RLS no se pueden evaluar'
);

grant usage on schema private to authenticated;

select is(
  (
    select cumple
    from private.verificar_restore_simulacro((select id from copia_simulacro))
    where clave = 'app_usa_private'
  ),
  true,
  'con USAGE sobre private, la app puede evaluar las políticas de RLS'
);

-- ============================================================================
-- El invariante del historial de copias (el que un restore `--no-privileges` rompe)
-- ============================================================================

grant execute on function public.iniciar_respaldo(text) to public;
revoke all on table public.respaldos from anon, authenticated;

select is(
  (
    select cumple
    from private.verificar_restore_simulacro((select id from copia_simulacro))
    where clave = 'historial_solo_kestra'
  ),
  false,
  'con EXECUTE para PUBLIC, cualquiera puede escribir el historial de copias'
);

select is(
  (
    select cumple
    from private.verificar_restore_simulacro((select id from copia_simulacro))
    where clave = 'historial_legible'
  ),
  false,
  'sin SELECT, el historial de copias no es legible por authenticated'
);

-- La reparación que ya dejó el procedimiento de restauración.
select private.reaplicar_privilegios_copias();

select is(
  (
    select cumple
    from private.verificar_restore_simulacro((select id from copia_simulacro))
    where clave = 'historial_solo_kestra'
  ),
  true,
  'la reparación deja el historial sólo ejecutable por kestra_backups'
);

select is(
  (
    select cumple
    from private.verificar_restore_simulacro((select id from copia_simulacro))
    where clave = 'historial_legible'
  ),
  true,
  'la reparación deja el historial legible por authenticated'
);

select is(
  (
    select cumple
    from private.verificar_restore_simulacro((select id from copia_simulacro))
    where clave = 'anon_no_lee_historial'
  ),
  true,
  'anon no lee el historial de copias'
);

select * from finish();

rollback;
