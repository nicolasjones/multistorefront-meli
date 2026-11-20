-- MSF-520: el gate del simulacro de restauración (comprobación posterior al restore).
--
-- Por qué: el simulacro de `docs/simulacro-restauracion.md` tiene que poder firmarse como
-- «se restauró y el sistema volvió a servir». Sin una comprobación objetiva, dos fallos del
-- restore se pueden medir como un simulacro verde:
--   1. el restore no se aplicó (la base viva siguió ahí): la «pérdida» medida da 0 h y el
--      simulacro se firma verde sin haber restaurado nada;
--   2. el restore dejó la base sin los permisos que la app necesita (`pg_restore
--      --no-privileges` no aplica los ACL del dump): el panel no puede leer y el simulacro
--      quedaría a medio hacer.
--
-- Qué hace: `private.verificar_restore_simulacro(p_copia_id)` devuelve una fila por
-- comprobación (`clave`, `cumple`, `detalle`). El operador la corre DESPUÉS del restore y antes
-- de medir:
--   select * from private.verificar_restore_simulacro(<id de la copia restaurada>);
-- Si alguna fila viene con `cumple = false`, el simulacro se detiene: no se mide, no se firma y
-- el problema va al registro.
--
-- Las comprobaciones:
--   restore_aplicado            la copia es la más reciente del historial: si el restore no se
--                               aplicó, la base viva tiene respaldos posteriores a la copia.
--   app_usa_private             `authenticated` puede usar el esquema `private` (sin eso las
--                               políticas de RLS no se pueden evaluar).
--   app_lee_organizaciones      `authenticated` puede leer `public.organizaciones`.
--   app_lee_empresas            `authenticated` puede leer `dominio.empresas`.
--   anon_no_lee_organizaciones  `anon` no lee `public.organizaciones`.
--   historial_solo_kestra       las nueve funciones `security definer` del historial de copias
--                               sólo las ejecuta `kestra_backups` (el invariante de
--                               `supabase/tests/database/copias_imagenes_verificaciones.test.sql`).
--   historial_legible           `authenticated` lee las tres tablas del historial (la RLS filtra
--                               por superadmin).
--   anon_no_lee_historial       `anon` no lee el historial de copias.
--
-- Lo que NO hace: no mide la pérdida ni el tiempo (los mide el operador con el reloj y la tabla
-- testigo del protocolo), no arregla nada (el arreglo del historial es
-- `private.reaplicar_privilegios_copias()`) y no firma nada.
--
-- Esquemas: no crea ni altera tablas (sólo lee catálogos y el historial de respaldos).
-- Aditiva e idempotente.
-- Reversión: `drop function private.verificar_restore_simulacro(bigint);`

create or replace function private.verificar_restore_simulacro(p_copia_id bigint)
returns table (clave text, cumple boolean, detalle text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_existe boolean;
  v_posteriores bigint;
  v_infracciones integer;
  v_total integer;
  f text;
  t text;
begin
  if p_copia_id is null then
    raise exception 'Falta el id de la copia restaurada (p_copia_id): sin ese dato no se puede comprobar que el restore se aplicó.'
      using errcode = '22023';
  end if;

  -- 1. ¿El restore se aplicó? La copia tiene que ser la más reciente del historial: si el
  --    restore no corrió, la base viva tiene respaldos posteriores a la copia.
  select exists (select 1 from public.respaldos where id = p_copia_id),
         count(*) filter (where id > p_copia_id)
    into v_existe, v_posteriores
    from public.respaldos;

  clave := 'restore_aplicado';
  cumple := v_existe and v_posteriores = 0;
  detalle := case
    when not v_existe then format('la copia %s no está en el historial de la base restaurada', p_copia_id)
    when v_posteriores > 0 then format('la base tiene %s respaldo(s) posteriores a la copia %s: el restore no se aplicó', v_posteriores, p_copia_id)
    else format('la base restaurada es la de la copia %s', p_copia_id)
  end;
  return next;

  -- 2. ¿La app puede servir datos? `authenticated` es el rol con el que entra el panel.
  clave := 'app_usa_private';
  cumple := has_schema_privilege('authenticated', 'private', 'USAGE');
  detalle := case
    when cumple then 'authenticated puede usar el esquema private (las políticas de RLS lo necesitan)'
    else 'authenticated no puede usar el esquema private: las políticas de RLS no se pueden evaluar'
  end;
  return next;

  clave := 'app_lee_organizaciones';
  cumple := has_table_privilege('authenticated', 'public.organizaciones', 'SELECT');
  detalle := case
    when cumple then 'authenticated puede leer public.organizaciones'
    else 'authenticated no puede leer public.organizaciones: el panel no puede listar nada'
  end;
  return next;

  clave := 'app_lee_empresas';
  cumple := has_table_privilege('authenticated', 'dominio.empresas', 'SELECT');
  detalle := case
    when cumple then 'authenticated puede leer dominio.empresas'
    else 'authenticated no puede leer dominio.empresas: el panel no puede listar las empresas'
  end;
  return next;

  clave := 'anon_no_lee_organizaciones';
  cumple := not has_table_privilege('anon', 'public.organizaciones', 'SELECT');
  detalle := case
    when cumple then 'anon no lee public.organizaciones'
    else 'anon lee public.organizaciones: hay datos accesibles sin sesión'
  end;
  return next;

  -- 3. ¿El invariante del historial de copias sigue en pie? Tras un restore las funciones
  --    `security definer` recuperan el permiso por defecto de Postgres (EXECUTE para PUBLIC) y
  --    las tablas quedan sin lectura para `authenticated`.
  v_total := 9;
  v_infracciones := 0;
  foreach f in array array[
    'public.iniciar_respaldo(text)',
    'public.finalizar_respaldo_completado(bigint, bigint, text)',
    'public.finalizar_respaldo_error(bigint, text)',
    'public.iniciar_respaldo_imagenes(text)',
    'public.finalizar_respaldo_imagenes_completado(bigint, bigint, bigint, text)',
    'public.finalizar_respaldo_imagenes_error(bigint, text)',
    'public.iniciar_verificacion_restauracion()',
    'public.finalizar_verificacion_completado(bigint, integer, text)',
    'public.finalizar_verificacion_error(bigint, text)'
  ] loop
    if to_regprocedure(f) is null then
      v_infracciones := v_infracciones + 1;
    elsif not has_function_privilege('kestra_backups', f, 'EXECUTE')
      or has_function_privilege('anon', f, 'EXECUTE')
      or has_function_privilege('authenticated', f, 'EXECUTE') then
      v_infracciones := v_infracciones + 1;
    end if;
  end loop;

  clave := 'historial_solo_kestra';
  cumple := v_infracciones = 0;
  detalle := case
    when cumple then 'las nueve funciones del historial de copias sólo las ejecuta kestra_backups'
    else format('%s de las %s funciones del historial de copias no quedan como las dejó la migración (no existen o las puede ejecutar otro rol; la reparación: private.reaplicar_privilegios_copias())', v_infracciones, v_total)
  end;
  return next;

  v_total := 3;
  v_infracciones := 0;
  foreach t in array array[
    'public.respaldos',
    'public.respaldos_imagenes',
    'public.verificaciones_restauracion'
  ] loop
    if to_regclass(t) is null
      or not has_table_privilege('authenticated', t, 'SELECT') then
      v_infracciones := v_infracciones + 1;
    end if;
  end loop;

  clave := 'historial_legible';
  cumple := v_infracciones = 0;
  detalle := case
    when cumple then 'authenticated lee las tres tablas del historial (la RLS filtra por superadmin)'
    else format('%s de las %s tablas del historial de copias no las puede leer authenticated (o no existen en la base restaurada: aplicá las migraciones pendientes)', v_infracciones, v_total)
  end;
  return next;

  v_infracciones := 0;
  foreach t in array array[
    'public.respaldos',
    'public.respaldos_imagenes',
    'public.verificaciones_restauracion'
  ] loop
    if to_regclass(t) is not null
      and has_table_privilege('anon', t, 'SELECT') then
      v_infracciones := v_infracciones + 1;
    end if;
  end loop;

  clave := 'anon_no_lee_historial';
  cumple := v_infracciones = 0;
  detalle := case
    when cumple then 'anon no lee el historial de copias'
    else format('anon lee %s de las %s tablas del historial de copias', v_infracciones, v_total)
  end;
  return next;
end;
$$;

comment on function private.verificar_restore_simulacro(bigint) is
  'Comprobación posterior al restore del simulacro de restauración: devuelve una fila por invariante (restore aplicado, la app puede leer, anon no lee, el historial de copias con sus privilegios). El operador la corre después del `pg_restore` y antes de medir: si alguna fila viene con cumple = false, el simulacro se detiene (no se mide ni se firma).';

-- Es una operación de operación, no de la app: sólo la ejecuta el dueño (postgres).
revoke execute on function private.verificar_restore_simulacro(bigint) from public, anon, authenticated;
