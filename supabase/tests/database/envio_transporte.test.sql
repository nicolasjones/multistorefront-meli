-- F-VTA-16 (MSF-166, épica MSF-135, spec 20261024-130000-ventas-despacho-y-faltantes): transporte,
-- guía y fecha de envío de la factura (FR-020 y FR-021).
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
-- La exigencia de transporte y guía AL ENTREGAR (FR-022) es de T015/T016: esta entrega todavía no la trae.
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
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 'ARS', 1000, 'c1000000-0000-0000-0000-000000000001', null, true);

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
select 'b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 100, 0
on conflict (producto_id) do update
   set cantidad = excluded.cantidad, reservado = 0, updated_at = now();

insert into dominio.existencias_deposito (producto_id, deposito_id, organizacion_id, cantidad, reservado)
select 'b1000000-0000-0000-0000-000000000001', principal, '11111111-1111-1111-1111-111111111111', 100, 0
  from datos;

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

-- ============================================================================
-- FR-020 · Las columnas del envío y su frontera de datos
-- ============================================================================

select has_column('dominio', 'comprobantes_venta', 'transporte_id', 'la factura tiene transporte');
select has_column('dominio', 'comprobantes_venta', 'guia', 'la factura tiene guía');
select has_column('dominio', 'comprobantes_venta', 'fecha_envio', 'la factura tiene fecha de envío');

select ok(
  (select pg_get_constraintdef(oid) like 'FOREIGN KEY (transporte_id, organizacion_id)%'
     from pg_constraint
    where conname = 'comprobantes_venta_transporte_fk'
      and conrelid = 'dominio.comprobantes_venta'::regclass),
  'la FK del transporte es compuesta: (transporte_id, organizacion_id)');

select ok(
  (select pg_get_constraintdef(oid) like '%REFERENCES dominio.transportes(id, organizacion_id)'
     from pg_constraint
    where conname = 'comprobantes_venta_transporte_fk'
      and conrelid = 'dominio.comprobantes_venta'::regclass),
  'la FK apunta a dominio.transportes (id, organizacion_id): el transporte es de la misma organización');

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
