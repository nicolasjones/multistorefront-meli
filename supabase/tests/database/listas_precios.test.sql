-- F-PRE-14 (MSF-442, spec 20270327-100000-listas-de-precios-por-cliente, Fase 1): listas de precios.
-- Cubre RF-PRE-14-1…4, RF-LP-1…3 y SC-003: estructura y topes del porcentaje, nombre único sin mayúsculas, solo el
-- Administrador escribe, bloqueo optimista, archivar y restaurar, eventos de Actividad con valor anterior y nuevo,
-- aislamiento entre organizaciones, grants exactos y `anon` sin privilegios. No cambia ningún precio.
begin;

select plan(78);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'operador-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'consulta-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

-- Las escrituras exigen la bandera encendida (su comportamiento apagado se prueba en listas_precios_bandera).
update public.banderas_plataforma set activa = true where clave = 'listas_precios';

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create function pg_temp.actualizado(p_id uuid) returns timestamptz language sql security definer as $$
  select updated_at from dominio.listas_precios where id = p_id
$$;

-- ============================================================================
-- Estructura (RF-PRE-14-1, RF-LP-1)
-- ============================================================================

select has_table('dominio', 'listas_precios', 'existe dominio.listas_precios (esquema por naturaleza)');
select col_type_is('dominio', 'listas_precios', 'ajuste_pct', 'numeric(5,2)', 'el ajuste es numeric(5,2)');
select col_not_null('dominio', 'listas_precios', 'nombre', 'el nombre es obligatorio');
select is((select relrowsecurity from pg_class where oid = 'dominio.listas_precios'::regclass), true, 'RLS activada');
select is(
  (select count(*)::int from pg_policies where schemaname = 'dominio' and tablename = 'listas_precios' and cmd in ('DELETE', 'ALL', 'INSERT', 'UPDATE')),
  0, 'sin política de escritura ni DELETE');
select is(
  (select count(*)::int from pg_policies where schemaname = 'dominio' and tablename = 'listas_precios' and cmd = 'SELECT'),
  1, 'una única política de lectura');
select has_index('dominio', 'listas_precios', 'listas_precios_nombre_uq', 'índice único del nombre por organización');

select is(has_table_privilege('anon', 'dominio.listas_precios', 'select'), false, 'anon no lee la tabla');
select is(has_table_privilege('anon', 'dominio.listas_precios', 'insert'), false, 'anon no inserta');
select is(has_table_privilege('anon', 'public.listas_precios_resumen', 'select'), false, 'anon no lee la vista');
select is(has_table_privilege('authenticated', 'dominio.listas_precios', 'select'), true, 'authenticated lee la tabla');
select is(has_table_privilege('authenticated', 'dominio.listas_precios', 'insert'), false, 'authenticated no inserta directo');
select is(has_table_privilege('authenticated', 'dominio.listas_precios', 'update'), false, 'authenticated no actualiza directo');
select is(has_table_privilege('authenticated', 'dominio.listas_precios', 'delete'), false, 'sin delete para authenticated');
select is(has_table_privilege('authenticated', 'public.listas_precios_resumen', 'select'), true, 'authenticated lee la vista');

select is(has_function_privilege('anon', 'public.guardar_lista_precios(uuid, text, text, numeric, timestamptz)', 'execute'), false, 'anon no ejecuta guardar_lista_precios');
select is(has_function_privilege('anon', 'public.archivar_lista_precios(uuid, timestamptz)', 'execute'), false, 'anon no ejecuta archivar_lista_precios');
select is(has_function_privilege('anon', 'public.restaurar_lista_precios(uuid, timestamptz)', 'execute'), false, 'anon no ejecuta restaurar_lista_precios');
select is(has_function_privilege('authenticated', 'public.guardar_lista_precios(uuid, text, text, numeric, timestamptz)', 'execute'), true, 'authenticated ejecuta guardar_lista_precios');
select is(has_function_privilege('authenticated', 'public.archivar_lista_precios(uuid, timestamptz)', 'execute'), true, 'authenticated ejecuta archivar_lista_precios');
select is(has_function_privilege('authenticated', 'public.restaurar_lista_precios(uuid, timestamptz)', 'execute'), true, 'authenticated ejecuta restaurar_lista_precios');
select is(has_function_privilege('authenticated', 'private.cantidad_clientes_lista(uuid)', 'execute'), false, 'el conteo interno no se ejecuta desde la API');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('guardar_lista_precios', 'archivar_lista_precios', 'restaurar_lista_precios')
      and p.prosecdef and p.proconfig @> array['search_path=""']),
  3, 'las tres RPC son security definer con search_path vacío');

-- ============================================================================
-- Alta, nombre único y topes del porcentaje (RF-PRE-14-1, CA-PRE-14-1 y CA-PRE-14-3)
-- ============================================================================

create temp table t_ids (clave text primary key, id uuid);
grant all on t_ids to authenticated;

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

insert into t_ids select 'rev', public.guardar_lista_precios(null, '  Revendedores ', 'Para revendedores', -20, null);

reset role;
select is((select count(*)::int from dominio.listas_precios where organizacion_id = '11111111-1111-1111-1111-111111111111'), 1, 'la lista queda creada');
select is((select nombre from dominio.listas_precios), 'Revendedores', 'el nombre se guarda sin espacios sobrantes');
select is((select ajuste_pct from dominio.listas_precios), -20.00::numeric, 'el ajuste se guarda con 2 decimales');
select is((select archivada_en from dominio.listas_precios), null, 'nace activa');
select is(
  (select count(*)::int from public.registro_actividad where tipo = 'lista_precios.creada' and detalle like '%Revendedores%'),
  1, 'la Actividad registra el alta');

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  public.guardar_lista_precios(null, 'revendedores', 'Para revendedores', -20, null),
  (select id from t_ids where clave = 'rev'),
  'repetir el alta con los mismos datos es idempotente');
select throws_ok(
  $$select public.guardar_lista_precios(null, 'REVENDEDORES', null, -10, null)$$,
  '23505', null, 'el mismo nombre (sin mayúsculas) con otros datos se rechaza');
select throws_ok(
  $$select public.guardar_lista_precios(null, 'Con  espacios', null, 5, null); select public.guardar_lista_precios(null, ' con espacios', null, 6, null)$$,
  '23505', null, 'los espacios de más no distinguen nombres');
select throws_ok($$select public.guardar_lista_precios(null, 'Alta', null, 100.01, null)$$, '23514', null, '+100,01 % se rechaza');
select throws_ok($$select public.guardar_lista_precios(null, 'Baja', null, -90.01, null)$$, '23514', null, '-90,01 % se rechaza');
select throws_ok($$select public.guardar_lista_precios(null, 'Decimales', null, 12.345, null)$$, '22003', null, 'más de 2 decimales se rechaza');
select throws_ok($$select public.guardar_lista_precios(null, 'Sin ajuste', null, null, null)$$, '23514', null, 'el ajuste es obligatorio');
select throws_ok($$select public.guardar_lista_precios(null, '   ', null, 5, null)$$, '22023', null, 'nombre vacío se rechaza');
select throws_ok($$select public.guardar_lista_precios(null, repeat('x', 81), null, 5, null)$$, '22023', null, 'nombre de más de 80 caracteres se rechaza');
select throws_ok($$select public.guardar_lista_precios(null, 'Larga', repeat('x', 301), 5, null)$$, '22023', null, 'descripción de más de 300 caracteres se rechaza');
select lives_ok($$select public.guardar_lista_precios(null, 'Tope bajo', null, -90, null)$$, '-90 % es válido');
select lives_ok($$select public.guardar_lista_precios(null, 'Tope alto', null, 100, null)$$, '+100 % es válido');
select lives_ok($$select public.guardar_lista_precios(null, 'Precio central', null, 0, null)$$, '0 % es válido');

reset role;
select is((select count(*)::int from dominio.listas_precios), 4, 'los rechazos no escribieron nada (4 listas válidas)');
select throws_ok(
  $$update dominio.listas_precios set ajuste_pct = 150 where nombre = 'Tope alto'$$,
  '23514', null, 'la base rechaza un ajuste fuera de rango aun sin pasar por la RPC');

-- ============================================================================
-- Edición con bloqueo optimista y eventos (RF-PRE-14-2 y RF-PRE-14-4, CA-PRE-14-2)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok(
  format($$select public.guardar_lista_precios(%L, 'Revendedores', 'Para revendedores', -25, %L)$$,
         (select id from t_ids where clave = 'rev'), '2000-01-01 00:00:00+00'),
  'PT412', null, 'una edición con un updated_at viejo se rechaza');
select lives_ok(
  format($$select public.guardar_lista_precios(%L, 'Revendedores', 'Para revendedores', -25, %L)$$,
         (select id from t_ids where clave = 'rev'), pg_temp.actualizado((select id from t_ids where clave = 'rev'))),
  'editar con el updated_at vigente funciona');
select is((select ajuste_pct from public.listas_precios_resumen where nombre = 'Revendedores'), -25.00::numeric, 'el porcentaje nuevo queda guardado');
select is(
  (select count(*)::int from public.registro_actividad
    where tipo = 'lista_precios.editada' and valor_anterior ->> 'ajuste_pct' = '-20.00' and valor_nuevo ->> 'ajuste_pct' = '-25.00'),
  1, 'la Actividad guarda el porcentaje anterior y el nuevo');
select lives_ok(
  format($$select public.guardar_lista_precios(%L, 'Revendedores', 'Para revendedores', -25, null)$$,
         (select id from t_ids where clave = 'rev')),
  'guardar lo ya guardado es idempotente aunque no se mande updated_at');
select is((select count(*)::int from public.registro_actividad where tipo = 'lista_precios.editada'), 1, 'y no repite el evento');
select throws_ok(
  format($$select public.guardar_lista_precios(%L, 'tope alto', null, -25, %L)$$,
         (select id from t_ids where clave = 'rev'), pg_temp.actualizado((select id from t_ids where clave = 'rev'))),
  '23505', null, 'renombrar a un nombre existente se rechaza');
select throws_ok(
  $$select public.guardar_lista_precios('99999999-9999-9999-9999-999999999999', 'X', null, 1, now())$$,
  'PT404', null, 'editar una lista inexistente da PT404');

-- ============================================================================
-- Archivar y restaurar (RF-PRE-14-3, CA-PRE-14-4)
-- ============================================================================

select throws_ok(
  format($$select public.archivar_lista_precios(%L, %L)$$, (select id from t_ids where clave = 'rev'), '2000-01-01 00:00:00+00'),
  'PT412', null, 'archivar con un updated_at viejo se rechaza');
select lives_ok(
  format($$select public.archivar_lista_precios(%L, %L)$$, (select id from t_ids where clave = 'rev'), pg_temp.actualizado((select id from t_ids where clave = 'rev'))),
  'una lista sin clientes se archiva');
select isnt((select archivada_en from public.listas_precios_resumen where nombre = 'Revendedores'), null, 'queda archivada');
select lives_ok(
  format($$select public.archivar_lista_precios(%L, null)$$, (select id from t_ids where clave = 'rev')),
  'archivar lo ya archivado no falla');
select is((select count(*)::int from public.registro_actividad where tipo = 'lista_precios.archivada'), 1, 'y no repite el evento');
select lives_ok(
  format($$select public.restaurar_lista_precios(%L, %L)$$, (select id from t_ids where clave = 'rev'), pg_temp.actualizado((select id from t_ids where clave = 'rev'))),
  'una lista archivada se restaura');
select is((select archivada_en from public.listas_precios_resumen where nombre = 'Revendedores'), null, 'vuelve a estar activa');
select is((select count(*)::int from public.registro_actividad where tipo = 'lista_precios.restaurada'), 1, 'la Actividad registra la restauración');
select is((select clientes_asignados from public.listas_precios_resumen where nombre = 'Revendedores'), 0::bigint, 'la vista cuenta 0 clientes');

-- ============================================================================
-- Permisos por rol (RF-PRE-14-2, CA-PRE-14-5)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select throws_ok($$select public.guardar_lista_precios(null, 'Del operador', null, 5, null)$$, '42501', null, 'un operador no crea listas');
select throws_ok(
  format($$select public.archivar_lista_precios(%L, null)$$, (select id from t_ids where clave = 'rev')),
  '42501', null, 'un operador no archiva');
select throws_ok(
  format($$select public.restaurar_lista_precios(%L, null)$$, (select id from t_ids where clave = 'rev')),
  '42501', null, 'un operador no restaura');
select cmp_ok((select count(*)::int from public.listas_precios_resumen), '>=', 1, 'un operador ve las listas');
select throws_ok(
  $$insert into dominio.listas_precios (organizacion_id, nombre, ajuste_pct) values ('11111111-1111-1111-1111-111111111111', 'Directa', 5)$$,
  '42501', null, 'la escritura directa está negada');
select throws_ok(
  $$delete from dominio.listas_precios$$,
  '42501', null, 'no hay DELETE directo');

select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select throws_ok($$select public.guardar_lista_precios(null, 'De consulta', null, 5, null)$$, '42501', null, 'un rol de consulta no crea listas');
select cmp_ok((select count(*)::int from public.listas_precios_resumen), '>=', 1, 'un rol de consulta ve las listas (lectura)');

-- ============================================================================
-- Aislamiento entre organizaciones (RF-LP-1, CA-PRE-14-6, SC-003)
-- ============================================================================

select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.listas_precios_resumen), 0, 'otra organización no ve las listas ajenas');
select is((select count(*)::int from dominio.listas_precios), 0, 'ni la tabla');
select throws_ok(
  format($$select public.archivar_lista_precios(%L, null)$$, (select id from t_ids where clave = 'rev')),
  'PT404', null, 'no archiva una lista ajena');
select throws_ok(
  format($$select public.guardar_lista_precios(%L, 'Robada', null, 1, now())$$, (select id from t_ids where clave = 'rev')),
  'PT404', null, 'no edita una lista ajena');
select lives_ok($$select public.guardar_lista_precios(null, 'Revendedores', null, -30, null)$$, 'el mismo nombre en otra organización es válido');

-- ============================================================================
-- anon (RF-LP-1)
-- ============================================================================

reset role;
set local role anon;
select throws_ok($$select * from dominio.listas_precios$$, '42501', null, 'anon no lee la tabla');
select throws_ok($$select * from public.listas_precios_resumen$$, '42501', null, 'anon no lee la vista');
select throws_ok($$select public.guardar_lista_precios(null, 'Anon', null, 5, null)$$, '42501', null, 'anon no ejecuta la RPC');
reset role;

-- ============================================================================
-- Sin efecto en precios (la fase no toca el motor)
-- ============================================================================

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname in ('precio_para', 'precio_para_calculo', 'precio_linea_venta', 'precio_linea_venta_calculo')
      and p.prosrc ilike '%dominio.listas_precios%'),
  0, 'ninguna función del motor de precio lee la tabla de listas: la lectura vive en private.lista_precios_cliente (Fase 3)');

-- Solo estas funciones leen la tabla de listas (la lectura del motor vive únicamente en private.lista_precios_cliente): si aparece otra,
-- esta prueba obliga a revisarla.
select is(
  (select array_agg(n.nspname || '.' || p.proname order by n.nspname, p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private', 'publico', 'dominio', 'analitica') and p.prosrc ilike '%dominio.listas_precios%'),
  -- Lote 93: la asignación masiva y por tipo, el conteo de clientes por lista (hereda por tipo), la lista para la exportación de clientes y
  -- la analítica de ventas por lista leen la tabla (la coincidencia incluye `dominio.listas_precios_tipo_cliente`); ninguna es del motor de precio.
  array['private.cantidad_clientes_lista', 'private.lista_precios_cliente', 'private.validar_lista_precio_cliente',
        'public.archivar_lista_precios', 'public.asignar_lista_precios_cliente', 'public.asignar_lista_precios_masiva',
        'public.asignar_lista_precios_tipo_cliente', 'public.guardar_lista_precios', 'public.listas_de_clientes_para_exportar',
        'public.obtener_comprobante', 'public.restaurar_lista_precios', 'public.ventas_por_lista_precios',
        'public.vista_previa_fusion_clientes']::text[],
  'solo la administración de listas, la asignación (una, masiva y por tipo), la exportación y la analítica por lista, la marca del comprobante y private.lista_precios_cliente leen dominio.listas_precios (ninguna otra función del motor ni de la tienda)');

select * from finish();
rollback;
