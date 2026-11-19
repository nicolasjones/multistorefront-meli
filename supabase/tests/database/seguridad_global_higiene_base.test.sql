-- Pruebas GLOBALES de seguridad e higiene de la base (lote 33: MSF-669, MSF-918, MSF-922, MSF-923, MSF-899/917).
-- Recorren el catálogo en vez de listar objetos: si alguien rompe la regla con una migración nueva, fallan sin tocarlas.
-- Las listas fijas son LISTAS PERMITIDAS explícitas: agregar algo a una exige decidirlo en el PR.
begin;

select plan(17);

-- ---------------------------------------------------------------------------
-- 1. Superficie de `anon`: ejecutable de verdad = privilegio EXECUTE + USAGE sobre el esquema, y no de una extensión.
-- ---------------------------------------------------------------------------
create temp table fn_app on commit drop as
select n.nspname as esquema, p.proname as nombre, p.oid as oid, p.prosecdef as definer, p.proconfig as config,
       exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c where c = 'search_path=""') as sp_vacio,
       exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c where c like 'search_path=%') as tiene_sp
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('public', 'publico', 'private', 'dominio')
   and p.prokind in ('f', 'p')
   and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e');

select cmp_ok((select count(*) from fn_app)::int, '>', 100, 'el recorrido encuentra las funciones de la app (no pasa en vacío)');

select is(
  (select coalesce(array_agg(esquema || '.' || nombre order by esquema, nombre), array[]::text[])
     from fn_app
    where esquema = 'publico' and has_function_privilege('anon', oid, 'execute') and has_schema_privilege('anon', esquema, 'usage')
      and nombre <> all (array[
        'analitica_por_dominio', 'busqueda_pagina_por_dominio', 'capacidades_opiniones_por_dominio',
        'capacidades_tienda_por_dominio', 'catalogo_pagina_por_dominio', 'catalogo_visible_por_dominio',
        'categorias_por_dominio', 'confirmar_newsletter', 'contacto_por_dominio', 'contenido_por_dominio',
        'destacados_por_dominio', 'enviar_consulta_contacto', 'enviar_lista_pedido', 'estado_tienda_por_dominio',
        'identidad_por_dominio', 'imagen_publica', 'legal_por_dominio', 'lista_pedido_por_dominio',
        'newsletter_por_dominio', 'opiniones_producto_por_dominio', 'pagina_por_dominio', 'paginas_por_dominio',
        'producto_por_dominio', 'redireccion_por_dominio', 'registrar_consulta_whatsapp', 'relacionados_por_dominio',
        'seo_tienda_por_dominio', 'sitemap_por_dominio', 'sugerencias_busqueda_por_dominio', 'suscribirse_newsletter',
        'tienda_por_dominio'
      ])),
  array[]::text[],
  'publico: anon solo ejecuta las funciones de la lista permitida de la tienda pública');

select is(
  (select coalesce(array_agg(esquema || '.' || nombre order by nombre), array[]::text[])
     from fn_app
    where esquema = 'public' and has_function_privilege('anon', oid, 'execute') and has_schema_privilege('anon', esquema, 'usage')
      and nombre <> all (array['bloqueo_acceso_hasta', 'registrar_fallo_acceso'])),
  array[]::text[],
  'public: anon solo ejecuta las RPC de acceso (bloqueo_acceso_hasta, registrar_fallo_acceso)');

select is(
  (select coalesce(array_agg(esquema || '.' || nombre order by esquema, nombre), array[]::text[])
     from fn_app
    where esquema in ('private', 'dominio') and has_function_privilege('anon', oid, 'execute') and has_schema_privilege('anon', esquema, 'usage')),
  array[]::text[],
  'private y dominio: anon no puede ejecutar ninguna función (sin USAGE del esquema)');

-- ---------------------------------------------------------------------------
-- 2. search_path de las funciones
-- ---------------------------------------------------------------------------
select is(
  (select coalesce(array_agg(esquema || '.' || nombre || '(' || oid::regprocedure::text || ')' order by esquema, nombre), array[]::text[])
     from fn_app where definer and not tiene_sp),
  array[]::text[],
  'ninguna función security definer carece de set search_path');

select is(
  (select coalesce(array_agg(oid::regprocedure::text order by oid::regprocedure::text), array[]::text[])
     from fn_app
    where definer and tiene_sp and not sp_vacio
      and oid <> all (array[
        to_regprocedure('private.is_superadmin()')::oid, to_regprocedure('private.organizacion_id()')::oid,
        to_regprocedure('private.puede_escribir()')::oid
      ])),
  array[]::text[],
  'toda función security definer nueva usa search_path vacío (solo 3 heredadas a revisar, MSF-899, listadas en docs/higiene-base-datos.md)');

select is(
  (select coalesce(array_agg(oid::regprocedure::text order by oid::regprocedure::text), array[]::text[])
     from fn_app where esquema = 'publico' and not sp_vacio),
  array[]::text[],
  'todas las funciones de publico tienen search_path vacío');

select is(
  (select coalesce(array_agg(oid::regprocedure::text order by oid::regprocedure::text), array[]::text[])
     from fn_app
    where oid = any (array[
      to_regprocedure('private.registrar_cambios_seguridad_usuario()')::oid, to_regprocedure('public.registrar_inicio_sesion(jsonb)')::oid,
      to_regprocedure('private.procesar_falla_orquestacion(uuid,uuid,text)')::oid, to_regprocedure('public.bloqueo_acceso_hasta(text)')::oid,
      to_regprocedure('private.purgar_evidencias_ia(timestamptz)')::oid, to_regprocedure('public.limpiar_intentos_acceso()')::oid])
      and not sp_vacio),
  array[]::text[],
  'las seis funciones migradas a search_path vacío (análisis seguro) lo conservan');

-- ---------------------------------------------------------------------------
-- 3. Tablas: privilegios de escritura sin política, anon, RLS sin política, PK
-- ---------------------------------------------------------------------------
create temp table tabla_app on commit drop as
select c.oid, n.nspname as esquema, c.relname as tabla, c.relrowsecurity as rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname in ('public', 'dominio', 'private') and c.relkind in ('r', 'p') and not c.relispartition
   and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e');

select is(
  (select coalesce(array_agg(t.esquema || '.' || t.tabla order by t.esquema, t.tabla), array[]::text[])
     from tabla_app t
    where t.esquema = 'dominio'
      and (has_table_privilege('anon', t.oid, 'select, insert, update, delete')
        or has_table_privilege('authenticated', t.oid, 'insert') and not exists (
             select 1 from pg_policy p where p.polrelid = t.oid and p.polcmd in ('a', '*') and (0 = any (p.polroles) or 'authenticated'::regrole = any (p.polroles)))
        or has_table_privilege('authenticated', t.oid, 'update') and not exists (
             select 1 from pg_policy p where p.polrelid = t.oid and p.polcmd in ('w', '*') and (0 = any (p.polroles) or 'authenticated'::regrole = any (p.polroles)))
        or has_table_privilege('authenticated', t.oid, 'delete') and not exists (
             select 1 from pg_policy p where p.polrelid = t.oid and p.polcmd in ('d', '*') and (0 = any (p.polroles) or 'authenticated'::regrole = any (p.polroles))))),
  array[]::text[],
  'dominio: ninguna tabla es escribible por anon ni por authenticated sin una política que cubra esa operación');

select is(
  (select coalesce(array_agg(esquema || '.' || tabla order by esquema, tabla), array[]::text[])
     from tabla_app
    where esquema in ('public', 'dominio', 'private') and not rls),
  array[]::text[],
  'ninguna tabla de public, dominio ni private tiene RLS desactivado (MSF-669)');

select is(
  (select coalesce(array_agg(esquema || '.' || tabla order by esquema, tabla), array[]::text[])
     from tabla_app t
    where rls and not exists (select 1 from pg_policy p where p.polrelid = t.oid)),
  array[]::text[],
  'toda tabla con RLS tiene al menos una política explícita (MSF-918)');

select is(
  (select coalesce(array_agg(t.esquema || '.' || t.tabla order by t.esquema, t.tabla), array[]::text[])
     from tabla_app t
    where t.esquema in ('public', 'dominio') and not exists (select 1 from pg_constraint k where k.conrelid = t.oid and k.contype = 'p')),
  array[]::text[],
  'toda tabla de public y dominio tiene clave primaria (MSF-922)');

select is(
  (select coalesce(array_agg(t.esquema || '.' || t.tabla order by t.tabla), array[]::text[])
     from tabla_app t
    where t.tabla in ('resumen_semanal_config', 'resumen_semanal_envios', 'opiniones_producto', 'clientes_exportaciones_ventana',
                      'clientes_exportaciones_entregas', 'limite_pedidos_publicos', 'correo_masivo_pruebas',
                      'procesos_masivos_errores_claves', 'consultas_publicas_intentos', 'exportaciones_actividad',
                      'comprobantes_venta_numeracion', 'reparacion_enlaces_consulta', 'eventos_membresia', 'intentos_acceso',
                      'avisos_pendientes', 'favoritos_cliente')
      and not exists (select 1 from pg_policy p where p.polrelid = t.oid and p.polpermissive and p.polcmd = '*'
                       and pg_get_expr(p.polqual, p.polrelid) = 'false' and pg_get_expr(p.polwithcheck, p.polrelid) = 'false')),
  array[]::text[],
  'las 16 tablas sin política de MSF-918 quedan con una política que deniega todo (using false) y no una abierta');

-- ---------------------------------------------------------------------------
-- 4. Integridad: FK validadas, FK con índice, vistas con security_invoker
-- ---------------------------------------------------------------------------
select is(
  (select coalesce(array_agg(conrelid::regclass::text || '.' || conname order by conname), array[]::text[])
     from pg_constraint
    where contype = 'f' and not convalidated and connamespace::regnamespace::text in ('public', 'dominio', 'private')),
  array[]::text[],
  'ninguna clave foránea queda NOT VALID (MSF-923)');

select is(
  (select coalesce(array_agg(k.conrelid::regclass::text || '.' || k.conname order by k.conrelid::regclass::text, k.conname), array[]::text[])
     from pg_constraint k
     join pg_class c on c.oid = k.conrelid
    where k.contype = 'f' and k.connamespace::regnamespace::text in ('public', 'dominio')
      and c.relkind in ('r', 'p') and not c.relispartition
      -- excepciones del criterio documentado: autoría (auth.users, on delete set null) y catálogos chicos
      and not (k.confrelid = 'auth.users'::regclass and k.confdeltype = 'n')
      and k.confrelid::regclass::text not in ('sistemas_externos', 'ia_perfiles_modelo', 'capacidades_proveedores', 'roles_organizacion',
                                             'dominio.alicuotas_iva', 'dominio.estados_reparacion', 'dominio.motivos_movimiento')
      and not exists (
        select 1 from pg_index i
         where i.indrelid = k.conrelid and i.indisvalid and i.indpred is null
           and (select array_agg(x order by x) from unnest((i.indkey::int2[])[0:array_length(k.conkey, 1) - 1]) x)
             = (select array_agg(x order by x) from unnest(k.conkey) x))),
  array[]::text[],
  'toda clave foránea tiene índice que la cubra, salvo autoría y catálogos chicos (MSF-918)');

select is(
  (select coalesce(array_agg(n.nspname || '.' || c.relname order by c.relname), array[]::text[])
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'v' and n.nspname in ('public', 'dominio', 'publico', 'private')
      and not coalesce(c.reloptions::text[] @> array['security_invoker=true'], false)
      and c.relname <> 'proveedores_basico'),
  array[]::text[],
  'toda vista usa security_invoker = true, salvo public.proveedores_basico (definer a propósito, MSF-918)');

select ok(
  (select c.reloptions::text[] @> array['security_invoker=false'] from pg_class c where c.oid = 'public.proveedores_basico'::regclass)
  and not has_table_privilege('anon', 'public.proveedores_basico', 'select'),
  'proveedores_basico sigue declarando su excepción (security_invoker=false) y anon no la lee');

select * from finish();
rollback;
