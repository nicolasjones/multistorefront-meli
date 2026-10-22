-- F-SVC-04 (MSF-342, épica MSF-199): listado de reparaciones con filtros (SC-001).
-- Cubre: períodos Hoy/Semana/Mes sobre la entrega prevista (Mes incluye las sin fecha), serie parcial sin
-- distinguir mayúsculas e independiente del período (con % y _ literales), técnico con nombre visible,
-- tienda/empresa activa, paginación y total, orden, visibilidad por tienda, aislamiento entre dos
-- organizaciones, sin costos internos en la salida, rol sin acceso y `anon` sin ejecución.
-- Matriz vigente de `service_tecnico`: administrador `edicion` + `ver_costos`; operador `edicion`;
-- consulta y administración `lectura`; depósito `ninguno`.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('e1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('e1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('e1000000-0000-0000-0000-000000000005', 'deposito@example.com'),
  ('e2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('e1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'deposito', 'activo'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

-- El operador y la consulta solo acceden a San Javucho.
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('e1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('e1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta');

insert into clientes (id, organizacion_id, numero, nombre, tipo, archivado_en) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Distribuidora Norte', 'mayorista', null),
  ('c6000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 10, 'Cliente de la Dos', 'minorista', null);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create temp table datos as
  select
    (select id from dominio.modelos_equipo where organizacion_id = '11111111-1111-1111-1111-111111111111' and equipo = 'Nintendo Switch' and modelo = 'Estándar') as modelo_uno,
    (now() at time zone 'America/Argentina/Buenos_Aires')::date as hoy;
grant select on datos to public;

create temp table reps (clave text primary key, id uuid);
grant select, insert on reps to public;

-- Claves de las filas en el orden devuelto (o alfabético si `p_ordenado` es falso).
create function pg_temp.claves(p_json jsonb, p_ordenado boolean default true) returns text
language sql stable as $$
  select coalesce(string_agg(r.clave, ',' order by case when p_ordenado then f.orden end, r.clave), '')
    from jsonb_array_elements(p_json -> 'filas') with ordinality f(valor, orden)
    join reps r on r.id = (f.valor ->> 'id')::uuid
$$;

-- ============================================================================
-- Privilegios
-- ============================================================================

select is(
  has_function_privilege('anon', 'public.listar_reparaciones(uuid,text,text,uuid,integer,integer)', 'execute'),
  false, 'anon no ejecuta listar_reparaciones');
select is(
  has_function_privilege('authenticated', 'public.listar_reparaciones(uuid,text,text,uuid,integer,integer)', 'execute'),
  true, 'authenticated ejecuta listar_reparaciones');

-- ============================================================================
-- Datos: cinco reparaciones con fechas, series y tiendas distintas
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000001');

insert into reps (clave, id)
select c.clave, (public.crear_reparacion(
  c.empresa, 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos),
  p_numero_serie => c.serie
)->>'id')::uuid
  from (values
    ('A', 'a1000000-0000-0000-0000-000000000001'::uuid, 'ABC-123'),
    ('B', 'a1000000-0000-0000-0000-000000000001'::uuid, 'xyz-999'),
    ('C', 'a1000000-0000-0000-0000-000000000001'::uuid, null),
    ('D', 'a1000000-0000-0000-0000-000000000001'::uuid, 'FAR-001'),
    ('E', 'a1000000-0000-0000-0000-000000000002'::uuid, 'MUN-777')
  ) as c(clave, empresa, serie)
 order by c.clave;

-- Entregas previstas (A y E hoy; B hoy+3; C sin fecha; D hoy+60) y técnico de B.
reset role;
update dominio.reparaciones set entrega_prevista = (select hoy from datos) where id in ((select id from reps where clave = 'A'), (select id from reps where clave = 'E'));
update dominio.reparaciones set entrega_prevista = (select hoy + 3 from datos), tecnico_id = 'e1000000-0000-0000-0000-000000000001' where id = (select id from reps where clave = 'B');
update dominio.reparaciones set entrega_prevista = (select hoy + 60 from datos) where id = (select id from reps where clave = 'D');

select pg_temp.como('e1000000-0000-0000-0000-000000000001');
-- A: 2 × 50 de mano de obra + 1 × 50 de repuesto = 150 al cliente.
select public.agregar_item_reparacion((select id from reps where clave = 'A'), 'mano_obra', 'Diagnóstico', null, 2, 50);
select public.agregar_item_reparacion((select id from reps where clave = 'A'), 'repuesto', 'Cinta', null, 1, 50);

-- ============================================================================
-- Períodos
-- ============================================================================

select is(pg_temp.claves(public.listar_reparaciones(null, 'hoy'), false), 'A,E',
  'Hoy: solo las que entregan hoy, de todas las tiendas accesibles');
select is(pg_temp.claves(public.listar_reparaciones('a1000000-0000-0000-0000-000000000001', 'semana')), 'B,A',
  'Semana: hoy … hoy+6, de más reciente a más antigua (número descendente)');
select ok(pg_temp.claves(public.listar_reparaciones('a1000000-0000-0000-0000-000000000001', 'mes'), false) like '%C%',
  'Mes incluye las reparaciones sin entrega prevista');
select ok(pg_temp.claves(public.listar_reparaciones('a1000000-0000-0000-0000-000000000001', 'mes'), false) not like '%D%',
  'Mes no incluye una entrega prevista dentro de 60 días');
select ok(pg_temp.claves(public.listar_reparaciones(null, 'hoy'), false) not like '%C%',
  'Hoy no incluye las reparaciones sin entrega prevista');
select throws_ok(
  $$select public.listar_reparaciones(null, 'año')$$, '22023', null, 'un período desconocido se rechaza con 22023');
select throws_ok(
  $$select public.listar_reparaciones(null, null)$$, '22023', null, 'un período nulo se rechaza con 22023');

-- ============================================================================
-- N.º de serie: parcial, sin distinguir mayúsculas, independiente del período
-- ============================================================================

select is(pg_temp.claves(public.listar_reparaciones(null, 'hoy', 'abc'), false), 'A', 'serie parcial en minúsculas encuentra ABC-123');
select is(pg_temp.claves(public.listar_reparaciones(null, 'hoy', '-999'), false), 'B', 'la serie ignora el período: encuentra una entrega de otro día');
select is(pg_temp.claves(public.listar_reparaciones(null, 'hoy', 'far'), false), 'D', 'la serie encuentra una entrega fuera de todo período');
select is((public.listar_reparaciones(null, 'mes', '%')->>'total_filas')::int, 0, '«%» se busca literal (no es comodín)');
select is((public.listar_reparaciones(null, 'mes', '_')->>'total_filas')::int, 0, '«_» se busca literal (no es comodín)');
select is((public.listar_reparaciones(null, 'mes', '   ')->>'total_filas')::int,
  (public.listar_reparaciones(null, 'mes')->>'total_filas')::int, 'una serie en blanco equivale a no buscar');
select is(pg_temp.claves(public.listar_reparaciones('a1000000-0000-0000-0000-000000000001', 'mes', 'mun'), false), '',
  'la serie respeta la tienda elegida');

-- ============================================================================
-- Técnico y tienda
-- ============================================================================

select is(pg_temp.claves(public.listar_reparaciones(null, 'semana', null, 'e1000000-0000-0000-0000-000000000001'), false), 'B',
  'el filtro de técnico deja solo sus reparaciones');
select is(public.listar_reparaciones(null, 'semana')->'filas'->0->>'tecnico', 'Técnico sin nombre',
  'el técnico se ve por nombre visible (nunca el correo)');
select ok(public.listar_reparaciones(null, 'semana')::text not like '%@example.com%', 'la salida no contiene correos');
select is(pg_temp.claves(public.listar_reparaciones('a1000000-0000-0000-0000-000000000002', 'hoy'), false), 'E', 'la tienda elegida filtra el listado');
select is((public.listar_reparaciones('a2000000-0000-0000-0000-000000000001', 'mes')->>'total_filas')::int, 0,
  'una tienda de otra organización no devuelve nada');

-- ============================================================================
-- Contenido de la fila y sin costos internos
-- ============================================================================

select is((select (f.valor ->> 'total_cliente')::numeric
             from jsonb_array_elements(public.listar_reparaciones(null, 'hoy') -> 'filas') f(valor)
            where f.valor ->> 'id' = (select id::text from reps where clave = 'A')), 150::numeric,
  'el Total es el total al cliente (mano de obra + repuestos)');
select is((select (f.valor ->> 'total_cliente')::numeric
             from jsonb_array_elements(public.listar_reparaciones(null, 'hoy') -> 'filas') f(valor)
            where f.valor ->> 'id' = (select id::text from reps where clave = 'E')), 0::numeric,
  'sin ítems el Total llega en cero («A presupuestar» en pantalla)');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(public.listar_reparaciones(null, 'hoy')->'filas'->0) k),
  array['cliente','codigo','empresa','empresa_id','entrega_prevista','equipo','estado','estado_tono','id','ingreso_en','modelo','numero','numero_serie','tecnico','tecnico_id','total_cliente'],
  'la fila expone solo los campos del listado');
select ok(public.listar_reparaciones(null, 'mes', null)::text not like '%costo%' and public.listar_reparaciones(null, 'mes')::text not like '%ganancia%',
  'ninguna respuesta incluye costos internos ni ganancia');
select is(public.listar_reparaciones(null, 'hoy')->'filas'->0->>'codigo', 'R-0001', 'el código se presenta como R-000N');

-- ============================================================================
-- Paginación y total
-- ============================================================================

select is(pg_temp.claves(public.listar_reparaciones('a1000000-0000-0000-0000-000000000001', 'semana', null, null, 1, 1)), 'B', 'página 1 de tamaño 1');
select is(pg_temp.claves(public.listar_reparaciones('a1000000-0000-0000-0000-000000000001', 'semana', null, null, 2, 1)), 'A', 'página 2 de tamaño 1');
select is((public.listar_reparaciones('a1000000-0000-0000-0000-000000000001', 'semana', null, null, 2, 1)->>'total_filas')::int, 2,
  'el total cuenta todas las filas, no las de la página');
select is(public.listar_reparaciones('a1000000-0000-0000-0000-000000000001', 'semana', null, null, 9, 1) -> 'filas', '[]'::jsonb,
  'una página fuera de rango devuelve filas vacías');
select is((public.listar_reparaciones('a1000000-0000-0000-0000-000000000001', 'semana', null, null, 9, 1)->>'total_filas')::int, 2,
  'una página fuera de rango conserva el total');

-- ============================================================================
-- Visibilidad por tienda y permisos
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select is(pg_temp.claves(public.listar_reparaciones(null, 'hoy'), false), 'A', 'el operador de una sola tienda no ve las de otra');
select is((public.listar_reparaciones('a1000000-0000-0000-0000-000000000002', 'hoy')->>'total_filas')::int, 0,
  'pedir una tienda inaccesible no devuelve nada');

select pg_temp.como('e1000000-0000-0000-0000-000000000003');
select is(pg_temp.claves(public.listar_reparaciones(null, 'hoy'), false), 'A', 'con lectura se ve el listado de las tiendas accesibles');

select pg_temp.como('e1000000-0000-0000-0000-000000000005');
select throws_ok($$select public.listar_reparaciones(null, 'hoy')$$, '42501', null, 'sin acceso a Service técnico se rechaza con 42501');

-- ============================================================================
-- Aislamiento entre organizaciones
-- ============================================================================

select pg_temp.como('e2000000-0000-0000-0000-000000000001');
select is((public.listar_reparaciones(null, 'mes')->>'total_filas')::int, 0, 'otra organización no ve reparaciones ajenas (período)');
select is((public.listar_reparaciones(null, 'mes', 'abc')->>'total_filas')::int, 0, 'otra organización no las encuentra por serie');
select is((public.listar_reparaciones('a1000000-0000-0000-0000-000000000001', 'mes')->>'total_filas')::int, 0,
  'otra organización no las ve pidiendo la tienda ajena');

select * from finish();
rollback;
