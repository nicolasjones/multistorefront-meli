-- MSF-520: los privilegios después de un restore.
--
-- El restore documentado (sección A de `docs/copias-y-restauracion.md`) aplica los permisos del
-- dump: `pg_restore` sin `--no-privileges`. Con esa opción el restore NO aplicaría los ACL y, como
-- `--clean` recrea cada objeto, la base quedaría con los permisos por defecto: las funciones
-- `security definer` del historial recuperarían EXECUTE para PUBLIC y las tablas quedarían sin
-- `grant select` para `authenticated`. Este test simula ese estado (como lo dejaría un restore sin
-- permisos) y comprueba que `private.reaplicar_privilegios_copias()` lo deja como corresponde: el
-- invariante de `copias_imagenes_verificaciones.test.sql` (líneas 29-50).
--
-- Al final fija el estado que el simulacro comprueba después del restore: el app con los permisos
-- que necesita para servir datos y `anon` sin lectura. Si ese estado cambia, el simulacro se
-- ejecuta contra una base que el panel no puede leer.
begin;

select plan(22);

-- ============================================================================
-- La reparación existe y no es de la app
-- ============================================================================

select ok(
  (select to_regprocedure('private.reaplicar_privilegios_copias()') is not null),
  'existe private.reaplicar_privilegios_copias()'
);

select is(
  (select has_function_privilege('anon', 'private.reaplicar_privilegios_copias()', 'EXECUTE')),
  false,
  'anon no puede ejecutar la reparación de privilegios'
);

select is(
  (select has_function_privilege('authenticated', 'private.reaplicar_privilegios_copias()', 'EXECUTE')),
  false,
  'authenticated no puede ejecutar la reparación de privilegios'
);

-- ============================================================================
-- Restore simulado: sin `--no-privileges` no se aplicarían estos ACL
-- ============================================================================

grant execute on function public.iniciar_respaldo(text) to public;
grant execute on function public.finalizar_respaldo_completado(bigint, bigint, text) to public;
grant execute on function public.finalizar_respaldo_error(bigint, text) to public;
grant execute on function public.iniciar_respaldo_imagenes(text) to public;
grant execute on function public.finalizar_respaldo_imagenes_completado(bigint, bigint, bigint, text) to public;
grant execute on function public.finalizar_respaldo_imagenes_error(bigint, text) to public;
grant execute on function public.iniciar_verificacion_restauracion() to public;
grant execute on function public.finalizar_verificacion_completado(bigint, integer, text) to public;
grant execute on function public.finalizar_verificacion_error(bigint, text) to public;

revoke all on table public.respaldos from anon, authenticated;
revoke all on table public.respaldos_imagenes from anon, authenticated;
revoke all on table public.verificaciones_restauracion from anon, authenticated;

select is(
  array[
    has_function_privilege('anon', 'public.iniciar_respaldo(text)', 'EXECUTE'),
    has_function_privilege('anon', 'public.finalizar_respaldo_completado(bigint, bigint, text)', 'EXECUTE'),
    has_function_privilege('anon', 'public.finalizar_respaldo_error(bigint, text)', 'EXECUTE'),
    has_function_privilege('anon', 'public.iniciar_respaldo_imagenes(text)', 'EXECUTE'),
    has_function_privilege('anon', 'public.finalizar_respaldo_imagenes_completado(bigint, bigint, bigint, text)', 'EXECUTE'),
    has_function_privilege('anon', 'public.finalizar_respaldo_imagenes_error(bigint, text)', 'EXECUTE'),
    has_function_privilege('anon', 'public.iniciar_verificacion_restauracion()', 'EXECUTE'),
    has_function_privilege('anon', 'public.finalizar_verificacion_completado(bigint, integer, text)', 'EXECUTE'),
    has_function_privilege('anon', 'public.finalizar_verificacion_error(bigint, text)', 'EXECUTE')
  ],
  array[true, true, true, true, true, true, true, true, true],
  'tras el restore simulado las nueve funciones del historial quedan ejecutables por anon'
);

select is(
  array[
    has_table_privilege('authenticated', 'public.respaldos', 'SELECT'),
    has_table_privilege('authenticated', 'public.respaldos_imagenes', 'SELECT'),
    has_table_privilege('authenticated', 'public.verificaciones_restauracion', 'SELECT')
  ],
  array[false, false, false],
  'tras el restore simulado el historial queda sin lectura para authenticated'
);

-- ============================================================================
-- La reparación deja el historial como lo dejaron las migraciones
-- ============================================================================

select lives_ok(
  $$select private.reaplicar_privilegios_copias();$$,
  'la reparación de privilegios no lanza error'
);

select is(
  array[
    has_function_privilege('kestra_backups', 'public.iniciar_respaldo(text)', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.iniciar_respaldo(text)', 'EXECUTE'),
    has_function_privilege('anon', 'public.iniciar_respaldo(text)', 'EXECUTE')
  ],
  array[true, false, false],
  'iniciar_respaldo: solo kestra_backups'
);

select is(
  array[
    has_function_privilege('kestra_backups', 'public.finalizar_respaldo_completado(bigint, bigint, text)', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.finalizar_respaldo_completado(bigint, bigint, text)', 'EXECUTE'),
    has_function_privilege('anon', 'public.finalizar_respaldo_completado(bigint, bigint, text)', 'EXECUTE')
  ],
  array[true, false, false],
  'finalizar_respaldo_completado: solo kestra_backups'
);

select is(
  array[
    has_function_privilege('kestra_backups', 'public.finalizar_respaldo_error(bigint, text)', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.finalizar_respaldo_error(bigint, text)', 'EXECUTE'),
    has_function_privilege('anon', 'public.finalizar_respaldo_error(bigint, text)', 'EXECUTE')
  ],
  array[true, false, false],
  'finalizar_respaldo_error: solo kestra_backups'
);

select is(
  array[
    has_function_privilege('kestra_backups', 'public.iniciar_respaldo_imagenes(text)', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.iniciar_respaldo_imagenes(text)', 'EXECUTE'),
    has_function_privilege('anon', 'public.iniciar_respaldo_imagenes(text)', 'EXECUTE')
  ],
  array[true, false, false],
  'iniciar_respaldo_imagenes: solo kestra_backups'
);

select is(
  array[
    has_function_privilege('kestra_backups', 'public.finalizar_respaldo_imagenes_completado(bigint, bigint, bigint, text)', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.finalizar_respaldo_imagenes_completado(bigint, bigint, bigint, text)', 'EXECUTE'),
    has_function_privilege('anon', 'public.finalizar_respaldo_imagenes_completado(bigint, bigint, bigint, text)', 'EXECUTE')
  ],
  array[true, false, false],
  'finalizar_respaldo_imagenes_completado: solo kestra_backups'
);

select is(
  array[
    has_function_privilege('kestra_backups', 'public.finalizar_respaldo_imagenes_error(bigint, text)', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.finalizar_respaldo_imagenes_error(bigint, text)', 'EXECUTE'),
    has_function_privilege('anon', 'public.finalizar_respaldo_imagenes_error(bigint, text)', 'EXECUTE')
  ],
  array[true, false, false],
  'finalizar_respaldo_imagenes_error: solo kestra_backups'
);

select is(
  array[
    has_function_privilege('kestra_backups', 'public.iniciar_verificacion_restauracion()', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.iniciar_verificacion_restauracion()', 'EXECUTE'),
    has_function_privilege('anon', 'public.iniciar_verificacion_restauracion()', 'EXECUTE')
  ],
  array[true, false, false],
  'iniciar_verificacion_restauracion: solo kestra_backups'
);

select is(
  array[
    has_function_privilege('kestra_backups', 'public.finalizar_verificacion_completado(bigint, integer, text)', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.finalizar_verificacion_completado(bigint, integer, text)', 'EXECUTE'),
    has_function_privilege('anon', 'public.finalizar_verificacion_completado(bigint, integer, text)', 'EXECUTE')
  ],
  array[true, false, false],
  'finalizar_verificacion_completado: solo kestra_backups'
);

select is(
  array[
    has_function_privilege('kestra_backups', 'public.finalizar_verificacion_error(bigint, text)', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.finalizar_verificacion_error(bigint, text)', 'EXECUTE'),
    has_function_privilege('anon', 'public.finalizar_verificacion_error(bigint, text)', 'EXECUTE')
  ],
  array[true, false, false],
  'finalizar_verificacion_error: solo kestra_backups'
);

select is(
  array[
    has_table_privilege('authenticated', 'public.respaldos', 'SELECT'),
    has_table_privilege('authenticated', 'public.respaldos_imagenes', 'SELECT'),
    has_table_privilege('authenticated', 'public.verificaciones_restauracion', 'SELECT')
  ],
  array[true, true, true],
  'el historial vuelve a ser legible por authenticated (la RLS filtra por superadmin)'
);

select is(
  array[
    has_table_privilege('anon', 'public.respaldos', 'SELECT'),
    has_table_privilege('anon', 'public.respaldos_imagenes', 'SELECT'),
    has_table_privilege('anon', 'public.verificaciones_restauracion', 'SELECT')
  ],
  array[false, false, false],
  'anon no lee el historial de copias'
);

-- ============================================================================
-- La reparación es idempotente (se puede correr dos veces sin romper nada)
-- ============================================================================

select lives_ok(
  $$select private.reaplicar_privilegios_copias();$$,
  'la reparación de privilegios es idempotente'
);

select is(
  array[
    has_function_privilege('kestra_backups', 'public.iniciar_respaldo(text)', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.iniciar_respaldo(text)', 'EXECUTE'),
    has_function_privilege('anon', 'public.iniciar_respaldo(text)', 'EXECUTE')
  ],
  array[true, false, false],
  'tras la segunda reparación el invariante sigue igual'
);

-- ============================================================================
-- El estado que el simulacro comprueba después del restore: el app con sus
-- permisos y `anon` sin lectura. Si esto no se cumple, el panel abre pero no
-- muestra datos y el simulacro no cierra (FR-011/SC-002).
-- ============================================================================

select is(
  array[
    has_schema_privilege('authenticated', 'private', 'USAGE'),
    has_table_privilege('authenticated', 'public.organizaciones', 'SELECT'),
    has_table_privilege('authenticated', 'dominio.empresas', 'SELECT')
  ],
  array[true, true, true],
  'después del restore el app conserva lo que necesita para servir datos (USAGE sobre private y lectura de las tablas)'
);

-- Los permisos del app son explícitos por tabla (los grants de las migraciones, no un permiso por
-- defecto): por eso un restore que no aplique los GRANT del dump deja al panel sin lectura.
select is(
  array[
    has_table_privilege('authenticated', 'public.organizaciones', 'SELECT'),
    has_table_privilege('authenticated', 'public.organizaciones', 'INSERT'),
    has_table_privilege('authenticated', 'public.organizaciones', 'UPDATE'),
    has_table_privilege('authenticated', 'public.organizaciones', 'DELETE')
  ],
  array[true, false, false, false],
  'los permisos del app son explícitos por tabla: ningún permiso por defecto los amplía'
);

select is(
  array[
    has_table_privilege('anon', 'public.organizaciones', 'SELECT'),
    has_table_privilege('anon', 'dominio.empresas', 'SELECT')
  ],
  array[false, false],
  'anon no lee las tablas del app después del restore'
);

select * from finish();

rollback;
