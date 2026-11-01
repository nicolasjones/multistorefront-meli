-- MSF-260 · F-CON-05 (épica MSF-144, SC-003): libreta de contactos.
-- Cubre FR-001…FR-004, FR-007…FR-009 y FR-011: esquema `dominio` con RLS, aislamiento entre dos
-- organizaciones y dos empresas, permisos por nivel, duplicados, consentimiento, vínculos, historial y
-- anonimización sin romper consultas ni ventas, escritura directa rechazada y `anon` sin acceso.
-- El fixture corre como postgres (RLS no aplica); las verificaciones, como «authenticated» o «anon».
begin;

select plan(54);

-- Devuelve el DETAIL del 23505 de crear_contacto (pgTAP no lo expone).
create function pg_temp.detalle_duplicado(p_correo text) returns text language plpgsql as $f$
declare v_detalle text;
begin
  perform public.crear_contacto('a1000000-0000-0000-0000-00000000000a', 'Otra Ana', p_correo, null, true, 'Texto');
  return null;
exception when unique_violation then
  get stacked diagnostics v_detalle = pg_exception_detail;
  return v_detalle;
end $f$;

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('f1000000-0000-0000-0000-000000000002', 'operador-uno@example.com'),
  ('f1000000-0000-0000-0000-000000000003', 'consulta-uno@example.com'),
  ('f2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('f1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('f2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('a2000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

-- El operador trabaja en San Javucho; la persona de consulta, en Mundo JC.
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'consulta');
insert into usuario_empresa_activa (user_id, empresa_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-00000000000a'),
  ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-00000000000b');

insert into dominio.consultas (id, organizacion_id, empresa_id, origen, nombre, contacto, mensaje) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'formulario', 'Ana Pérez', 'ana@example.com', 'Hola, ¿tienen stock?'),
  ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'formulario', 'Ana P.', 'ana@example.com', 'Otra consulta'),
  ('c1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000b', 'formulario', 'Beto', 'beto@example.com', 'Consulta de la otra empresa'),
  ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-00000000000c', 'formulario', 'Dora', 'dora@example.com', 'Ajena');
update dominio.consultas set nota_interna = 'llamó Ana, tel 11-5555-0000' where id = 'c1000000-0000-0000-0000-000000000001';

insert into clientes (id, organizacion_id, numero, nombre, correo, tipo) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 1, 'Cliente Uno', 'cu@example.com', 'minorista');
insert into dominio.comprobantes_venta
  (id, organizacion_id, cliente_id, empresa_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c5000000-0000-0000-0000-000000000001',
   'a1000000-0000-0000-0000-00000000000a', 'factura', '0001-00000001', current_date - 3, 'emitida', 1000, 1210),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'c5000000-0000-0000-0000-000000000001',
   'a1000000-0000-0000-0000-00000000000b', 'factura', '0001-00000002', current_date - 2, 'emitida', 100, 121);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Esquema (Principio VII) y privilegios
-- ============================================================================

select ok(
  exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'dominio' and c.relname = 'contactos' and c.relrowsecurity),
  'contactos vive en «dominio» y tiene RLS activada'
);
select ok(
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and c.relname = 'contactos'),
  'no existe una copia en «public»'
);
select is(has_table_privilege('anon', 'dominio.contactos', 'select'), false, 'anon no lee dominio.contactos');
select is(has_table_privilege('authenticated', 'dominio.contactos', 'insert'), false, 'authenticated no inserta directo');
select is(has_table_privilege('authenticated', 'dominio.contactos', 'update'), false, 'authenticated no actualiza directo');
select is(has_table_privilege('authenticated', 'dominio.contactos', 'delete'), false, 'authenticated no borra directo');
select is_empty(
  $$select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('crear_contacto', 'actualizar_contacto', 'buscar_contactos', 'historial_contacto',
                        'vincular_consulta_contacto', 'vincular_comprobante_contacto', 'anonimizar_contacto')
      and has_function_privilege('anon', p.oid, 'EXECUTE')$$,
  'anon no ejecuta ninguna RPC de contactos'
);
select is_empty(
  $$select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname in ('validar_contacto', 'normalizar_contacto')
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')$$,
  'authenticated no ejecuta los ayudantes internos'
);

-- ============================================================================
-- Alta, consentimiento y duplicados (FR-002, FR-003, FR-004)
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000002');

select lives_ok(
  $$select public.crear_contacto('a1000000-0000-0000-0000-00000000000a', '  Ana Pérez ', ' Ana@Example.COM ', '+54 9 11 5555-1234', true, 'Texto de consentimiento v1', 'c1000000-0000-0000-0000-000000000001')$$,
  'el operador crea un contacto desde una consulta de su empresa'
);
select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select is(
  (select array[nombre, correo_normalizado, telefono_normalizado, consentimiento_texto] from dominio.contactos),
  array['Ana Pérez', 'ana@example.com', '5491155551234', 'Texto de consentimiento v1'],
  'nombre recortado, correo en minúsculas, teléfono solo dígitos y texto de consentimiento copiado'
);
select ok(
  (select consentimiento_en is not null and consentimiento_por = 'f1000000-0000-0000-0000-000000000002' from dominio.contactos),
  'queda la fecha y quién registró el consentimiento'
);
select is(
  (select contacto_id from dominio.consultas where id = 'c1000000-0000-0000-0000-000000000001'),
  (select id from dominio.contactos),
  'la consulta quedó vinculada al contacto nuevo'
);

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select public.crear_contacto('a1000000-0000-0000-0000-00000000000a', 'Otra Ana', 'ANA@example.com ', null, true, 'Texto')$$,
  '23505', null, 'mismo correo (sin mayúsculas ni espacios) en la empresa: duplicado'
);
select is(
  pg_temp.detalle_duplicado('ana@example.com'),
  (select id::text from dominio.contactos where correo_normalizado = 'ana@example.com'),
  'el duplicado informa en DETAIL el id del contacto existente (para ofrecer vincularlo)'
);
select throws_ok(
  $$select public.crear_contacto('a1000000-0000-0000-0000-00000000000a', 'Otra Ana', null, '(54) 911-5555 1234', true, 'Texto')$$,
  '23505', null, 'mismo teléfono por sus dígitos: duplicado'
);
select throws_ok(
  $$select public.crear_contacto('a1000000-0000-0000-0000-00000000000a', 'Sin consentimiento', 'x@example.com', null, false, 'Texto')$$,
  '22023', null, 'sin consentimiento no se guarda'
);
select throws_ok(
  $$select public.crear_contacto('a1000000-0000-0000-0000-00000000000a', 'Sin medio', null, null, true, 'Texto')$$,
  '22023', null, 'se exige al menos correo o teléfono'
);
select throws_ok(
  $$select public.crear_contacto('a1000000-0000-0000-0000-00000000000a', 'Mal correo', 'no-es-correo', null, true, 'Texto')$$,
  '22023', null, 'correo inválido'
);
select throws_ok(
  $$select public.crear_contacto('a1000000-0000-0000-0000-00000000000a', 'Mal tel', null, '123', true, 'Texto')$$,
  '22023', null, 'teléfono con menos de 7 dígitos'
);
select throws_ok(
  $$select public.crear_contacto('a1000000-0000-0000-0000-00000000000a', 'Pepe', 'pepe@example.com', null, true, 'Texto', 'c1000000-0000-0000-0000-000000000001')$$,
  '22023', null, 'la consulta ya vinculada no se vincula a otro contacto nuevo'
);
select throws_ok(
  $$select public.crear_contacto('a1000000-0000-0000-0000-00000000000a', 'Beto', 'beto@example.com', null, true, 'Texto', 'c1000000-0000-0000-0000-000000000003')$$,
  '22023', null, 'una consulta de otra empresa no se vincula'
);
select throws_ok(
  $$select public.crear_contacto('a1000000-0000-0000-0000-00000000000b', 'Beto', 'beto@example.com', null, true, 'Texto')$$,
  '42501', null, 'el operador no crea contactos en una empresa sin acceso'
);

-- ============================================================================
-- Permisos por nivel (FR-011)
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select throws_ok(
  $$select public.crear_contacto('a1000000-0000-0000-0000-00000000000b', 'Beto', 'beto@example.com', null, true, 'Texto')$$,
  '42501', null, 'con consultas = lectura no se crea'
);
select is((select count(*)::int from dominio.contactos), 0,
  'con lectura se ve la libreta de su empresa (vacía) y no la de las otras');
select is((select count(*)::int from public.buscar_contactos()), 0, 'buscar_contactos respeta la RLS');

-- ============================================================================
-- Aislamiento entre empresas y organizaciones
-- ============================================================================

reset role;
insert into dominio.contactos (id, organizacion_id, empresa_id, nombre, correo, consentimiento_texto) values
  ('e1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000b', 'Beto', 'beto@example.com', 'Texto'),
  ('e2000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-00000000000c', 'Dora', 'dora@example.com', 'Texto');

select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select is((select array_agg(nombre) from dominio.contactos), array['Beto'], 'consulta (Mundo JC) ve solo Beto');

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is((select array_agg(nombre) from dominio.contactos), array['Ana Pérez'], 'el operador (San Javucho) ve solo a Ana');
select throws_ok(
  $$select public.actualizar_contacto('e1000000-0000-0000-0000-00000000000b', 'Hackeado', 'beto@example.com', null, now())$$,
  '42501', null, 'no edita un contacto de una empresa sin acceso'
);
select throws_ok(
  $$select public.anonimizar_contacto('e2000000-0000-0000-0000-00000000000c', now())$$,
  '42501', null, 'no anonimiza un contacto de otra organización'
);
select throws_ok(
  $$select public.vincular_consulta_contacto('c1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-00000000000b')$$,
  '22023', null, 'no vincula una consulta a un contacto de otra empresa'
);
select is((select count(*)::int from public.historial_contacto('e1000000-0000-0000-0000-00000000000b')), 0,
  'el historial de un contacto sin acceso viene vacío');

select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select is((select array_agg(nombre order by nombre) from public.buscar_contactos(null, null)), array['Ana Pérez', 'Beto'],
  'Todas mis empresas: el administrador ve los contactos de sus dos empresas y no los de otra organización');
select is((select array_agg(nombre) from public.buscar_contactos('a1000000-0000-0000-0000-00000000000b', null)), array['Beto'],
  'con una empresa concreta solo trae los de esa empresa');

select pg_temp.como('f2000000-0000-0000-0000-000000000001');
select is((select array_agg(nombre) from dominio.contactos), array['Dora'], 'la organización Dos ve solo la suya');

-- ============================================================================
-- Edición con bloqueo optimista (FR-006)
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
create temp table t_ana on commit drop as
  select id, updated_at from dominio.contactos where nombre = 'Ana Pérez';

select lives_ok(
  $$select public.actualizar_contacto((select id from t_ana), 'Ana Pérez G.', 'ana@example.com', '+54 9 11 5555-1234', (select updated_at from t_ana))$$,
  'edita el nombre con el sello vigente'
);
select throws_ok(
  $$select public.actualizar_contacto((select id from t_ana), 'Ana Otra Vez', 'ana@example.com', '+54 9 11 5555-1234', (select updated_at from t_ana))$$,
  '40001', null, 'el sello viejo es un conflicto de edición'
);

-- ============================================================================
-- Vínculos e historial (FR-007, FR-008)
-- ============================================================================

select lives_ok(
  $$select public.vincular_consulta_contacto('c1000000-0000-0000-0000-000000000002', (select id from t_ana))$$,
  'vincula una segunda consulta de la misma empresa'
);
select lives_ok(
  $$select public.vincular_comprobante_contacto('d1000000-0000-0000-0000-000000000001', (select id from t_ana))$$,
  'vincula un comprobante de la misma empresa'
);
select throws_ok(
  $$select public.vincular_comprobante_contacto('d1000000-0000-0000-0000-000000000002', (select id from t_ana))$$,
  '42501', null, 'un comprobante de otra empresa sin acceso no se vincula'
);
select is(
  (select array_agg(tipo order by fecha desc, referencia_id) from public.historial_contacto((select id from t_ana))),
  array['consulta', 'consulta', 'compra'],
  'el historial reúne compras y consultas por fecha descendente'
);
select is(
  (select total from public.historial_contacto((select id from t_ana)) where tipo = 'compra'),
  1210::numeric, 'la compra muestra su total'
);
select is(
  (select count(*)::int from public.buscar_contactos(null, 'ana')), 1, 'la búsqueda encuentra por nombre'
);
select is(
  (select count(*)::int from public.buscar_contactos(null, '1155551234')), 1, 'la búsqueda encuentra por dígitos del teléfono'
);
select is(
  (select count(*)::int from public.buscar_contactos(null, '%')), 0, 'el comodín % se busca como texto literal'
);

-- ============================================================================
-- Anonimización (FR-009)
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select throws_ok(
  $$select public.anonimizar_contacto('e1000000-0000-0000-0000-00000000000b', now())$$,
  '42501', null, 'con lectura no se anonimiza'
);

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select public.anonimizar_contacto((select id from t_ana), now() - interval '1 day')$$,
  '40001', null, 'anonimizar con sello viejo es un conflicto'
);
select lives_ok(
  $$select public.anonimizar_contacto((select id from t_ana), (select updated_at from dominio.contactos where id = (select id from t_ana)))$$,
  'anonimiza con el sello vigente'
);
select is(
  (select array[nombre, correo, telefono] from dominio.contactos where id = (select id from t_ana)),
  array['Anonimizado', null, null]::text[], 'el contacto quedó con texto neutro'
);
select ok((select anonimizado_en is not null from dominio.contactos where id = (select id from t_ana)),
  'el contacto quedó marcado como anonimizado');
select is(
  (select count(*)::int from dominio.consultas where contacto_id = (select id from t_ana)
     and nombre = 'Anonimizado' and contacto = 'Anonimizado' and mensaje not like '%stock%' and mensaje <> 'Otra consulta' and nota_interna is null),
  2, 'las consultas vinculadas perdieron nombre, contacto, mensaje y nota interna pero siguen existiendo'
);
select is(
  (select count(*)::int from dominio.comprobantes_venta
    where id = 'd1000000-0000-0000-0000-000000000001' and total_con_iva = 1210 and estado = 'emitida'
      and contacto_id = (select id from t_ana)),
  1, 'la venta sigue intacta'
);
select throws_ok(
  $$select public.anonimizar_contacto((select id from t_ana), now())$$,
  '22023', null, 'un contacto ya anonimizado no se vuelve a anonimizar'
);
select throws_ok(
  $$select public.actualizar_contacto((select id from t_ana), 'Intento', 'x@example.com', null, now())$$,
  '22023', null, 'un contacto anonimizado no se edita'
);
select lives_ok(
  $$select public.crear_contacto('a1000000-0000-0000-0000-00000000000a', 'Ana Nueva', 'ana@example.com', '+54 9 11 5555-1234', true, 'Texto')$$,
  'las claves de duplicado quedaron libres para un contacto nuevo'
);
reset role;
select is(
  (select count(*)::int from public.registro_actividad
    where tipo like 'contacto.%' and (detalle ilike '%ana%@%' or detalle ilike '%5555%' or detalle ilike '%Pérez%')),
  0, 'ninguna actividad de contactos copia datos personales'
);

select * from finish();
rollback;
