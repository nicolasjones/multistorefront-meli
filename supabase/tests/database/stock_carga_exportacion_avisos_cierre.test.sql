-- Cierre de la épica MSF-368 (spec 20261024-130000-stock-carga-exportacion-y-avisos, T051, SC-900):
-- el contrato de seguridad y de esquemas de la épica, verificado sobre el CATÁLOGO de Postgres y no
-- sobre una lista fija de ids: si una tabla nueva pierde la RLS, si una RPC nueva queda ejecutable por
-- `anon`, si una tabla nueva aparece en `public` en vez de `dominio`, si una RPC pierde el
-- `search_path` vacío, si la app gana escritura directa sobre una tabla que solo escriben las RPC o
-- si la cola de correos pierde el permiso de `service_role`, esta prueba falla sin tocarla.
--
-- Sin fixture: solo consultas al catálogo, así que no depende del estado de los datos ni del orden en
-- que corren los tests.
--
-- Tablas nuevas de la épica (Principio VII: dato del producto → `dominio`, nunca `public`):
--   dominio.cargas_iniciales_stock  (F-STK-07) · dominio.stock_avisos_reposicion (F-STK-09)
--   dominio.stock_alertas_avisadas   (F-STK-09) · dominio.faltantes_avisos          (F-STK-17)
-- Vista de lectura (contrato de la pantalla, como public.stock_estados): public.faltantes_listado.
--
-- Complementa a `rls_en_toda_tabla` y `aislamiento_organizaciones`, que recorren el catálogo de forma
-- genérica: aquí se fija el contrato DE ESTA ÉPICA.
begin;

select plan(18);

-- ============================================================================
-- 1. Esquema declarado (Principio VII)
-- ============================================================================

select is(
  (select count(*)::int
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r'
      and n.nspname = 'dominio'
      and c.relname in (
        'cargas_iniciales_stock', 'stock_avisos_reposicion',
        'stock_alertas_avisadas', 'faltantes_avisos')),
  4,
  'las 4 tablas nuevas de la épica están en el esquema dominio'
);

select is(
  (select count(*)::int
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r'
      and n.nspname = 'public'
      and c.relname in (
        'cargas_iniciales_stock', 'stock_avisos_reposicion',
        'stock_alertas_avisadas', 'faltantes_avisos')),
  0,
  'ninguna tabla nueva de la épica quedó en el esquema public'
);

-- ============================================================================
-- 2. RLS y aislamiento por organización en las 4 tablas
-- ============================================================================

select is(
  (select count(*)::int
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r'
      and n.nspname = 'dominio'
      and c.relrowsecurity
      and c.relname in (
        'cargas_iniciales_stock', 'stock_avisos_reposicion',
        'stock_alertas_avisadas', 'faltantes_avisos')),
  4,
  'las 4 tablas nuevas tienen RLS activada'
);

-- La política tiene que COMPARAR la columna `organizacion_id` con la de la sesión: el nombre de la
-- función `private.organizacion_id()` también contiene ese texto, así que un `like` sin más aceptaría
-- una política que no filtra por la columna. La expresión se busca con `=`, no con `<>`.
select is(
  (select count(distinct c.relname)::int
     from pg_policy pol
     join pg_class c on c.oid = pol.polrelid
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'dominio'
      and c.relname in (
        'cargas_iniciales_stock', 'stock_avisos_reposicion',
        'stock_alertas_avisadas', 'faltantes_avisos')
      and pol.polcmd = 'r'
      and pg_get_expr(pol.polqual, pol.polrelid) ~ 'organizacion_id[[:space:]]*='),
  4,
  'las 4 tablas nuevas filtran por organización en su política de lectura'
);

-- Sin USAGE sobre el esquema, los permisos de tabla no alcanzan: la app no leería nada.
select ok(
  has_schema_privilege('authenticated', 'dominio', 'USAGE'),
  'authenticated tiene USAGE sobre el esquema dominio (los grants de tabla alcanzan)'
);

select is(
  (select count(*)::int
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r'
      and n.nspname = 'dominio'
      and c.relname in (
        'cargas_iniciales_stock', 'stock_avisos_reposicion',
        'stock_alertas_avisadas', 'faltantes_avisos')
      and has_table_privilege('authenticated', c.oid, 'SELECT')
      and not has_table_privilege('authenticated', c.oid, 'INSERT')
      and not has_table_privilege('authenticated', c.oid, 'UPDATE')
      and not has_table_privilege('authenticated', c.oid, 'DELETE')),
  4,
  'authenticated lee las 4 tablas nuevas y no las escribe directamente'
);

select is(
  (select count(*)::int
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r'
      and n.nspname = 'dominio'
      and c.relname in (
        'cargas_iniciales_stock', 'stock_avisos_reposicion',
        'stock_alertas_avisadas', 'faltantes_avisos')
      and has_table_privilege('anon', c.oid, 'SELECT')),
  0,
  'anon no lee ninguna de las 4 tablas nuevas'
);

-- ============================================================================
-- 3. RPC nuevas de `public`: existen, con `search_path` vacío y sin `anon`
-- ============================================================================

select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'validar_carga_stock', 'aplicar_carga_inicial_stock',
        'generar_resumen_reposicion', 'cerrar_resumen_reposicion',
        'organizaciones_con_resumen_pendiente',
        'faltantes_avisos_pendientes', 'tomar_aviso_faltante', 'cerrar_aviso_faltante',
        'avisar_faltantes', 'productos_mas_vendidos')),
  10,
  'las 10 RPC nuevas de la épica existen en el esquema public'
);

select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'validar_carga_stock', 'aplicar_carga_inicial_stock',
        'generar_resumen_reposicion', 'cerrar_resumen_reposicion',
        'organizaciones_con_resumen_pendiente',
        'faltantes_avisos_pendientes', 'tomar_aviso_faltante', 'cerrar_aviso_faltante',
        'avisar_faltantes', 'productos_mas_vendidos')
      and p.prosecdef
      and p.proconfig @> array['search_path=""']),
  10,
  'las 10 RPC nuevas de la épica son security definer con search_path vacío'
);

select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'validar_carga_stock', 'aplicar_carga_inicial_stock',
        'generar_resumen_reposicion', 'cerrar_resumen_reposicion',
        'organizaciones_con_resumen_pendiente',
        'faltantes_avisos_pendientes', 'tomar_aviso_faltante', 'cerrar_aviso_faltante',
        'avisar_faltantes', 'productos_mas_vendidos')
      and has_function_privilege('anon', p.oid, 'EXECUTE')),
  0,
  'anon no ejecuta ninguna RPC nueva de la épica (SC-900)'
);

-- Las 6 RPC de la cola de correos (resumen de reposición y avisos de faltantes) son solo de
-- `service_role`: la app no las dispara, las llama la Edge Function desde el barrido de Kestra.
select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'generar_resumen_reposicion', 'cerrar_resumen_reposicion',
        'organizaciones_con_resumen_pendiente',
        'faltantes_avisos_pendientes', 'tomar_aviso_faltante', 'cerrar_aviso_faltante')
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  0,
  'authenticated no ejecuta las 6 RPC que son solo de service_role'
);

-- Y el otro lado del contrato: `service_role` SÍ las ejecuta. Si el permiso se perdiera, la cola de
-- correos dejaría de funcionar en silencio (la RPC de la Edge Function daría error de permiso) y las
-- pruebas de «no ejecutable por la app» seguirían en verde.
select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'generar_resumen_reposicion', 'cerrar_resumen_reposicion',
        'organizaciones_con_resumen_pendiente',
        'faltantes_avisos_pendientes', 'tomar_aviso_faltante', 'cerrar_aviso_faltante')
      and has_function_privilege('service_role', p.oid, 'EXECUTE')),
  6,
  'service_role ejecuta las 6 RPC de la cola de correos (el barrido las necesita)'
);

-- Las 4 RPC de la app: el permiso sale del rol (no del botón de la pantalla).
select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'validar_carga_stock', 'aplicar_carga_inicial_stock',
        'avisar_faltantes', 'productos_mas_vendidos')
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  4,
  'authenticated ejecuta las 4 RPC de la app de la épica'
);

-- ============================================================================
-- 4. Funciones internas de la épica: no son ejecutables desde la app
-- ============================================================================

select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in (
        'rechazar_cambio_carga_inicial_stock', 'validar_filas_carga_stock',
        'destinatarios_resumen_reposicion', 'productos_nuevos_en_alerta',
        'faltante_abierta')),
  5,
  'las 5 funciones internas nuevas de la épica existen'
);

select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in (
        'rechazar_cambio_carga_inicial_stock', 'validar_filas_carga_stock',
        'destinatarios_resumen_reposicion', 'productos_nuevos_en_alerta',
        'faltante_abierta')
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
           or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  0,
  'las funciones internas de la épica no son ejecutables por anon ni por authenticated'
);

-- La épica volvió a declarar `private.sembrar_motivos_movimiento` (para el motivo de sistema
-- «Carga inicial de stock»): su definición actual es parte del contrato de la épica.
select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname = 'sembrar_motivos_movimiento'
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
           or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  0,
  'la función interna que la épica volvió a declarar no es ejecutable por anon ni por authenticated'
);

-- ============================================================================
-- 5. Vista de lectura de faltantes (contrato de la pantalla)
-- ============================================================================

select ok(
  exists (
    select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'faltantes_listado'
       and c.relkind = 'v'
       and c.reloptions @> array['security_invoker=true']),
  'la vista public.faltantes_listado es security_invoker (rige la RLS de las tablas base)'
);

select is(
  has_table_privilege('anon', 'public.faltantes_listado', 'SELECT'),
  false,
  'anon no lee la vista public.faltantes_listado'
);

select * from finish();

rollback;
