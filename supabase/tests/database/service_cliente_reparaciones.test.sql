-- F-SVC-15 (MSF-429, épica MSF-232): reparaciones de un cliente para su ficha (SC-007).
-- Cubre: firma y privilegios, filtro por cliente y por tienda, orden (ingreso y número descendente),
-- paginación y total, visibilidad por tienda, sin costos internos, rol sin acceso, aislamiento entre dos
-- organizaciones y `anon` sin ejecución.
-- Matriz vigente de `service_tecnico`: administrador `edicion`; operador `edicion`; consulta `lectura`;
-- depósito `ninguno`.
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
  ('c5000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 11, 'Cliente sin reparaciones', 'minorista', null),
  ('c6000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 10, 'Cliente de la Dos', 'minorista', null);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create temp table datos as
  select (select id from dominio.modelos_equipo where organizacion_id = '11111111-1111-1111-1111-111111111111' and equipo = 'Nintendo Switch' and modelo = 'Estándar') as modelo_uno;
grant select on datos to public;

create temp table reps (clave text primary key, id uuid);
grant select, insert on reps to public;

create function pg_temp.claves(p_json jsonb) returns text
language sql stable as $$
  select coalesce(string_agg(r.clave, ',' order by f.orden), '')
    from jsonb_array_elements(p_json -> 'filas') with ordinality f(valor, orden)
    join reps r on r.id = (f.valor ->> 'id')::uuid
$$;

-- ============================================================================
-- Privilegios
-- ============================================================================

select is(
  has_function_privilege('anon', 'public.reparaciones_de_cliente(uuid,uuid,integer,integer)', 'execute'),
  false, 'anon no ejecuta reparaciones_de_cliente');
select is(
  has_function_privilege('authenticated', 'public.reparaciones_de_cliente(uuid,uuid,integer,integer)', 'execute'),
  true, 'authenticated ejecuta reparaciones_de_cliente');
select is(
  (select p.prosecdef from pg_proc p where p.oid = 'public.reparaciones_de_cliente(uuid,uuid,integer,integer)'::regprocedure),
  true, 'reparaciones_de_cliente es security definer');
select is(
  (select p.proconfig from pg_proc p where p.oid = 'public.reparaciones_de_cliente(uuid,uuid,integer,integer)'::regprocedure),
  array['search_path=""'], 'reparaciones_de_cliente fija search_path vacío');

-- ============================================================================
-- Datos: cuatro reparaciones del cliente 1 (tres en San Javucho, una en Mundo JC) y una de otro cliente
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000001');

insert into reps (clave, id)
select c.clave, (public.crear_reparacion(
  c.empresa, c.cliente, (select modelo_uno from datos), p_numero_serie => c.serie
)->>'id')::uuid
  from (values
    ('A', 'a1000000-0000-0000-0000-000000000001'::uuid, 'c5000000-0000-0000-0000-000000000001'::uuid, 'ABC-123'),
    ('B', 'a1000000-0000-0000-0000-000000000001'::uuid, 'c5000000-0000-0000-0000-000000000001'::uuid, 'XYZ-999'),
    ('C', 'a1000000-0000-0000-0000-000000000002'::uuid, 'c5000000-0000-0000-0000-000000000001'::uuid, 'MUN-777'),
    ('D', 'a1000000-0000-0000-0000-000000000001'::uuid, 'c5000000-0000-0000-0000-000000000001'::uuid, null),
    ('X', 'a1000000-0000-0000-0000-000000000001'::uuid, 'c5000000-0000-0000-0000-000000000002'::uuid, null)
  ) as c(clave, empresa, cliente, serie)
 order by c.clave;

-- A: 2 × 50 de mano de obra + 1 × 50 de repuesto = 150 al cliente; D con entrega prevista.
select public.agregar_item_reparacion((select id from reps where clave = 'A'), 'mano_obra', 'Diagnóstico', null, 2, 50);
select public.agregar_item_reparacion((select id from reps where clave = 'A'), 'repuesto', 'Cinta', null, 1, 50);
reset role;
update dominio.reparaciones set entrega_prevista = current_date + 3 where id = (select id from reps where clave = 'D');
-- Ingreso distinto para fijar el orden sin depender del azar: B la más antigua, C de ayer; A y D comparten día
-- dentro de la misma tienda (desempata el número). La numeración es por empresa, así que C (otra tienda) no
-- puede empatar con A por día y número.
update dominio.reparaciones set ingreso_en = current_date - 10 where id = (select id from reps where clave = 'B');
update dominio.reparaciones set ingreso_en = current_date - 1 where id = (select id from reps where clave = 'C');

select pg_temp.como('e1000000-0000-0000-0000-000000000001');

-- ============================================================================
-- Filtro por cliente y por tienda
-- ============================================================================

select is((public.reparaciones_de_cliente('c5000000-0000-0000-0000-000000000001')->>'total_filas')::int, 4,
  'el cliente ve solo sus cuatro reparaciones (no la del otro cliente)');
select is((public.reparaciones_de_cliente('c5000000-0000-0000-0000-000000000002')->>'total_filas')::int, 1,
  'el otro cliente ve su única reparación');
select is(public.reparaciones_de_cliente('00000000-0000-0000-0000-00000000dead'), '{"total_filas": 0, "filas": []}'::jsonb,
  'un cliente inexistente devuelve vacío');
select is(public.reparaciones_de_cliente(null), '{"total_filas": 0, "filas": []}'::jsonb,
  'un cliente nulo devuelve vacío');
select is(pg_temp.claves(public.reparaciones_de_cliente('c5000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002')), 'C',
  'la tienda elegida filtra por ella');
select is((public.reparaciones_de_cliente('c5000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001')->>'total_filas')::int, 3,
  'la tienda elegida cuenta solo las de esa tienda');
select is((public.reparaciones_de_cliente('c5000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001')->>'total_filas')::int, 0,
  'una tienda de otra organización no devuelve nada');

-- ============================================================================
-- Orden y contenido de la fila
-- ============================================================================

select is(pg_temp.claves(public.reparaciones_de_cliente('c5000000-0000-0000-0000-000000000001')), 'D,A,C,B',
  'orden: ingreso descendente y, en el mismo día de una misma tienda, número descendente');
select is(public.reparaciones_de_cliente('c5000000-0000-0000-0000-000000000001')->'filas'->3->>'numero', 'R-0002',
  'el número se presenta como R-000N');
select is((select (f.valor ->> 'total')::numeric
             from jsonb_array_elements(public.reparaciones_de_cliente('c5000000-0000-0000-0000-000000000001') -> 'filas') f(valor)
            where f.valor ->> 'id' = (select id::text from reps where clave = 'A')), 150::numeric,
  'el Total es el total al cliente (mano de obra + repuestos)');
select is((select (f.valor ->> 'total')::numeric
             from jsonb_array_elements(public.reparaciones_de_cliente('c5000000-0000-0000-0000-000000000001') -> 'filas') f(valor)
            where f.valor ->> 'id' = (select id::text from reps where clave = 'C')), 0::numeric,
  'sin ítems el Total llega en cero («A presupuestar» en pantalla)');
select is((select f.valor ->> 'entrega_prevista'
             from jsonb_array_elements(public.reparaciones_de_cliente('c5000000-0000-0000-0000-000000000001') -> 'filas') f(valor)
            where f.valor ->> 'id' = (select id::text from reps where clave = 'A')), null,
  'sin entrega prevista llega nula («—» en pantalla)');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(public.reparaciones_de_cliente('c5000000-0000-0000-0000-000000000001')->'filas'->0) k),
  array['empresa','entrega_prevista','equipo','estado','estado_tono','id','ingreso_en','modelo','numero','total'],
  'la fila expone solo los campos de la pestaña');
select ok(public.reparaciones_de_cliente('c5000000-0000-0000-0000-000000000001')::text not like '%costo%'
  and public.reparaciones_de_cliente('c5000000-0000-0000-0000-000000000001')::text not like '%ganancia%',
  'la respuesta no incluye costos internos ni ganancia');
select is(public.reparaciones_de_cliente('c5000000-0000-0000-0000-000000000001')->'filas'->0->>'empresa', 'San Javucho',
  'la tienda llega por nombre, no por identificador');

-- ============================================================================
-- Paginación y total
-- ============================================================================

select is(pg_temp.claves(public.reparaciones_de_cliente('c5000000-0000-0000-0000-000000000001', null, 1, 3)), 'D,A,C', 'página 1 de tamaño 3');
select is(pg_temp.claves(public.reparaciones_de_cliente('c5000000-0000-0000-0000-000000000001', null, 2, 3)), 'B', 'página 2 de tamaño 3');
select is((public.reparaciones_de_cliente('c5000000-0000-0000-0000-000000000001', null, 2, 3)->>'total_filas')::int, 4,
  'el total cuenta todas las filas, no las de la página');
select is(public.reparaciones_de_cliente('c5000000-0000-0000-0000-000000000001', null, 9, 3) -> 'filas', '[]'::jsonb,
  'una página fuera de rango devuelve filas vacías');
select is((public.reparaciones_de_cliente('c5000000-0000-0000-0000-000000000001', null, 9, 3)->>'total_filas')::int, 4,
  'una página fuera de rango conserva el total');
select is(jsonb_array_length(public.reparaciones_de_cliente('c5000000-0000-0000-0000-000000000001', null, 1, 0) -> 'filas'), 1,
  'un tamaño menor que 1 se acota a 1');

-- ============================================================================
-- Visibilidad por tienda y permisos
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select is(pg_temp.claves(public.reparaciones_de_cliente('c5000000-0000-0000-0000-000000000001')), 'D,A,B',
  'el operador de una sola tienda no ve las reparaciones de otra');
select is((public.reparaciones_de_cliente('c5000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002')->>'total_filas')::int, 0,
  'pedir una tienda inaccesible no devuelve nada');

select pg_temp.como('e1000000-0000-0000-0000-000000000003');
select is(pg_temp.claves(public.reparaciones_de_cliente('c5000000-0000-0000-0000-000000000001')), 'D,A,B',
  'con lectura se ven las reparaciones de las tiendas accesibles');

select pg_temp.como('e1000000-0000-0000-0000-000000000005');
select throws_ok($$select public.reparaciones_de_cliente('c5000000-0000-0000-0000-000000000001')$$, '42501', null,
  'sin acceso a Service técnico se rechaza con 42501');

-- ============================================================================
-- Aislamiento entre organizaciones
-- ============================================================================

select pg_temp.como('e2000000-0000-0000-0000-000000000001');
select is((public.reparaciones_de_cliente('c5000000-0000-0000-0000-000000000001')->>'total_filas')::int, 0,
  'otra organización no ve las reparaciones de un cliente ajeno');
select is((public.reparaciones_de_cliente('c5000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001')->>'total_filas')::int, 0,
  'otra organización no las ve pidiendo la tienda ajena');
select is((public.reparaciones_de_cliente('c6000000-0000-0000-0000-000000000001')->>'total_filas')::int, 0,
  'su propio cliente sin reparaciones devuelve vacío');

select * from finish();
rollback;
