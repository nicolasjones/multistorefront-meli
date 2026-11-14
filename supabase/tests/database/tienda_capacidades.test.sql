-- MSF-176 · Tienda compra y cuentas, T001 (FR-014, D-19, D-27): bandera `tienda_pedidos` apagada por defecto y
-- `publico.capacidades_tienda_por_dominio(host)`: solo informa el estado de la bandera, con host desconocido = empresa
-- desactivada (tienda pausada) = el mismo error, solo las claves del contrato y anon sin acceso a la tabla de banderas.
begin;

select plan(17);

insert into organizaciones (id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Organización Uno');

insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda activa', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda pausada', false);
insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'cap-activa.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'cap-pausada.ejemplo.com');

-- ============================================================================
-- La bandera existe y está apagada por defecto (D-19)
-- ============================================================================
select is(
  (select activa from public.banderas_plataforma where clave = 'tienda_pedidos'),
  false, 'la bandera tienda_pedidos existe y está apagada por defecto');
select is(private.bandera_activa('tienda_pedidos'), false, 'private.bandera_activa la ve apagada');

-- ============================================================================
-- Apagada: pedidos = false, para visitante y para sesión
-- ============================================================================
set local role anon;
select is(
  publico.capacidades_tienda_por_dominio('cap-activa.ejemplo.com'),
  jsonb_build_object('estado', 'ok', 'pedidos', false),
  'anon con la bandera apagada: pedidos = false');
reset role;

-- Encendida: pedidos = true (el host se normaliza igual que en el resto de la tienda).
update public.banderas_plataforma set activa = true where clave = 'tienda_pedidos';
set local role anon;
select is(
  publico.capacidades_tienda_por_dominio('cap-activa.ejemplo.com'),
  jsonb_build_object('estado', 'ok', 'pedidos', true),
  'anon con la bandera encendida: pedidos = true');
select is(
  publico.capacidades_tienda_por_dominio('CAP-ACTIVA.ejemplo.com:443'),
  jsonb_build_object('estado', 'ok', 'pedidos', true),
  'el host se normaliza (mayúsculas y puerto)');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(
  publico.capacidades_tienda_por_dominio('cap-activa.ejemplo.com'),
  jsonb_build_object('estado', 'ok', 'pedidos', true),
  'authenticated recibe el mismo valor');
reset role;

-- ============================================================================
-- Host desconocido, empresa desactivada y tienda pausada: el mismo error
-- ============================================================================
set local role anon;
select is(
  publico.capacidades_tienda_por_dominio('desconocido.ejemplo.com'),
  jsonb_build_object('estado', 'error'), 'host desconocido: error');
select is(
  publico.capacidades_tienda_por_dominio('cap-pausada.ejemplo.com'),
  jsonb_build_object('estado', 'error'), 'empresa desactivada (tienda pausada): el mismo error');
select is(
  publico.capacidades_tienda_por_dominio(null),
  jsonb_build_object('estado', 'error'), 'host nulo: el mismo error');
reset role;

-- ============================================================================
-- Solo las claves del contrato: nada de la empresa, la organización ni otras banderas
-- ============================================================================
select is(
  (select array_agg(k order by k) from jsonb_object_keys(publico.capacidades_tienda_por_dominio('cap-activa.ejemplo.com')) k),
  array['estado', 'pedidos'], 'la respuesta tiene exactamente estado y pedidos');

-- ============================================================================
-- Privilegios: anon y authenticated ejecutan la función; anon no lee la tabla de banderas; la bandera no se enciende sola
-- ============================================================================
select ok(has_function_privilege('anon', 'publico.capacidades_tienda_por_dominio(text)', 'execute'), 'anon ejecuta capacidades_tienda_por_dominio');
select ok(has_function_privilege('authenticated', 'publico.capacidades_tienda_por_dominio(text)', 'execute'), 'authenticated ejecuta capacidades_tienda_por_dominio');
select ok(not has_table_privilege('anon', 'public.banderas_plataforma', 'select'), 'anon no lee public.banderas_plataforma');
select is(
  (select p.prosecdef and p.proconfig = array['search_path=""'] from pg_proc p
    where p.oid = 'publico.capacidades_tienda_por_dominio(text)'::regprocedure),
  true, 'la función es security definer con search_path vacío');

-- ============================================================================
-- Superficie de anon en `publico`: lista CERRADA (FR-014, amenazas de la épica)
-- ============================================================================
-- Solo estas funciones de `publico` son ejecutables por anon. Una función nueva de la tienda que sume superficie pública tiene que
-- sumarse acá a propósito (esta prueba falla si aparece una más o si falta una); la épica agrega de a una por historia:
-- `capacidades_tienda_por_dominio` (esta), y luego `lista_pedido_por_dominio` y `enviar_lista_pedido` (B1).
select is(
  (select array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text)
     from pg_proc p
    where p.pronamespace = 'publico'::regnamespace and has_function_privilege('anon', p.oid, 'execute')),
  (select array_agg(f order by f) from unnest(array[
    'publico.analitica_por_dominio(text)',
    'publico.busqueda_pagina_por_dominio(text,text,uuid,boolean,numeric,text,integer)',
    'publico.capacidades_tienda_por_dominio(text)',
    'publico.catalogo_pagina_por_dominio(text,uuid,boolean,numeric,text,integer)',
    'publico.catalogo_visible_por_dominio(text)',
    'publico.categorias_por_dominio(text)',
    'publico.contacto_por_dominio(text)',
    'publico.contenido_por_dominio(text)',
    'publico.destacados_por_dominio(text)',
    'publico.enviar_consulta_contacto(text,text,text,text,uuid)',
    'publico.estado_tienda_por_dominio(text)',
    'publico.identidad_por_dominio(text)',
    'publico.imagen_publica(text)',
    'publico.legal_por_dominio(text)',
    'publico.pagina_por_dominio(text,text)',
    'publico.paginas_por_dominio(text)',
    'publico.producto_por_dominio(text,uuid)',
    'publico.redireccion_por_dominio(text)',
    'publico.registrar_consulta_whatsapp(text,uuid,uuid)',
    'publico.registrar_interes_whatsapp(text,uuid)',
    'publico.relacionados_por_dominio(text,uuid)',
    'publico.seo_tienda_por_dominio(text)',
    'publico.sitemap_por_dominio(text)',
    'publico.sugerencias_busqueda_por_dominio(text,text)',
    'publico.tienda_por_dominio(text)'
  ]) f),
  'la lista de funciones de publico ejecutables por anon es exactamente la esperada');
select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'publico'::regnamespace
      and p.proname in ('mis_compras_por_dominio', 'mi_compra_por_dominio', 'cambiar_favorito_por_dominio',
                        'mis_favoritos_por_dominio', 'favoritos_entre_por_dominio')
      and has_function_privilege('anon', p.oid, 'execute')),
  0, 'ninguna RPC de cuenta de la historia A es ejecutable por anon');
select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'private' ::regnamespace
      and p.proname in ('cuenta_de_tienda', 'estado_publico_comprobante')
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  0, 'los helpers private de la historia A no son ejecutables por la API');

select * from finish();
rollback;
