-- F-SVC-21 (MSF-146, épica MSF-124): reingreso por garantía (SC-004).
-- Cubre FR-020 (columna, FK compuesta, check, sin escritura directa), FR-021 (copia de datos, número siguiente,
-- primer estado activo, historial, actividad), FR-023 (vínculos), FR-024 (solo entregada y no anulada, varios
-- reingresos, reingreso de un reingreso) y FR-025 (numeración sin repetidos ni saltos; la concurrencia real no cabe
-- en una transacción: se verifica el bloqueo de numeración y la secuencia), aislamiento entre organizaciones y por
-- tienda, `anon` sin ejecución y RLS en toda tabla.
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
    (select id from dominio.estados_reparacion where organizacion_id = '11111111-1111-1111-1111-111111111111' and cierra order by orden limit 1) as cierra_uno;
grant select on datos to public;


create temp table rg (clave text primary key, id uuid);
grant select, insert on rg to public;

-- ============================================================================
-- Diseño y privilegios (FR-020)
-- ============================================================================

select has_column('dominio', 'reparaciones', 'reparacion_origen_id', 'reparaciones tiene reparacion_origen_id');
select ok(exists (select 1 from pg_constraint where conrelid = 'dominio.reparaciones'::regclass
    and contype = 'f' and pg_get_constraintdef(oid) like 'FOREIGN KEY (reparacion_origen_id, organizacion_id)%'),
  'FK compuesta (reparacion_origen_id, organizacion_id)');
select ok(exists (select 1 from pg_constraint where conrelid = 'dominio.reparaciones'::regclass
    and contype = 'c' and pg_get_constraintdef(oid) like '%reparacion_origen_id <> id%'),
  'check reparacion_origen_id <> id');
select ok(exists (select 1 from pg_indexes where schemaname = 'dominio' and tablename = 'reparaciones'
    and indexname = 'reparaciones_origen_idx' and indexdef like '%reparacion_origen_id IS NOT NULL%'),
  'índice parcial del origen');
select ok(has_column_privilege('authenticated', 'dominio.reparaciones', 'reparacion_origen_id', 'select'),
  'authenticated lee reparacion_origen_id');
select ok(not has_column_privilege('authenticated', 'dominio.reparaciones', 'reparacion_origen_id', 'insert')
      and not has_column_privilege('authenticated', 'dominio.reparaciones', 'reparacion_origen_id', 'update'),
  'sin escritura directa de reparacion_origen_id');
select ok(not has_column_privilege('anon', 'dominio.reparaciones', 'reparacion_origen_id', 'select'),
  'anon no lee reparacion_origen_id');
select is(
  (select count(*) from unnest(array[
    'public.reingresar_por_garantia(uuid,text,uuid,date)',
    'public.obtener_vinculos_garantia(uuid)'
  ]) f where has_function_privilege('anon', f::regprocedure, 'execute'))::int,
  0, 'anon no ejecuta las RPC de garantía');
select is(
  (select count(*) from unnest(array[
    'public.reingresar_por_garantia(uuid,text,uuid,date)',
    'public.obtener_vinculos_garantia(uuid)'
  ]) f where has_function_privilege('authenticated', f::regprocedure, 'execute'))::int,
  2, 'authenticated ejecuta las dos RPC de garantía');
select ok((select prosrc like '%siguiente_numero_reparacion%' and prosrc like '%for update%'
             from pg_proc where oid = 'public.reingresar_por_garantia(uuid,text,uuid,date)'::regprocedure),
  'la numeración usa el bloqueo vigente y el origen se bloquea (for update)');

-- ============================================================================
-- Reingreso
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000001');

insert into rg (clave, id)
select 'entregada', (public.crear_reparacion('a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001',
  (select modelo_uno from datos), 'Ana 11-5555', 'SN-123', 'Cargador', 'No enciende', 100, 50)->>'id')::uuid;
insert into rg (clave, id)
select 'abierta', (public.crear_reparacion('a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos))->>'id')::uuid;
insert into rg (clave, id)
select 'anulada', (public.crear_reparacion('a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos))->>'id')::uuid;
insert into rg (clave, id)
select 'tienda_b', (public.crear_reparacion('a1000000-0000-0000-0000-000000000002', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos))->>'id')::uuid;

select public.registrar_entrega_reparacion((select id from rg where clave = 'entregada'), (select cierra_uno from datos),
  (now() at time zone 'America/Argentina/Buenos_Aires')::date, 'Ana');
select public.registrar_entrega_reparacion((select id from rg where clave = 'tienda_b'), (select cierra_uno from datos),
  (now() at time zone 'America/Argentina/Buenos_Aires')::date, 'Ana');
select public.anular_reparacion((select id from rg where clave = 'anulada'), 'Duplicada');

-- No entregada o anulada: rechazada (55000, FR-024).
select throws_ok(format($$select public.reingresar_por_garantia(%L, 'Falla')$$, (select id from rg where clave = 'abierta')),
  '55000', null, 'una reparación no entregada no se reingresa');
select throws_ok(format($$select public.reingresar_por_garantia(%L, 'Falla')$$, (select id from rg where clave = 'anulada')),
  '55000', null, 'una reparación anulada no se reingresa');
select throws_ok($$select public.reingresar_por_garantia(gen_random_uuid(), 'Falla')$$,
  'P0002', null, 'un origen inexistente es P0002');

-- Validaciones (22023 con hint).
select throws_ok(format($$select public.reingresar_por_garantia(%L, '   ')$$, (select id from rg where clave = 'entregada')),
  '22023', 'Describí la falla del reingreso', 'la falla vacía se rechaza');
select throws_ok(format($$select public.reingresar_por_garantia(%L, 'Falla', 'e1000000-0000-0000-0000-000000000003')$$, (select id from rg where clave = 'entregada')),
  '22023', 'El técnico no es válido', 'un técnico no elegible se rechaza');
select throws_ok(format($$select public.reingresar_por_garantia(%L, 'Falla', null, current_date - 5)$$, (select id from rg where clave = 'entregada')),
  '22023', 'La entrega prevista no puede ser anterior al ingreso', 'entrega prevista anterior al ingreso se rechaza');
select is((select count(*)::int from dominio.reparaciones where reparacion_origen_id is not null), 0,
  'los rechazos no dejan reparaciones nuevas');

-- Alta correcta: copia de datos, número siguiente, primer estado activo, ingreso de hoy.
insert into rg (clave, id)
select 're1', (public.reingresar_por_garantia((select id from rg where clave = 'entregada'), '  Se apaga sola  ',
  'e1000000-0000-0000-0000-000000000002', (now() at time zone 'America/Argentina/Buenos_Aires')::date + 7)->>'id')::uuid;

select is((select numero from dominio.reparaciones where id = (select id from rg where clave = 're1')),
  (select numero from dominio.reparaciones where id = (select id from rg where clave = 'abierta')) + 2,
  'el reingreso toma el siguiente número de la tienda');
select is(
  (select row(empresa_id, cliente_id, contacto, modelo_id, numero_serie, accesorios)::text
     from dominio.reparaciones where id = (select id from rg where clave = 're1')),
  (select row(empresa_id, cliente_id, contacto, modelo_id, numero_serie, accesorios)::text
     from dominio.reparaciones where id = (select id from rg where clave = 'entregada')),
  'copia tienda, cliente, contacto, modelo, N.º de serie y accesorios');
select is((select falla from dominio.reparaciones where id = (select id from rg where clave = 're1')), 'Se apaga sola',
  'la falla es la nueva, sin espacios');
select is((select estado_id from dominio.reparaciones where id = (select id from rg where clave = 're1')),
  (select id from dominio.estados_reparacion where organizacion_id = '11111111-1111-1111-1111-111111111111' and activo order by orden, id limit 1),
  'queda en el primer estado activo');
select is((select ingreso_en from dominio.reparaciones where id = (select id from rg where clave = 're1')),
  (now() at time zone 'America/Argentina/Buenos_Aires')::date, 'ingreso de hoy');
select is((select entrega_real from dominio.reparaciones where id = (select id from rg where clave = 're1')), null::date,
  'nace sin entrega real');
select is((select reparacion_origen_id from dominio.reparaciones where id = (select id from rg where clave = 're1')),
  (select id from rg where clave = 'entregada'), 'queda vinculada al origen');
select is(
  (select row(tecnico_id, entrega_prevista)::text from dominio.reparaciones where id = (select id from rg where clave = 're1')),
  row('e1000000-0000-0000-0000-000000000002'::uuid, (now() at time zone 'America/Argentina/Buenos_Aires')::date + 7)::text,
  'conserva técnico y entrega prevista');
select is((select (public.obtener_reparacion(id)->>'total_cliente')::numeric from rg where clave = 're1'), 0::numeric,
  'nace sin ítems ni importes');
select is((select (public.obtener_reparacion(id)->>'costo_mano_obra')::numeric from rg where clave = 're1'), 0::numeric,
  'no copia el costo de mano de obra');
select is((select (public.obtener_reparacion(id)->>'costo_repuestos')::numeric from rg where clave = 're1'), 0::numeric,
  'no copia el costo de repuestos');
select is(
  (select row(tipo, nota, estado_anterior_id)::text from dominio.reparacion_historial where reparacion_id = (select id from rg where clave = 're1')),
  row('alta', 'Reingreso por garantía de ' || (public.obtener_reparacion((select id from rg where clave = 'entregada'))->>'codigo'), null::uuid)::text,
  'el historial tiene el alta con la nota de garantía');
select is((select count(*)::int from public.registro_actividad
            where tipo = 'reparacion.reingreso_garantia' and organizacion_id = '11111111-1111-1111-1111-111111111111'
              and empresa_id = 'a1000000-0000-0000-0000-000000000001' and detalle ~ 'R-[0-9]+'
              and detalle !~* '[0-9a-f]{8}-[0-9a-f]{4}'), 1,
  'deja la actividad con códigos visibles y la tienda');

-- Varios reingresos de la misma original, reingreso de un reingreso (FR-024) y numeración sin saltos (FR-025).
insert into rg (clave, id)
select 're2', (public.reingresar_por_garantia((select id from rg where clave = 'entregada'), 'Otra falla')->>'id')::uuid;
select is(
  (select (select numero from dominio.reparaciones where id = (select id from rg where clave = 're2'))
        - (select numero from dominio.reparaciones where id = (select id from rg where clave = 're1'))),
  1, 'dos reingresos seguidos tienen números consecutivos, sin repetidos ni saltos');
select is((select count(*)::int from dominio.reparaciones where reparacion_origen_id = (select id from rg where clave = 'entregada')), 2,
  'se permiten varios reingresos de la misma original');
select public.registrar_entrega_reparacion((select id from rg where clave = 're1'), (select cierra_uno from datos),
  (now() at time zone 'America/Argentina/Buenos_Aires')::date, 'Ana');
insert into rg (clave, id)
select 're3', (public.reingresar_por_garantia((select id from rg where clave = 're1'), 'Tercera vez')->>'id')::uuid;
select is((select reparacion_origen_id from dominio.reparaciones where id = (select id from rg where clave = 're3')),
  (select id from rg where clave = 're1'), 'se puede reingresar un reingreso entregado');
select is((select count(distinct numero) = count(*) from dominio.reparaciones
            where empresa_id = 'a1000000-0000-0000-0000-000000000001'), true, 'no hay números repetidos en la tienda');
select is((select max(numero) - min(numero) + 1 = count(*) from dominio.reparaciones
            where empresa_id = 'a1000000-0000-0000-0000-000000000001'), true, 'no hay saltos en la numeración de la tienda');

-- La columna no se escribe directamente (FR-020).
select throws_ok(format($$update dominio.reparaciones set reparacion_origen_id = %L where id = %L$$,
  (select id from rg where clave = 'entregada'), (select id from rg where clave = 'abierta')),
  '42501', null, 'no se fija el origen por escritura directa');

-- ============================================================================
-- Vínculos (FR-023)
-- ============================================================================

select is(public.obtener_vinculos_garantia((select id from rg where clave = 're1'))->'origen',
  jsonb_build_object('id', (select id from rg where clave = 'entregada'),
                     'codigo', (public.obtener_reparacion((select id from rg where clave = 'entregada'))->>'codigo')),
  'la nueva muestra su origen');
select is(jsonb_array_length(public.obtener_vinculos_garantia((select id from rg where clave = 'entregada'))->'reingresos'), 2,
  'la original lista sus reingresos');
select is(public.obtener_vinculos_garantia((select id from rg where clave = 'entregada'))->'origen', 'null'::jsonb,
  'la original no tiene origen');
select is(public.obtener_vinculos_garantia((select id from rg where clave = 'entregada'))->'reingresos'->0->>'estado',
  (public.obtener_reparacion((select id from rg where clave = 're1'))->>'estado'),
  'cada reingreso informa su estado');
select is(public.obtener_vinculos_garantia((select id from rg where clave = 'abierta')),
  '{"origen": null, "reingresos": []}'::jsonb, 'sin vínculos devuelve origen nulo y lista vacía');
select throws_ok($$select public.obtener_vinculos_garantia(gen_random_uuid())$$, 'P0002', null, 'vínculos de una reparación inexistente es P0002');

-- ============================================================================
-- Permisos y aislamiento
-- ============================================================================

-- Operador: edita, pero solo en San Javucho.
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select lives_ok(format($$select public.reingresar_por_garantia(%L, 'Operador')$$, (select id from rg where clave = 'entregada')),
  'el operador reingresa en su tienda');
select throws_ok(format($$select public.reingresar_por_garantia(%L, 'Operador')$$, (select id from rg where clave = 'tienda_b')),
  '42501', null, 'el operador no reingresa desde una tienda sin acceso');
select throws_ok(format($$select public.obtener_vinculos_garantia(%L)$$, (select id from rg where clave = 'tienda_b')),
  'P0002', null, 'el operador no ve vínculos de una tienda sin acceso');

-- Consulta (lectura): ve los vínculos, no reingresa.
select pg_temp.como('e1000000-0000-0000-0000-000000000003');
select lives_ok(format($$select public.obtener_vinculos_garantia(%L)$$, (select id from rg where clave = 'entregada')),
  'lectura ve los vínculos');
select throws_ok(format($$select public.reingresar_por_garantia(%L, 'Consulta')$$, (select id from rg where clave = 'entregada')),
  '42501', null, 'lectura no reingresa');

-- Depósito (sin acceso a Service).
select pg_temp.como('e1000000-0000-0000-0000-000000000005');
select throws_ok(format($$select public.obtener_vinculos_garantia(%L)$$, (select id from rg where clave = 'entregada')),
  '42501', null, 'un rol sin Service no ve vínculos');

-- Otra organización.
select pg_temp.como('e2000000-0000-0000-0000-000000000001');
select throws_ok(format($$select public.reingresar_por_garantia(%L, 'Otra org')$$, (select id from rg where clave = 'entregada')),
  'P0002', null, 'otra organización no reingresa');
select throws_ok(format($$select public.obtener_vinculos_garantia(%L)$$, (select id from rg where clave = 'entregada')),
  'P0002', null, 'otra organización no ve vínculos');

-- anon.
reset role;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;
select throws_ok(format($$select public.reingresar_por_garantia(%L, 'Anon')$$, (select id from rg where clave = 'entregada')),
  '42501', null, 'anon no ejecuta reingresar_por_garantia');
select throws_ok(format($$select public.obtener_vinculos_garantia(%L)$$, (select id from rg where clave = 'entregada')),
  '42501', null, 'anon no ejecuta obtener_vinculos_garantia');
reset role;

-- RLS en todas las tablas expuestas (mismo recorrido que `rls_en_toda_tabla.test.sql`).
select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'dominio') and c.relkind in ('r', 'p') and not c.relispartition
      and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass
        and d.objid = c.oid and d.deptype = 'e')
      and not c.relrowsecurity)::int,
  0, 'toda tabla de public y dominio tiene RLS');

select * from finish();
rollback;
