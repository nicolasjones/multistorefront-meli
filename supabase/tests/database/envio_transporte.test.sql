-- F-VTA-16 (MSF-166, épica MSF-135, spec 20261024-130000-ventas-despacho-y-faltantes): transporte,
-- guía y fecha de envío de la factura (FR-020, FR-021 y FR-022).
--
-- Cubre T013 (FR-020):
--   · `dominio.comprobantes_venta` gana `transporte_id`, `guia` y `fecha_envio`.
--   · La FK es COMPUESTA (transporte_id, organizacion_id) → `dominio.transportes (id, organizacion_id)`: un
--     comprobante no puede apuntar a un transporte de otra organización.
--   · La guía tiene un check de 100 caracteres.
--   · Sin políticas ni grants de escritura nuevos: la tabla se escribe solo por la RPC; `anon` sin acceso.
--
-- Cubre T014 (FR-021):
--   · `guardar_envio_comprobante` guarda transporte, guía y fecha de envío de una factura confirmada NO
--     entregada.
--   · Transporte inactivo, de otra tienda o de otra organización: se rechaza.
--   · Permiso: la acción `despachar` o Ventas en `edicion`, resueltos en la empresa del comprobante.
--   · Bloqueo optimista (`40001`), idempotencia y guía de más de 100 caracteres.
--   · Presupuesto, borrador y factura ya entregada: se rechazan sin cambios.
--   · Aislamiento por organización y por empresa.
--
-- Cubre T015 (FR-022):
--   · El disparador `before update of estado_despacho` rechaza pasar a `entregado` cuando la forma de envío
--     exige transporte y guía y falta alguno de los dos; el error dice QUÉ falta.
--   · Falta uno de los dos: con la guía pero sin transporte, y con el transporte pero sin guía (una guía en
--     blanco es una guía ausente).
--   · La exigencia vive en la BASE: una escritura directa tampoco puede marcar «entregado» sin envío.
--   · «Retiro en local» (forma que no lo exige) se entrega sin transporte ni guía.
--   · Todo o nada: el rechazo no descuenta las reservas «A pedido» ni la deja entregada.
--   · Permisos y aislamiento: sin la acción `despachar` no se entrega y otra organización no toca la factura.
--
begin;

select no_plan();

-- ============================================================================
-- Datos: dos organizaciones, dos tiendas de la Uno, el equipo y sus roles
-- ============================================================================

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('f1000000-0000-0000-0000-000000000002', 'deposito@example.com'),
  ('f1000000-0000-0000-0000-000000000003', 'mostrador@example.com'),
  ('f1000000-0000-0000-0000-000000000004', 'consulta@example.com'),
  ('f1000000-0000-0000-0000-000000000005', 'miembro@example.com'),
  ('f2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'deposito', 'activo'),
  ('f1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'mostrador', 'activo'),
  ('f1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('f1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'miembro', 'activo'),
  ('f2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Otra tienda'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'deposito'),
  ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'mostrador'),
  ('f1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('f1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'miembro'),
  ('f2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administracion');

-- La empresa activa de cada uno: el permiso se resuelve en la empresa, no en la barra.
insert into public.usuario_empresa_activa (user_id, empresa_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001'),
  ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001'),
  ('f1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001'),
  ('f1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000001'),
  ('f2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001');

insert into clientes (id, organizacion_id, numero, nombre, tipo, archivado_en) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Cliente Uno', 'minorista', null),
  ('c5000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 11, 'Cliente Dos', 'minorista', null);

insert into dominio.categorias (id, organizacion_id, nombre) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joysticks');

insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, categoria_id, disponibilidad_manual, activo) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 'ARS', 1000, 'c1000000-0000-0000-0000-000000000001', null, true),
  -- «A pedido»: reserva al confirmar y se descuenta al entregar (para ver que el rechazo del envío no la toca).
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Consola', 'CON-1', 'ARS', 2000, 'c1000000-0000-0000-0000-000000000001', 'a_pedido', true);

create temp table datos as
  select (select id from dominio.depositos
           where organizacion_id = '11111111-1111-1111-1111-111111111111' and por_defecto) as principal;
grant select on datos to public;

-- El depósito por defecto sirve a las dos tiendas de la Uno (las líneas eligen el depósito de la tienda).
insert into dominio.depositos_empresas (deposito_id, empresa_id, organizacion_id)
select principal, e.empresa_id, '11111111-1111-1111-1111-111111111111'
  from datos
  cross join (values ('a1000000-0000-0000-0000-000000000001'::uuid),
                    ('a1000000-0000-0000-0000-000000000002'::uuid)) as e(empresa_id);

-- El trigger `productos_crear_existencias` ya crea la fila de existencias: se actualiza la cantidad.
insert into dominio.existencias (producto_id, organizacion_id, cantidad, reservado)
select p, '11111111-1111-1111-1111-111111111111', c, 0
  from (values
    ('b1000000-0000-0000-0000-000000000001'::uuid, 100),
    ('b1000000-0000-0000-0000-000000000002'::uuid, 6)
  ) as x(p, c)
on conflict (producto_id) do update
   set cantidad = excluded.cantidad, reservado = 0, updated_at = now();

insert into dominio.existencias_deposito (producto_id, deposito_id, organizacion_id, cantidad, reservado)
select p, principal, '11111111-1111-1111-1111-111111111111', c, 0
  from (values
    ('b1000000-0000-0000-0000-000000000001'::uuid, 100),
    ('b1000000-0000-0000-0000-000000000002'::uuid, 6)
  ) as x(p, c), datos;

-- Formas de envío de la tienda: una exige transporte y guía, la otra no.
insert into dominio.formas_envio (id, organizacion_id, empresa_id, nombre, tipo, exige_transporte_guia, estado_despacho_inicial) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001',
   'Expreso', 'expreso', true, 'listo_para_despachar'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001',
   'Retiro en local', 'retiro_local', false, 'sin_armar');

-- Transportes: uno activo y usado en la tienda, uno inactivo, uno de otra tienda y uno de otra organización.
insert into dominio.transportes (id, organizacion_id, nombre, tipo, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Expreso Uno', 'expreso', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Expreso Inactivo', 'expreso', false),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Expreso De Otra Tienda', 'expreso', true),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Transporte De La Dos', 'correo', true);

insert into dominio.transportes_empresas (transporte_id, empresa_id, organizacion_id) values
  ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('e1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('e1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111');

-- ============================================================================
-- Ayudas
-- ============================================================================

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create temp table comps (clave text primary key, id uuid);
grant select, insert on comps to public;

-- Marca de tiempo: sirve para comparar el `updated_at` antes y después de un guardado idempotente.
create temp table sello (clave text primary key, ts timestamptz);
grant select, insert on sello to public;

-- Factura con su línea, en la tienda y con la forma de envío indicadas.
create function pg_temp.armar(p_clave text, p_tipo text, p_empresa uuid, p_cliente uuid, p_envio uuid)
returns void language plpgsql as $$
declare v_c dominio.comprobantes_venta;
begin
  v_c := public.crear_comprobante(p_tipo, p_empresa, p_cliente, 'mostrador', '2026-12-14', null, null, p_envio);
  insert into comps (clave, id) values (p_clave, v_c.id);
  perform public.guardar_lineas_comprobante(v_c.id, jsonb_build_array(
    jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000001', 'cantidad', 1)), v_c.updated_at);
end $$;

create function pg_temp.id_de(p_clave text) returns uuid language sql as $$
  select id from comps where clave = p_clave $$;

-- `updated_at` vigente: es el bloqueo optimista de `guardar_envio_comprobante`.
create function pg_temp.actualizado(p_clave text) returns timestamptz language sql security definer as $$
  select updated_at from dominio.comprobantes_venta where id = (select id from comps where clave = p_clave) $$;

-- La RPC de envío, con el `updated_at` vigente de la fila.
create function pg_temp.guardar(p_clave text, p_transporte uuid, p_guia text, p_fecha date)
returns dominio.comprobantes_venta language sql as $$
  select public.guardar_envio_comprobante(
    (select id from comps where clave = p_clave), p_transporte, p_guia, p_fecha, pg_temp.actualizado(p_clave)) $$;

-- Factura con las líneas que se le pidan (el orden de la línea es el del arreglo).
create function pg_temp.armar_lineas(p_clave text, p_tipo text, p_empresa uuid, p_cliente uuid, p_envio uuid, p_lineas jsonb)
returns void language plpgsql as $$
declare v_c dominio.comprobantes_venta;
begin
  v_c := public.crear_comprobante(p_tipo, p_empresa, p_cliente, 'mostrador', '2026-12-14', null, null, p_envio);
  insert into comps (clave, id) values (p_clave, v_c.id);
  perform public.guardar_lineas_comprobante(v_c.id, p_lineas, v_c.updated_at);
end $$;

-- Un paso del despacho, con el `updated_at` vigente de la fila.
create function pg_temp.avanzar(p_clave text, p_estado text, p_responsable uuid)
returns dominio.comprobantes_venta language sql as $$
  select public.cambiar_estado_despacho(
    (select id from comps where clave = p_clave), p_estado, p_responsable, pg_temp.actualizado(p_clave)) $$;

-- La entrega del despacho.
create function pg_temp.entregar(p_clave text, p_responsable uuid)
returns dominio.comprobantes_venta language sql as $$
  select public.cambiar_estado_despacho(
    (select id from comps where clave = p_clave), 'entregado', p_responsable, pg_temp.actualizado(p_clave)) $$;

-- La entrega, como sentencia (para los `throws_ok` y para mirar el mensaje del error).
create function pg_temp.sql_entregar(p_clave text, p_responsable uuid) returns text language sql as $$
  select format($entrega$select public.cambiar_estado_despacho(%L, 'entregado', %L::uuid, %L::timestamptz)$entrega$,
    pg_temp.id_de(p_clave), p_responsable, pg_temp.actualizado(p_clave)) $$;

-- El mensaje del error que tira una sentencia: sirve para verificar que el rechazo dice QUÉ falta.
create function pg_temp.mensaje_de_error(p_sql text) returns text language plpgsql as $$
declare v_msg text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_msg = message_text;
  return v_msg;
end $$;

-- Estado de la reserva «A pedido» de una línea del comprobante.
create function pg_temp.estado_reserva(p_clave text, p_linea integer) returns text language sql security definer as $$
  select estado from dominio.reservas_stock
   where referencia = 'comprobante:' || (select id from comps where clave = p_clave) || ':linea:' || p_linea $$;

-- Salidas de stock de un producto: el rechazo de la entrega no puede dejar ninguna.
create function pg_temp.salidas(p_producto uuid) returns integer language sql security definer as $$
  select count(*)::int from dominio.movimientos_stock
   where producto_id = p_producto and tipo = 'salida' $$;

-- ============================================================================
-- FR-020 · Las columnas del envío y su frontera de datos
-- ============================================================================

select has_column('dominio', 'comprobantes_venta', 'transporte_id', 'la factura tiene transporte');
select has_column('dominio', 'comprobantes_venta', 'guia', 'la factura tiene guía');
select has_column('dominio', 'comprobantes_venta', 'fecha_envio', 'la factura tiene fecha de envío');

-- La FK es compuesta: (transporte_id, organizacion_id) → dominio.transportes (id, organizacion_id).
-- Se comprueba contra el catálogo (no contra el texto), así el test no depende de cómo lo formatee Postgres.
select ok(
  (select count(*) = 2
     from pg_constraint c
     join unnest(c.conkey, c.confkey) as k(attnum, refattnum) on true
     join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
     join pg_attribute r on r.attrelid = c.confrelid and r.attnum = k.refattnum
    where c.conname = 'comprobantes_venta_transporte_fk'
      and c.conrelid = 'dominio.comprobantes_venta'::regclass
      and c.confrelid = 'dominio.transportes'::regclass
      and (a.attname, r.attname) in (('transporte_id', 'id'), ('organizacion_id', 'organizacion_id'))),
  'la FK del transporte es compuesta y va a dominio.transportes (id, organizacion_id)');

select ok(
  exists (select 1 from pg_constraint
           where conname = 'comprobantes_venta_guia_ck'
             and conrelid = 'dominio.comprobantes_venta'::regclass
             and contype = 'c'),
  'la guía tiene un check de longitud');

-- La RLS vigente no cambia y no hay grants de escritura: el envío se escribe solo por la RPC.
select ok(
  (select relrowsecurity from pg_class where oid = 'dominio.comprobantes_venta'::regclass),
  'la tabla de comprobantes sigue con RLS');

select is(
  has_table_privilege('authenticated', 'dominio.comprobantes_venta', 'SELECT'),
  true, 'authenticated lee los comprobantes');

select is(
  has_table_privilege('authenticated', 'dominio.comprobantes_venta', 'INSERT'),
  false, 'authenticated no inserta comprobantes');

select is(
  has_table_privilege('authenticated', 'dominio.comprobantes_venta', 'UPDATE'),
  false, 'authenticated no actualiza comprobantes');

select is(
  has_table_privilege('anon', 'dominio.comprobantes_venta', 'SELECT'),
  false, 'anon no lee los comprobantes');

-- ============================================================================
-- FR-021 · Guardar el envío de una factura confirmada no entregada
-- ============================================================================

-- Las facturas las crea y confirma el Administrador (Ventas en edición).
select pg_temp.como('f1000000-0000-0000-0000-000000000001');

select pg_temp.armar('f1', 'factura', 'a1000000-0000-0000-0000-000000000001',
  'c5000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001');
select pg_temp.armar('f2', 'factura', 'a1000000-0000-0000-0000-000000000001',
  'c5000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002');
select pg_temp.armar('f3', 'presupuesto', 'a1000000-0000-0000-0000-000000000001',
  'c5000000-0000-0000-0000-000000000001', null);
select pg_temp.armar('f4', 'factura', 'a1000000-0000-0000-0000-000000000001',
  'c5000000-0000-0000-0000-000000000001', null);
select pg_temp.armar('f5', 'factura', 'a1000000-0000-0000-0000-000000000002',
  'c5000000-0000-0000-0000-000000000002', null);
select pg_temp.armar('f6', 'factura', 'a1000000-0000-0000-0000-000000000001',
  'c5000000-0000-0000-0000-000000000001', null);

select is(
  (select estado from public.confirmar_comprobante(pg_temp.id_de('f1'))),
  'confirmada', 'la primera factura quedó confirmada');

select is(
  (select estado_despacho from dominio.comprobantes_venta where id = pg_temp.id_de('f1')),
  'listo_para_despachar', 'la forma «Expreso» deja la factura lista para despachar');

select is(
  (select estado from public.confirmar_comprobante(pg_temp.id_de('f2'))),
  'confirmada', 'la segunda factura quedó confirmada');

select is(
  (select estado_despacho from dominio.comprobantes_venta where id = pg_temp.id_de('f2')),
  'sin_armar', 'la forma «Retiro en local» deja la factura sin armar');

select is(
  (select estado from public.confirmar_comprobante(pg_temp.id_de('f5'))),
  'confirmada', 'la factura de la otra tienda quedó confirmada');

select is(
  (select estado from public.confirmar_comprobante(pg_temp.id_de('f6'))),
  'confirmada', 'la sexta factura quedó confirmada');

-- Una factura ya entregada (la entrega la deja así; acá se arma el caso).
reset role;

update dominio.comprobantes_venta set estado_despacho = 'entregado' where id = pg_temp.id_de('f6');

select pg_temp.como('f1000000-0000-0000-0000-000000000001');

-- El Depósito (Ventas en lectura + acción `despachar`) guarda el envío.
select pg_temp.como('f1000000-0000-0000-0000-000000000002');

select is(
  (select transporte_id from pg_temp.guardar('f1', 'e1000000-0000-0000-0000-000000000001', 'AR123456789', '2026-12-14')),
  'e1000000-0000-0000-0000-000000000001'::uuid, 'se guarda el transporte');

select is(
  (select guia from dominio.comprobantes_venta where id = pg_temp.id_de('f1')),
  'AR123456789', 'se guarda la guía');

select is(
  (select fecha_envio from dominio.comprobantes_venta where id = pg_temp.id_de('f1')),
  '2026-12-14'::date, 'se guarda la fecha de envío');

-- La actividad del guardado (la cuenta el Administrador).
select pg_temp.como('f1000000-0000-0000-0000-000000000001');

select is(
  (select count(*)::int from public.registro_actividad where tipo = 'despacho.envio_guardado'),
  1, 'el envío queda en la actividad');

select ok(
  exists (select 1 from public.registro_actividad
    where tipo = 'despacho.envio_guardado' and detalle like '%Expreso Uno%' and detalle like '%AR123456789%'),
  'la actividad dice qué transporte y qué guía se guardaron');

-- Idempotencia: guardar lo mismo no escribe otra vez ni rompe el bloqueo.
select pg_temp.como('f1000000-0000-0000-0000-000000000002');

insert into sello (clave, ts) values ('f1', pg_temp.actualizado('f1'));

select pg_temp.guardar('f1', 'e1000000-0000-0000-0000-000000000001', 'AR123456789', '2026-12-14');

select is(
  (select updated_at from dominio.comprobantes_venta where id = pg_temp.id_de('f1')),
  (select ts from sello where clave = 'f1'),
  'repetir el mismo envío no cambia la fila');

-- La actividad la cuenta el Administrador (los Depósito no ven la sección «actividad»).
select pg_temp.como('f1000000-0000-0000-0000-000000000001');

select is(
  (select count(*)::int from public.registro_actividad where tipo = 'despacho.envio_guardado'),
  1, 'repetir el mismo envío no registra actividad otra vez');

-- ============================================================================
-- FR-021 · El transporte tiene que estar activo y usarse en la tienda
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000002');

select throws_ok(
  $$select pg_temp.guardar('f2', 'e1000000-0000-0000-0000-000000000002', 'AR999', '2026-12-14')$$,
  '22023', null, 'un transporte inactivo no se puede elegir');

select throws_ok(
  $$select pg_temp.guardar('f2', 'e1000000-0000-0000-0000-000000000003', 'AR999', '2026-12-14')$$,
  '22023', null, 'un transporte que no se usa en la tienda no se puede elegir');

select throws_ok(
  $$select pg_temp.guardar('f2', 'e2000000-0000-0000-0000-000000000001', 'AR999', '2026-12-14')$$,
  '22023', null, 'un transporte de otra organización no se puede elegir');

select is(
  (select transporte_id from dominio.comprobantes_venta where id = pg_temp.id_de('f2')),
  null, 'los transportes rechazados no dejaron nada escrito');

-- ============================================================================
-- FR-021 · Permiso: `despachar` o Ventas en `edicion`, en la empresa del comprobante
-- ============================================================================

-- Consulta tiene Ventas en lectura y NO la acción `despachar`.
select pg_temp.como('f1000000-0000-0000-0000-000000000004');

select throws_ok(
  $$select pg_temp.guardar('f2', 'e1000000-0000-0000-0000-000000000001', 'AR999', '2026-12-14')$$,
  '42501', null, 'sin la acción despachar no se registra el envío');

-- Miembro tampoco.
select pg_temp.como('f1000000-0000-0000-0000-000000000005');

select throws_ok(
  $$select pg_temp.guardar('f2', 'e1000000-0000-0000-0000-000000000001', 'AR999', '2026-12-14')$$,
  '42501', null, 'un miembro sin la acción despachar no registra el envío');

-- Mostrador tiene Ventas en `edicion` (aunque no tenga `despachar`): puede registrar el envío.
select pg_temp.como('f1000000-0000-0000-0000-000000000003');

select is(
  (select transporte_id from pg_temp.guardar('f2', 'e1000000-0000-0000-0000-000000000001', 'AR888', '2026-12-14')),
  'e1000000-0000-0000-0000-000000000001'::uuid, 'quien edita Ventas en la tienda registra el envío');

-- El permiso se resuelve en la empresa DEL COMPROBANTE: el Depósito de la tienda A no toca la factura de la B.
select pg_temp.como('f1000000-0000-0000-0000-000000000002');

select throws_ok(
  $$select pg_temp.guardar('f5', 'e1000000-0000-0000-0000-000000000003', 'AR777', '2026-12-14')$$,
  '42501', null, 'no se registra el envío de una factura de otra tienda');

-- ============================================================================
-- FR-021 · Solo facturas confirmadas y no entregadas
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000002');

select throws_ok(
  $$select pg_temp.guardar('f3', 'e1000000-0000-0000-0000-000000000001', 'AR999', '2026-12-14')$$,
  '22023', null, 'un presupuesto no registra envío');

select throws_ok(
  $$select pg_temp.guardar('f4', 'e1000000-0000-0000-0000-000000000001', 'AR999', '2026-12-14')$$,
  '55000', null, 'una factura sin confirmar no registra envío');

select throws_ok(
  $$select pg_temp.guardar('f6', 'e1000000-0000-0000-0000-000000000001', 'AR999', '2026-12-14')$$,
  '55000', null, 'una factura ya entregada no cambia su envío');

select is(
  (select transporte_id from dominio.comprobantes_venta where id = pg_temp.id_de('f4')),
  null, 'los rechazos no dejaron nada escrito');

-- ============================================================================
-- FR-021 · Bloqueo optimista y guía de más de 100 caracteres
-- ============================================================================

select throws_ok(
  format($$select public.guardar_envio_comprobante(%L, 'e1000000-0000-0000-0000-000000000001', 'AR555', '2026-12-14', '2026-01-01T00:00:00Z'::timestamptz)$$,
    pg_temp.id_de('f1')),
  '40001', null, 'un updated_at viejo da conflicto de edición');

select throws_ok(
  $$select pg_temp.guardar('f1', 'e1000000-0000-0000-0000-000000000001', repeat('X', 101), '2026-12-14')$$,
  '22023', null, 'una guía de más de 100 caracteres se rechaza');

-- Y la base (no solo la RPC) tampoco la deja entrar.
reset role;

select throws_ok(
  format($$update dominio.comprobantes_venta set guia = %L where id = %L$$,
    repeat('X', 101), pg_temp.id_de('f1')),
  '23514', null, 'una guía de más de 100 caracteres no entra en la tabla');

select pg_temp.como('f1000000-0000-0000-0000-000000000002');

select is(
  (select guia from dominio.comprobantes_venta where id = pg_temp.id_de('f1')),
  'AR123456789', 'la guía que se había guardado no cambió');

-- ============================================================================
-- FR-021 · Aislamiento por organización
-- ============================================================================

select pg_temp.como('f2000000-0000-0000-0000-000000000001');

select throws_ok(
  format($$select public.guardar_envio_comprobante(%L, 'e2000000-0000-0000-0000-000000000001', 'AR999', '2026-12-14', %L::timestamptz)$$,
    pg_temp.id_de('f1'), pg_temp.actualizado('f1')),
  'P0002', null, 'otra organización no registra el envío de esta factura');

-- ============================================================================
-- FR-022 · Al entregar, la forma de envío que exige transporte y guía se respeta
-- ============================================================================

-- La regla vive en la BASE (disparador), no en la RPC: el navegador no ejecuta su función.
reset role;

select has_trigger('dominio', 'comprobantes_venta', 'comprobantes_venta_exige_envio_al_entregar',
  'existe el disparador que exige transporte y guía al entregar');

select has_function('private', 'exigir_envio_al_entregar', 'existe la función del disparador de entrega');

select is(
  has_function_privilege('authenticated', 'private.exigir_envio_al_entregar()', 'EXECUTE'),
  false, 'authenticated no ejecuta la función del disparador');

-- Las facturas de esta parte: cuatro «Expreso» (la forma que exige transporte y guía) y un «Retiro en local».
select pg_temp.como('f1000000-0000-0000-0000-000000000001');

select pg_temp.armar('f7', 'factura', 'a1000000-0000-0000-0000-000000000001',
  'c5000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001');
select pg_temp.armar_lineas('f8', 'factura', 'a1000000-0000-0000-0000-000000000001',
  'c5000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001',
  jsonb_build_array(
    jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000001', 'cantidad', 1),
    jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000002', 'cantidad', 1)));
select pg_temp.armar('f9', 'factura', 'a1000000-0000-0000-0000-000000000001',
  'c5000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002');
select pg_temp.armar('f10', 'factura', 'a1000000-0000-0000-0000-000000000001',
  'c5000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001');
select pg_temp.armar('f11', 'factura', 'a1000000-0000-0000-0000-000000000001',
  'c5000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001');
select pg_temp.armar('f12', 'factura', 'a1000000-0000-0000-0000-000000000001',
  'c5000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001');

select is(
  (select estado from public.confirmar_comprobante(pg_temp.id_de('f7'))),
  'confirmada', 'la factura «Expreso» quedó confirmada');
select is(
  (select estado from public.confirmar_comprobante(pg_temp.id_de('f8'))),
  'confirmada', 'la factura «Expreso» con línea «A pedido» quedó confirmada');
select is(
  (select estado from public.confirmar_comprobante(pg_temp.id_de('f9'))),
  'confirmada', 'la factura «Retiro en local» quedó confirmada');
select is(
  (select estado from public.confirmar_comprobante(pg_temp.id_de('f10'))),
  'confirmada', 'la factura «Expreso» con el envío guardado quedó confirmada');
select is(
  (select estado from public.confirmar_comprobante(pg_temp.id_de('f11'))),
  'confirmada', 'la factura «Expreso» de la escritura directa quedó confirmada');
select is(
  (select estado from public.confirmar_comprobante(pg_temp.id_de('f12'))),
  'confirmada', 'la factura «Expreso» sin transporte quedó confirmada');

select is(
  (select estado_despacho from dominio.comprobantes_venta where id = pg_temp.id_de('f7')),
  'listo_para_despachar', 'la factura «Expreso» arranca lista para despachar');
select is(
  (select estado_despacho from dominio.comprobantes_venta where id = pg_temp.id_de('f9')),
  'sin_armar', 'la factura «Retiro en local» arranca sin armar');

-- ============================================================================
-- FR-022 · Sin transporte ni guía no se entrega, y el error dice qué falta
-- ============================================================================

-- El Depósito (Ventas en lectura + acción `despachar`) es quien entrega.
select pg_temp.como('f1000000-0000-0000-0000-000000000002');

select throws_ok(
  pg_temp.sql_entregar('f7', 'f1000000-0000-0000-0000-000000000002'),
  '22023', null, 'sin transporte ni guía no se entrega una factura «Expreso»');

select like(
  pg_temp.mensaje_de_error(pg_temp.sql_entregar('f7', 'f1000000-0000-0000-0000-000000000002')),
  '%faltan el transporte y la guía%',
  'el rechazo dice que faltan el transporte y la guía');

select is(
  (select estado_despacho from dominio.comprobantes_venta where id = pg_temp.id_de('f7')),
  'listo_para_despachar', 'el rechazo no entregó la factura');

select is(
  (select entregado_en from dominio.comprobantes_venta where id = pg_temp.id_de('f7')),
  null, 'el rechazo no dejó fecha de entrega');

-- Con transporte pero sin guía: sigue faltando la guía.
select is(
  (select transporte_id from pg_temp.guardar('f7', 'e1000000-0000-0000-0000-000000000001', null, '2026-12-14')),
  'e1000000-0000-0000-0000-000000000001'::uuid, 'se guarda el transporte sin guía');

select throws_ok(
  pg_temp.sql_entregar('f7', 'f1000000-0000-0000-0000-000000000002'),
  '22023', null, 'sin guía no se entrega una factura «Expreso»');

select like(
  pg_temp.mensaje_de_error(pg_temp.sql_entregar('f7', 'f1000000-0000-0000-0000-000000000002')),
  '%falta la guía%',
  'el rechazo dice que falta la guía');

-- Con transporte y guía, la factura «Expreso» se entrega.
select is(
  (select guia from pg_temp.guardar('f7', 'e1000000-0000-0000-0000-000000000001', 'AR123456789', '2026-12-14')),
  'AR123456789', 'se guarda la guía');

select is(
  (select estado_despacho from pg_temp.entregar('f7', 'f1000000-0000-0000-0000-000000000002')),
  'entregado', 'con transporte y guía la factura «Expreso» se entrega');

select ok(
  (select entregado_en is not null from dominio.comprobantes_venta where id = pg_temp.id_de('f7')),
  'la entrega deja el momento de la entrega');

-- ============================================================================
-- FR-022 · Falta uno de los dos: el error dice cuál
-- ============================================================================

-- Con la guía pero sin transporte: el transporte sigue faltando.
select is(
  (select guia from pg_temp.guardar('f12', null, 'AR999', '2026-12-14')),
  'AR999', 'se guarda la guía sin transporte');

select throws_ok(
  pg_temp.sql_entregar('f12', 'f1000000-0000-0000-0000-000000000002'),
  '22023', null, 'sin transporte no se entrega aunque tenga la guía');

select like(
  pg_temp.mensaje_de_error(pg_temp.sql_entregar('f12', 'f1000000-0000-0000-0000-000000000002')),
  '%falta el transporte%',
  'el rechazo dice que falta el transporte');

select is(
  (select estado_despacho from dominio.comprobantes_venta where id = pg_temp.id_de('f12')),
  'listo_para_despachar', 'el rechazo no entregó la factura que solo tenía la guía');

-- Una guía en blanco es una guía ausente: con el transporte, sigue faltando la guía.
select is(
  (select transporte_id from pg_temp.guardar('f12', 'e1000000-0000-0000-0000-000000000001', '   ', '2026-12-14')),
  'e1000000-0000-0000-0000-000000000001'::uuid, 'se guarda el transporte');

select is(
  (select guia from dominio.comprobantes_venta where id = pg_temp.id_de('f12')),
  null, 'una guía en blanco se guarda como guía ausente');

select throws_ok(
  pg_temp.sql_entregar('f12', 'f1000000-0000-0000-0000-000000000002'),
  '22023', null, 'sin guía no se entrega aunque tenga el transporte');

select like(
  pg_temp.mensaje_de_error(pg_temp.sql_entregar('f12', 'f1000000-0000-0000-0000-000000000002')),
  '%falta la guía%',
  'el rechazo dice que falta la guía');

-- Con transporte y guía, sí se entrega.
select pg_temp.guardar('f12', 'e1000000-0000-0000-0000-000000000001', 'AR123', '2026-12-14');

select is(
  (select estado_despacho from pg_temp.entregar('f12', 'f1000000-0000-0000-0000-000000000002')),
  'entregado', 'con transporte y guía la factura se entrega');

-- ============================================================================
-- FR-022 · «Retiro en local» se entrega sin transporte ni guía
-- ============================================================================

select is(
  (select estado_despacho from pg_temp.avanzar('f9', 'armando', 'f1000000-0000-0000-0000-000000000002')),
  'armando', 'el Depósito arma el pedido de retiro en local');

select is(
  (select estado_despacho from pg_temp.avanzar('f9', 'listo_para_despachar', 'f1000000-0000-0000-0000-000000000001')),
  'listo_para_despachar', 'el Administrador controla el pedido de retiro en local');

select is(
  (select estado_despacho from pg_temp.entregar('f9', 'f1000000-0000-0000-0000-000000000002')),
  'entregado', 'el retiro en local se entrega sin transporte ni guía');

select is(
  (select transporte_id from dominio.comprobantes_venta where id = pg_temp.id_de('f9')),
  null, 'el retiro en local queda sin transporte');

select is(
  (select guia from dominio.comprobantes_venta where id = pg_temp.id_de('f9')),
  null, 'el retiro en local queda sin guía');

-- ============================================================================
-- FR-022 · Todo o nada: el rechazo no descuenta la reserva «A pedido»
-- ============================================================================

select is(
  pg_temp.estado_reserva('f8', 2), 'activa', 'la línea «A pedido» reservó al confirmar');

select throws_ok(
  pg_temp.sql_entregar('f8', 'f1000000-0000-0000-0000-000000000002'),
  '22023', null, 'sin transporte ni guía no se entrega aunque la línea «A pedido» esté reservada');

select is(
  pg_temp.estado_reserva('f8', 2), 'activa', 'todo o nada: el rechazo no descontó la reserva');

select is(
  pg_temp.salidas('b1000000-0000-0000-0000-000000000002'), 0,
  'todo o nada: el rechazo no dejó ninguna salida de stock');

select is(
  (select estado_despacho from dominio.comprobantes_venta where id = pg_temp.id_de('f8')),
  'listo_para_despachar', 'todo o nada: la factura no se entregó');

-- Con el envío guardado, la entrega se aplica y la reserva se descuenta.
select pg_temp.guardar('f8', 'e1000000-0000-0000-0000-000000000001', 'AR777', '2026-12-14');

select is(
  (select estado_despacho from pg_temp.entregar('f8', 'f1000000-0000-0000-0000-000000000002')),
  'entregado', 'con transporte y guía la factura «Expreso» con línea «A pedido» se entrega');

select is(
  pg_temp.estado_reserva('f8', 2), 'descontada', 'la reserva «A pedido» quedó descontada al entregar');

-- ============================================================================
-- FR-022 · Permisos y aislamiento
-- ============================================================================

-- La factura con el envío ya guardado: lo único que puede frenarla es el permiso.
select pg_temp.como('f1000000-0000-0000-0000-000000000002');

select pg_temp.guardar('f10', 'e1000000-0000-0000-0000-000000000001', 'AR555', '2026-12-14');

-- Consulta tiene Ventas en lectura y NO la acción `despachar`.
select pg_temp.como('f1000000-0000-0000-0000-000000000004');

select throws_ok(
  pg_temp.sql_entregar('f10', 'f1000000-0000-0000-0000-000000000002'),
  '42501', null, 'sin la acción despachar no se entrega aunque la factura tenga el envío');

-- Otra organización no toca la factura.
select pg_temp.como('f2000000-0000-0000-0000-000000000001');

select throws_ok(
  pg_temp.sql_entregar('f10', 'f1000000-0000-0000-0000-000000000002'),
  'P0002', null, 'otra organización no entrega esta factura');

-- El Depósito sí la entrega.
select pg_temp.como('f1000000-0000-0000-0000-000000000002');

select is(
  (select estado_despacho from pg_temp.entregar('f10', 'f1000000-0000-0000-0000-000000000002')),
  'entregado', 'con el envío guardado y la acción despachar, la factura se entrega');

-- ============================================================================
-- FR-022 · La regla vive en la base: una escritura directa tampoco entrega sin envío
-- ============================================================================

reset role;

select throws_ok(
  format($$update dominio.comprobantes_venta set estado_despacho = 'entregado' where id = %L$$,
    pg_temp.id_de('f11')),
  '22023', null, 'ni una escritura directa entrega la factura sin transporte y guía');

select is(
  (select estado_despacho from dominio.comprobantes_venta where id = pg_temp.id_de('f11')),
  'listo_para_despachar', 'la escritura directa no cambió el estado de despacho');

-- ============================================================================
-- FR-021 · Quién puede ejecutar la RPC
-- ============================================================================

reset role;

select is(
  has_function_privilege('authenticated', 'public.guardar_envio_comprobante(uuid, uuid, text, date, timestamptz)', 'EXECUTE'),
  true, 'authenticated ejecuta guardar_envio_comprobante');

select is(
  has_function_privilege('anon', 'public.guardar_envio_comprobante(uuid, uuid, text, date, timestamptz)', 'EXECUTE'),
  false, 'anon no ejecuta guardar_envio_comprobante');

select is(
  has_function_privilege('authenticated', 'private.puede_despachar_en_empresa(uuid)', 'EXECUTE'),
  false, 'authenticated no consulta el permiso de despacho por empresa');

select is(
  has_function_privilege('authenticated', 'private.nivel_ventas_en_empresa(uuid)', 'EXECUTE'),
  false, 'authenticated no consulta el nivel de Ventas por empresa');

-- ============================================================================
-- `anon` sin acceso
-- ============================================================================

reset role;
set local role anon;

select throws_ok(
  format($$select public.guardar_envio_comprobante(%L, 'e1000000-0000-0000-0000-000000000001', 'AR999', '2026-12-14', %L::timestamptz)$$,
    pg_temp.id_de('f1'), pg_temp.actualizado('f1')),
  '42501', null, 'anon no registra el envío');

reset role;

select * from finish();
rollback;
