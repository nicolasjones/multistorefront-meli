-- MSF-561 · Cierre MSF-189 (FR-017, FR-019): grants de las RPC nuevas de `public`, RLS y esquema de
-- cada tabla (Principio VII) y endurecimiento de las funciones `security definer`.
begin;

select plan(23);

-- FR-017 · RPC de `public` que llama la app: authenticated sí, anon/public no.
select ok(has_function_privilege('authenticated', f, 'execute'), 'authenticated ejecuta ' || f)
from unnest(array[
  'public.guardar_preferencia_aviso(text, boolean)',
  'public.listar_preferencias_aviso()',
  'public.crear_estado_consulta(text)',
  'public.renombrar_estado_consulta(uuid, text)',
  'public.cambiar_estado_estado_consulta(uuid, boolean)'
]) f;

select ok(not has_function_privilege('anon', f, 'execute'), 'anon no ejecuta ' || f)
from unnest(array[
  'public.guardar_preferencia_aviso(text, boolean)',
  'public.listar_preferencias_aviso()',
  'public.crear_estado_consulta(text)',
  'public.renombrar_estado_consulta(uuid, text)',
  'public.cambiar_estado_estado_consulta(uuid, boolean)'
]) f;

-- Funciones internas de avisos: ni anon ni authenticated.
select ok(
  not has_function_privilege('anon', f, 'execute') and not has_function_privilege('authenticated', f, 'execute'),
  'ni anon ni authenticated ejecutan ' || f
)
from unnest(array[
  'private.emitir_aviso(text, uuid, jsonb, uuid)',
  'private.empresas_accesibles_de_usuario(uuid)',
  'private.nivel_seccion_de_usuario(uuid, text)',
  'private.reclamar_avisos_listos(integer)',
  'private.marcar_aviso_enviado(uuid)',
  'private.registrar_fallo_aviso(uuid, text)'
]) f;

-- FR-019 · RLS y esquema declarado de cada tabla.
select is(
  (select array_agg(n.nspname || '.' || c.relname order by c.relname)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relname in ('tipos_aviso', 'preferencias_aviso', 'avisos_pendientes', 'estados_consulta')
      and c.relkind = 'r' and n.nspname in ('public', 'dominio')),
  array['public.avisos_pendientes', 'dominio.estados_consulta', 'public.preferencias_aviso', 'public.tipos_aviso'],
  'cada tabla vive en su esquema declarado (plataforma en public, estados_consulta en dominio)'
);
select ok(
  (select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relname in ('tipos_aviso', 'preferencias_aviso', 'avisos_pendientes', 'estados_consulta')
      and n.nspname in ('public', 'dominio')),
  'las cuatro tablas tienen RLS'
);
select ok(
  not has_table_privilege('authenticated', 'public.avisos_pendientes', 'select')
  and not has_table_privilege('anon', 'public.avisos_pendientes', 'select'),
  'la cola no es legible por la app'
);
select ok(
  not has_table_privilege('anon', 'public.tipos_aviso', 'select')
  and not has_table_privilege('anon', 'public.preferencias_aviso', 'select')
  and not has_table_privilege('anon', 'dominio.estados_consulta', 'select'),
  'anon no lee ninguna tabla nueva'
);
select ok(
  not has_table_privilege('authenticated', 'public.tipos_aviso', 'insert')
  and not has_table_privilege('authenticated', 'dominio.estados_consulta', 'delete'),
  'el catálogo es de solo lectura y los estados no se borran'
);

-- Todas las funciones nuevas con security definer fijan search_path vacío.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef
      and p.proname in ('emitir_aviso', 'empresas_accesibles_de_usuario', 'nivel_seccion_de_usuario', 'reclamar_avisos_listos',
                        'marcar_aviso_enviado', 'registrar_fallo_aviso', 'guardar_preferencia_aviso',
                        'listar_preferencias_aviso', 'crear_estado_consulta', 'renombrar_estado_consulta',
                        'cambiar_estado_estado_consulta')
      and (p.proconfig is null or not ('search_path=""' = any (p.proconfig)))),
  0,
  'las funciones security definer de avisos y listas fijan search_path vacío'
);

-- Mínimo privilegio de Kestra (solo si el rol existe en este entorno).
select ok(
  not exists (select 1 from pg_roles where rolname = 'kestra_orquestacion')
  or (has_function_privilege('kestra_orquestacion', 'private.reclamar_avisos_listos(integer)', 'execute')
      and not has_table_privilege('kestra_orquestacion', 'public.avisos_pendientes', 'select')
      and not has_table_privilege('kestra_orquestacion', 'public.preferencias_aviso', 'select')
      and not has_function_privilege('kestra_orquestacion', 'private.emitir_aviso(text, uuid, jsonb, uuid)', 'execute')),
  'Kestra ejecuta solo el reclamo/resultado y no toca las tablas ni emite avisos'
);

select * from finish();
rollback;
