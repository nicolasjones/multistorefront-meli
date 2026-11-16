-- MSF-520: reaplicar los privilegios del historial de copias después de un restore.
--
-- Por qué: el procedimiento de restauración usa `pg_restore --no-privileges` (sección A de
-- `docs/copias-y-restauracion.md`). Con `--no-privileges` el restore NO aplica los ACL del dump: las
-- funciones `security definer` del historial de copias recuperan el permiso por defecto de Postgres
-- (EXECUTE para PUBLIC) y las tablas quedan sin `grant select` para `authenticated`. O sea: después de
-- restaurar, `anon` podría escribir el historial de copias (auditoría falsificable) y el panel perdería
-- la lectura del historial. Es el invariante que verifica
-- `supabase/tests/database/copias_imagenes_verificaciones.test.sql` (líneas 29-50).
--
-- Qué hace: `private.reaplicar_privilegios_copias()` deja el estado de ACL del historial de copias igual
-- que lo dejaron las migraciones 20260913140000 (`respaldos`) y 20261018120000 (imágenes y
-- verificaciones). Se corre DESPUÉS del `pg_restore` y ANTES de volver a levantar la app
-- (`docs/tecnico/runbooks/db-restore.md`, paso 5).
--
-- Los objetos que todavía no existen (una copia más vieja que la migración que los creó) se saltean: el
-- paso tiene que servir también sobre una base restaurada de una fecha anterior. Lo que NO se saltea es
-- la falta del rol `kestra_backups` (lo crea la migración 20260913140000): sin ese rol no hay a quién
-- otorgarle el EXECUTE y la función falla con un error explícito.
--
-- Esquemas: no crea ni altera tablas (sólo ACL). Aditiva e idempotente.
-- Reversión: `drop function private.reaplicar_privilegios_copias();` (los ACL quedan como los dejó el
-- restore; volver a correr 20260913140000 y 20261018120000 los deja como estaban).

create or replace function private.reaplicar_privilegios_copias()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  f text;
  t text;
begin
  -- El rol de servicio es el que queda con EXECUTE: si no existe, el `grant` fallaría con un error
  -- críptico de Postgres. Se dice explícitamente qué hacer (aplicar las migraciones pendientes).
  if not exists (select 1 from pg_roles where rolname = 'kestra_backups') then
    raise exception 'Falta el rol kestra_backups: aplicá las migraciones pendientes (supabase migration up) antes de reaplicar los privilegios del historial de copias.'
      using errcode = '42704';
  end if;

  -- Funciones `security definer` del historial: sólo las ejecuta el rol de servicio `kestra_backups`.
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
    if to_regprocedure(f) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', f);
      execute format('grant execute on function %s to kestra_backups', f);
    end if;
  end loop;

  -- Tablas del historial: `anon` sin nada, `authenticated` sólo lectura (la RLS filtra por superadmin).
  foreach t in array array[
    'public.respaldos',
    'public.respaldos_imagenes',
    'public.verificaciones_restauracion'
  ] loop
    if to_regclass(t) is not null then
      execute format('revoke all on table %s from public, anon, authenticated', t);
      execute format('grant select on table %s to authenticated', t);
    end if;
  end loop;

  -- Tras un `--no-privileges` esta misma función queda ejecutable por PUBLIC: se cierra a sí misma.
  revoke execute on function private.reaplicar_privilegios_copias() from public, anon, authenticated;
end;
$$;

comment on function private.reaplicar_privilegios_copias() is
  'Reaplica los ACL del historial de copias (funciones: sólo kestra_backups; tablas: lectura de authenticated con RLS). Se ejecuta después de un `pg_restore --no-privileges`, que deja las funciones security definer ejecutables por PUBLIC.';

-- Es una operación de operación, no de la app: sólo la ejecuta el dueño (postgres).
revoke execute on function private.reaplicar_privilegios_copias() from public, anon, authenticated;

-- Deja esta base en el estado correcto (en el deploy normal lo dejan las migraciones; tras un restore,
-- esta función).
select private.reaplicar_privilegios_copias();
