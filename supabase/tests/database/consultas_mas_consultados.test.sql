-- F-REP-04 (MSF-236, épica MSF-192, SC-007): `analitica.consultas_producto_mas_consultado` y
-- `public.consultas_reportes_conteo`.
--
-- Cuenta los toques de `dominio.intereses_whatsapp` por empresa × producto × fecha: orden por
-- consultas, conteo por rango, última consulta, filtro por empresa, período vacío, sin costo ni margen
-- y sin acceso para `anon` ni `authenticated` (solo el rol de Superset lee la vista).
--
-- Las fechas son RELATIVAS al reloj de la base (`current_date - n`), no absolutas. Las filas se arman
-- como `postgres` (la tabla no tiene política de escritura); la RPC se prueba como `authenticated`.
begin;

select plan(25);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('c1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('c1000000-0000-0000-0000-000000000002', 'consulta-uno@example.com'),
  ('c2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Tienda A'),
  ('e1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Tienda B'),
  ('e2000000-0000-0000-0000-00000000000d', '22222222-2222-2222-2222-222222222222', 'Tienda D');

insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Alfa', 'PC-1', 'ARS', 100),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Beta', 'PC-2', 'ARS', 100),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Dos', 'PD-1', 'ARS', 100);

-- Instante a una hora local de Buenos Aires de un día relativo a hoy.
create function pg_temp.instante(p_dias int, p_hora interval) returns timestamptz language sql as $$
  select ((current_date - p_dias)::timestamp + p_hora) at time zone 'America/Argentina/Buenos_Aires'
$$;

-- Org Uno: Alfa en Tienda A = 3 toques (dos hace 3 días —uno a las 23:30, que en UTC ya es el día
-- siguiente— y uno ayer); Beta en Tienda A = 1 (hace 3 días); Alfa en Tienda B = 2 (ayer).
-- Org Dos: Dos en Tienda D = 5 (ayer).
insert into dominio.intereses_whatsapp (organizacion_id, empresa_id, producto_id, created_at) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-000000000001', pg_temp.instante(3, interval '15 hours')),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-000000000001', pg_temp.instante(3, interval '23 hours 30 minutes')),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-000000000001', pg_temp.instante(1, interval '10 hours')),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-000000000002', pg_temp.instante(3, interval '12 hours')),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-00000000000b', 'a1000000-0000-0000-0000-000000000001', pg_temp.instante(1, interval '9 hours')),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-00000000000b', 'a1000000-0000-0000-0000-000000000001', pg_temp.instante(1, interval '11 hours'));
insert into dominio.intereses_whatsapp (organizacion_id, empresa_id, producto_id, created_at)
select '22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-00000000000d',
       'b2000000-0000-0000-0000-000000000001', pg_temp.instante(1, interval '13 hours')
  from generate_series(1, 5);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Contrato de la vista
-- ============================================================================

select is(
  (select array_agg(a.attname::text order by a.attnum)
     from pg_catalog.pg_attribute a
    where a.attrelid = 'analitica.consultas_producto_mas_consultado'::regclass
      and a.attnum > 0 and not a.attisdropped),
  array['organizacion_id', 'empresa_id', 'empresa_nombre', 'producto_id', 'producto_nombre', 'sku', 'fecha', 'consultas', 'ultima_consulta'],
  'columnas del contrato: organizacion_id y empresa_id para la cláusula rls, y la cantidad de consultas'
);
select is(
  (select count(*)::int from pg_catalog.pg_attribute a
    where a.attrelid = 'analitica.consultas_producto_mas_consultado'::regclass
      and a.attnum > 0 and not a.attisdropped
      and a.attname ~* '(costo|margen|precio|neto)'),
  0, 'la vista no expone costo ni margen'
);
select is(
  (select relkind::text from pg_catalog.pg_class where oid = 'analitica.consultas_producto_mas_consultado'::regclass),
  'v', 'es una vista (analitica no tiene tablas)'
);

-- ============================================================================
-- Orden, conteo por rango, última consulta, empresa y vacío (se lee como dueño: la vista es cerrada)
-- ============================================================================

select is(
  (select array_agg(producto_nombre order by total desc, producto_nombre)
     from (select producto_nombre, sum(consultas) as total
             from analitica.consultas_producto_mas_consultado
            where organizacion_id = '11111111-1111-1111-1111-111111111111'
            group by producto_nombre) t),
  array['Alfa', 'Beta'], 'ordenados por cantidad de consultas: Alfa antes que Beta'
);
select is(
  (select sum(consultas)::int from analitica.consultas_producto_mas_consultado
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and producto_nombre = 'Alfa'),
  5, 'Alfa suma sus toques de las dos tiendas (3 + 2)'
);
select is(
  (select sum(consultas)::int from analitica.consultas_producto_mas_consultado
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and producto_nombre = 'Beta'),
  1, 'Beta suma 1'
);
select is(
  (select sum(consultas)::int from analitica.consultas_producto_mas_consultado
    where organizacion_id = '11111111-1111-1111-1111-111111111111'
      and fecha between current_date - 3 and current_date - 3),
  3, 'rango de un solo día: los 3 toques de hace 3 días, incluido el de las 23:30 hora local'
);
select is(
  (select sum(consultas)::int from analitica.consultas_producto_mas_consultado
    where organizacion_id = '11111111-1111-1111-1111-111111111111'
      and fecha between current_date - 2 and current_date),
  3, 'rango que deja afuera hace 3 días: solo los toques de ayer (1 + 2)'
);
select is(
  (select max(ultima_consulta) from analitica.consultas_producto_mas_consultado
    where organizacion_id = '11111111-1111-1111-1111-111111111111'
      and producto_nombre = 'Alfa' and empresa_nombre = 'Tienda A'),
  pg_temp.instante(1, interval '10 hours'), 'la última consulta de Alfa en Tienda A es la de ayer a las 10'
);
select is(
  (select sum(consultas)::int from analitica.consultas_producto_mas_consultado
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and empresa_nombre = 'Tienda A'),
  4, 'filtro por empresa: Tienda A cuenta solo lo suyo'
);
select is(
  (select sum(consultas)::int from analitica.consultas_producto_mas_consultado
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and empresa_nombre = 'Tienda B'),
  2, 'filtro por empresa: Tienda B cuenta solo lo suyo'
);
select is(
  (select count(*)::int from analitica.consultas_producto_mas_consultado
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and fecha > current_date),
  0, 'un período sin consultas no devuelve filas'
);

-- ============================================================================
-- Acceso: solo el rol de Superset lee la vista
-- ============================================================================

select ok(not has_table_privilege('anon', 'analitica.consultas_producto_mas_consultado', 'SELECT'), 'anon no lee la vista');
select ok(not has_table_privilege('authenticated', 'analitica.consultas_producto_mas_consultado', 'SELECT'), 'authenticated no lee la vista');
select ok(has_table_privilege('superset_analitica', 'analitica.consultas_producto_mas_consultado', 'SELECT'), 'el rol de Superset lee la vista');
select ok(
  not has_table_privilege('superset_analitica', 'analitica.consultas_producto_mas_consultado', 'INSERT,UPDATE,DELETE,TRUNCATE'),
  'el rol de Superset no escribe en la vista'
);
select pg_temp.como('c1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select * from analitica.consultas_producto_mas_consultado$$,
  '42501', null, 'un usuario autenticado (aun administrador) no lee la vista directamente'
);
reset role;

-- ============================================================================
-- RPC de conteo del estado vacío
-- ============================================================================

select ok(
  not has_function_privilege('anon', 'public.consultas_reportes_conteo(date,date,uuid)', 'execute'),
  'anon no ejecuta el conteo'
);
select ok(
  has_function_privilege('authenticated', 'public.consultas_reportes_conteo(date,date,uuid)', 'execute'),
  'authenticated ejecuta el conteo (la autorización va adentro)'
);

select pg_temp.como('c1000000-0000-0000-0000-000000000001');
select is(
  public.consultas_reportes_conteo(current_date - 10, current_date), 6,
  'el conteo del período es el de la organización (6), sin los toques de la otra'
);
select is(
  public.consultas_reportes_conteo(current_date - 10, current_date, 'e1000000-0000-0000-0000-00000000000b'), 2,
  'el conteo acepta el filtro por empresa'
);
select is(
  public.consultas_reportes_conteo(current_date - 10, current_date, 'e2000000-0000-0000-0000-00000000000d'), 0,
  'una empresa de otra organización cuenta 0'
);
select is(
  public.consultas_reportes_conteo(current_date + 1, current_date + 5), 0,
  'un período sin consultas cuenta 0 (estado vacío)'
);
select throws_ok(
  $$select public.consultas_reportes_conteo(current_date, current_date - 1)$$,
  '22023', null, 'un rango invertido se rechaza'
);
reset role;

select pg_temp.como('c1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select public.consultas_reportes_conteo(current_date - 10, current_date)$$,
  '42501', null, 'un rol sin la sección reportes no puede pedir el conteo'
);
reset role;

select * from finish();
rollback;
