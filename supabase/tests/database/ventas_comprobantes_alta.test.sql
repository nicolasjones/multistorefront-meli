-- F-VTA-05 (MSF-273, épica MSF-159): alta y edición de la cabecera del comprobante. Cubre SC-001:
-- aislamiento entre organizaciones y empresas, `lectura` / sin acceso / `anon` sin escritura, numeración
-- correlativa por empresa y tipo sin repetidos ni saltos, edición rechazada en `confirmada` / `aceptado`,
-- bloqueo optimista, empresa y tipo inmutables, eventos de actividad y `rls_en_toda_tabla` (las tablas
-- nuevas tienen RLS). La concurrencia real no cabe en una sola transacción: se prueba la serie sin saltos
-- (incluido un alta revertida), que el contador es una sola fila bloqueada por `insert ... on conflict` y
-- que la base rechaza un número repetido.
-- Matriz vigente de `ventas`: administrador, operador, mostrador y administración `edicion`; consulta,
-- depósito y miembro `lectura`. En ventas rige el rol de la EMPRESA del comprobante.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('f1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('f1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('f2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('f1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('f2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

-- El operador y la consulta solo acceden a San Javucho; Mundo JC les queda fuera.
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta');

insert into clientes (id, organizacion_id, numero, nombre, tipo, archivado_en) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Distribuidora Norte', 'mayorista', null),
  ('c5000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 11, 'Cliente archivado', 'minorista', now()),
  ('c6000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 10, 'Cliente de la Dos', 'minorista', null);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- «Consumidor final» sembrado por la organización (F-CLI-03): el alta lo acepta como cliente.
create temp table datos as
  select (select id from clientes where organizacion_id = '11111111-1111-1111-1111-111111111111' and es_consumidor_final) as consumidor_uno;
grant select on datos to public;

create temp table comps (clave text primary key, id uuid, numero text, actualizado timestamptz);
grant select, insert, update on comps to public;

-- ============================================================================
-- Esquema, RLS y privilegios
-- ============================================================================

select ok(
  to_regclass('dominio.comprobantes_venta_numeracion') is not null
    and to_regclass('public.comprobantes_venta_numeracion') is null,
  'la numeración vive en dominio, no en public'
);
select is(
  (select bool_and(c.relrowsecurity) from pg_class c
    where c.oid in ('dominio.comprobantes_venta'::regclass, 'dominio.comprobantes_venta_numeracion'::regclass)),
  true, 'RLS activa en comprobantes_venta y en su numeración'
);
select is(
  (select count(*) from unnest(array[
    'public.crear_comprobante(text,uuid,uuid,text,date,date,uuid,uuid)',
    'public.guardar_comprobante(uuid,uuid,text,date,date,uuid,uuid,timestamptz)',
    'public.obtener_comprobante(uuid)'
  ]) as f where has_function_privilege('anon', f::regprocedure, 'execute'))::int,
  0, 'anon no ejecuta ninguna RPC de comprobantes'
);
select is(
  (select count(*) from unnest(array[
    'public.crear_comprobante(text,uuid,uuid,text,date,date,uuid,uuid)',
    'public.guardar_comprobante(uuid,uuid,text,date,date,uuid,uuid,timestamptz)',
    'public.obtener_comprobante(uuid)'
  ]) as f where has_function_privilege('authenticated', f::regprocedure, 'execute'))::int,
  3, 'authenticated ejecuta las tres RPC de comprobantes'
);
select is(
  has_function_privilege('authenticated', 'private.siguiente_numero_comprobante(uuid,text)', 'execute'),
  false, 'authenticated no ejecuta el contador de numeración'
);
select is(
  has_table_privilege('authenticated', 'dominio.comprobantes_venta_numeracion', 'select')
    or has_table_privilege('authenticated', 'dominio.comprobantes_venta_numeracion', 'insert')
    or has_table_privilege('anon', 'dominio.comprobantes_venta_numeracion', 'select'),
  false, 'nadie lee ni escribe la numeración directo'
);
select is(
  has_table_privilege('authenticated', 'dominio.comprobantes_venta', 'insert')
    or has_table_privilege('authenticated', 'dominio.comprobantes_venta', 'update')
    or has_table_privilege('authenticated', 'dominio.comprobantes_venta', 'delete'),
  false, 'authenticated no escribe comprobantes por fuera de las RPC'
);

-- ============================================================================
-- Alta (FR-001): factura nace borrador, presupuesto pendiente, operador de la sesión
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000002');

insert into comps (clave, id, numero, actualizado)
select 'fac1', c.id, c.numero, c.updated_at
  from public.crear_comprobante('factura', 'a1000000-0000-0000-0000-000000000001',
         'c5000000-0000-0000-0000-000000000001', 'mostrador', '2026-10-24') c;

select is((select estado from dominio.comprobantes_venta where id = (select id from comps where clave = 'fac1')),
  'borrador', 'la factura nace en borrador');
select is((select operador_id from dominio.comprobantes_venta where id = (select id from comps where clave = 'fac1')),
  'f1000000-0000-0000-0000-000000000002'::uuid, 'el operador es quien carga (sale de la sesión)');
select is((select numero from comps where clave = 'fac1'), '00000001', 'primer número de la factura: 00000001');

insert into comps (clave, id, numero, actualizado)
select 'pre1', c.id, c.numero, c.updated_at
  from public.crear_comprobante('presupuesto', 'a1000000-0000-0000-0000-000000000001',
         (select consumidor_uno from datos), 'telefono_whatsapp', '2026-10-24', '2026-11-24') c;

select is((select estado from dominio.comprobantes_venta where id = (select id from comps where clave = 'pre1')),
  'pendiente', 'el presupuesto nace pendiente, con Consumidor final y validez');
select is((select numero from comps where clave = 'pre1'), '00000001',
  'la numeración es por tipo: el primer presupuesto también es 00000001');

-- ============================================================================
-- Numeración correlativa (FR-004)
-- ============================================================================

insert into comps (clave, id, numero, actualizado)
select 'fac2', c.id, c.numero, c.updated_at
  from public.crear_comprobante('factura', 'a1000000-0000-0000-0000-000000000001',
         'c5000000-0000-0000-0000-000000000001', 'mostrador') c;
select is((select numero from comps where clave = 'fac2'), '00000002', 'la segunda factura recibe 00000002');

-- Un alta revertida no deja saltos: el contador vuelve con ella.
savepoint antes_del_alta;
select public.crear_comprobante('factura', 'a1000000-0000-0000-0000-000000000001',
  'c5000000-0000-0000-0000-000000000001', 'mostrador');
rollback to savepoint antes_del_alta;

insert into comps (clave, id, numero, actualizado)
select 'fac3', c.id, c.numero, c.updated_at
  from public.crear_comprobante('factura', 'a1000000-0000-0000-0000-000000000001',
         'c5000000-0000-0000-0000-000000000001', 'mostrador') c;
select is((select numero from comps where clave = 'fac3'), '00000003', 'tras un alta revertida no hay saltos: sigue 00000003');

-- Un alta inválida no consume número.
select throws_ok(
  $$select public.crear_comprobante('factura', 'a1000000-0000-0000-0000-000000000001',
      'c5000000-0000-0000-0000-000000000001', 'mercado_libre')$$,
  '22023', null, 'Mercado Libre no es un canal válido todavía (Etapa 2)');

select pg_temp.como('f1000000-0000-0000-0000-000000000001');
insert into comps (clave, id, numero, actualizado)
select 'fac_otra', c.id, c.numero, c.updated_at
  from public.crear_comprobante('factura', 'a1000000-0000-0000-0000-000000000002',
         'c5000000-0000-0000-0000-000000000001', 'mostrador') c;
select is((select numero from comps where clave = 'fac_otra'), '00000001',
  'cada empresa lleva su propia numeración (Mundo JC arranca en 00000001)');

select throws_ok(
  $$select count(*) from dominio.comprobantes_venta_numeracion$$,
  '42501', null, 'la tabla del contador no es legible por authenticated (sin privilegios)');

reset role;
select is(
  (select ultimo from dominio.comprobantes_venta_numeracion
    where organizacion_id = '11111111-1111-1111-1111-111111111111'
      and empresa_id = 'a1000000-0000-0000-0000-000000000001' and tipo = 'factura'),
  3, 'una sola fila de contador por organización, empresa y tipo (el bloqueo de fila serializa las altas)');
select throws_ok(
  $$insert into dominio.comprobantes_venta
      (organizacion_id, empresa_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva)
    values ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001',
            'c5000000-0000-0000-0000-000000000001', 'factura', '00000001', '2026-10-24', 'borrador', 0, 0)$$,
  '23505', null, 'la base rechaza un número repetido en la misma empresa y tipo');

-- ============================================================================
-- Permisos y aislamiento (FR-001, SC-001)
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select throws_ok(
  $$select public.crear_comprobante('factura', 'a1000000-0000-0000-0000-000000000001',
      'c5000000-0000-0000-0000-000000000001', 'mostrador')$$,
  '42501', null, 'con ventas en lectura no se puede crear');
select throws_ok(
  $$select public.guardar_comprobante((select id from comps where clave = 'fac1'),
      'c5000000-0000-0000-0000-000000000001', 'mostrador', '2026-10-24', null, null, null,
      (select actualizado from comps where clave = 'fac1'))$$,
  '42501', null, 'con ventas en lectura no se puede editar');
select is(
  (public.obtener_comprobante((select id from comps where clave = 'fac1')) ->> 'puede_editar')::boolean,
  false, 'con lectura se ve el comprobante pero no se ofrece editar');

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select public.crear_comprobante('factura', 'a1000000-0000-0000-0000-000000000002',
      'c5000000-0000-0000-0000-000000000001', 'mostrador')$$,
  '42501', null, 'sin acceso a la empresa (Mundo JC) no se crea');
select throws_ok(
  $$select public.obtener_comprobante((select id from comps where clave = 'fac_otra'))$$,
  '42501', null, 'sin acceso a la empresa tampoco se lee un comprobante de ella');

select pg_temp.como('f2000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.obtener_comprobante((select id from comps where clave = 'fac1'))$$,
  'P0002', null, 'otra organización no ve el comprobante (no existe para ella)');
select throws_ok(
  $$select public.crear_comprobante('factura', 'a1000000-0000-0000-0000-000000000001',
      'c6000000-0000-0000-0000-000000000001', 'mostrador')$$,
  '22023', null, 'otra organización no crea en una empresa ajena');
select is(
  (select count(*) from dominio.comprobantes_venta where organizacion_id = '11111111-1111-1111-1111-111111111111')::int,
  0, 'RLS: otra organización no lee filas de comprobantes');

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select public.crear_comprobante('factura', 'a1000000-0000-0000-0000-000000000001',
      'c6000000-0000-0000-0000-000000000001', 'mostrador')$$,
  '22023', null, 'el cliente de otra organización se rechaza');
select throws_ok(
  $$select public.crear_comprobante('factura', 'a1000000-0000-0000-0000-000000000001',
      'c5000000-0000-0000-0000-000000000002', 'mostrador')$$,
  '22023', null, 'un cliente archivado se rechaza');
select throws_ok(
  $$select public.crear_comprobante('nota', 'a1000000-0000-0000-0000-000000000001',
      'c5000000-0000-0000-0000-000000000001', 'mostrador')$$,
  '22023', null, 'solo hay factura y presupuesto');
select throws_ok(
  $$select public.crear_comprobante('factura', 'a1000000-0000-0000-0000-000000000001',
      'c5000000-0000-0000-0000-000000000001', 'mostrador', '2026-10-24', '2026-11-24')$$,
  '22023', null, 'la validez solo aplica a presupuestos');
select throws_ok(
  $$select public.crear_comprobante('factura', 'a1000000-0000-0000-0000-000000000001',
      'c5000000-0000-0000-0000-000000000001', 'mostrador', '2026-10-24', null, gen_random_uuid())$$,
  '22023', null, 'una forma de pago inexistente (o sin catálogo todavía) se rechaza');

set local role anon;
select throws_ok($$select public.crear_comprobante('factura', 'a1000000-0000-0000-0000-000000000001',
  'c5000000-0000-0000-0000-000000000001', 'mostrador')$$, '42501', null, 'anon no puede crear');
select throws_ok($$select * from dominio.comprobantes_venta$$, '42501', null, 'anon no lee comprobantes');

-- ============================================================================
-- Edición de la cabecera (FR-002, FR-003): bloqueo optimista, empresa y tipo inmutables
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000002');

update comps set (numero, actualizado) = (
  select g.numero, g.updated_at
    from public.guardar_comprobante((select id from comps where clave = 'fac1'),
           (select consumidor_uno from datos), 'tienda_online', '2026-10-25', null, null, null,
           (select actualizado from comps where clave = 'fac1')) g
) where clave = 'fac1';

select is(
  (select canal || '/' || fecha::text from dominio.comprobantes_venta where id = (select id from comps where clave = 'fac1')),
  'tienda_online/2026-10-25', 'guardar cambia canal y fecha');
select is(
  (select cliente_id from dominio.comprobantes_venta where id = (select id from comps where clave = 'fac1')),
  (select consumidor_uno from datos), 'guardar cambia el cliente a Consumidor final');
select is(
  (select empresa_id from dominio.comprobantes_venta where id = (select id from comps where clave = 'fac1')),
  'a1000000-0000-0000-0000-000000000001'::uuid, 'la empresa del comprobante no cambia');
select is(
  (public.obtener_comprobante((select id from comps where clave = 'fac1')) -> 'cliente' ->> 'es_consumidor_final')::boolean,
  true, 'obtener devuelve los datos del cliente (Consumidor final)');
select is(
  public.obtener_comprobante((select id from comps where clave = 'fac1')) ->> 'empresa',
  'San Javucho', 'obtener devuelve la tienda por nombre');
select is(
  jsonb_array_length(public.obtener_comprobante((select id from comps where clave = 'fac1')) -> 'lineas'),
  0, 'sin F-VTA-06 las líneas van vacías');

-- Conflicto: quien guarda con un `updated_at` viejo recibe 40001.
select throws_ok(
  $$select public.guardar_comprobante((select id from comps where clave = 'fac2'),
      'c5000000-0000-0000-0000-000000000001', 'mostrador', '2026-10-24', null, null, null,
      '2000-01-01T00:00:00Z')$$,
  '40001', null, 'un updated_at viejo es un conflicto de edición');

-- La validez anterior a la fecha se rechaza.
select throws_ok(
  $$select public.guardar_comprobante((select id from comps where clave = 'pre1'),
      (select consumidor_uno from datos), 'mostrador', '2026-10-24', '2026-10-01', null, null,
      (select actualizado from comps where clave = 'pre1'))$$,
  '22023', null, 'la validez anterior a la fecha se rechaza');

-- Documentos cerrados (FR-002): ni la factura confirmada ni el presupuesto aceptado se editan.
reset role;
update dominio.comprobantes_venta set estado = 'confirmada' where id = (select id from comps where clave = 'fac2');
update dominio.comprobantes_venta set estado = 'aceptado' where id = (select id from comps where clave = 'pre1');
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select public.guardar_comprobante((select id from comps where clave = 'fac2'),
      'c5000000-0000-0000-0000-000000000001', 'mostrador', '2026-10-24', null, null, null,
      (select updated_at from dominio.comprobantes_venta where id = (select id from comps where clave = 'fac2')))$$,
  '55000', null, 'una factura confirmada no se edita');
select throws_ok(
  $$select public.guardar_comprobante((select id from comps where clave = 'pre1'),
      (select consumidor_uno from datos), 'mostrador', '2026-10-24', null, null, null,
      (select updated_at from dominio.comprobantes_venta where id = (select id from comps where clave = 'pre1')))$$,
  '55000', null, 'un presupuesto aceptado no se edita');
select is(
  (public.obtener_comprobante((select id from comps where clave = 'fac2')) ->> 'editable')::boolean,
  false, 'obtener marca como no editable el documento cerrado');

-- ============================================================================
-- Actividad (FR-008)
-- ============================================================================

reset role;
select is(
  (select count(*) from public.registro_actividad
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and tipo = 'comprobante.creado')::int,
  5, 'cada alta registra comprobante.creado (5 altas válidas; la revertida no deja evento)');
select is(
  (select count(*) from public.registro_actividad
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and tipo = 'comprobante.editado')::int,
  1, 'cada edición registra comprobante.editado');
select is(
  (select empresa_id from public.registro_actividad
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and tipo = 'comprobante.editado' limit 1),
  'a1000000-0000-0000-0000-000000000001'::uuid, 'el evento queda asociado a la tienda del comprobante');

select * from finish();
rollback;
