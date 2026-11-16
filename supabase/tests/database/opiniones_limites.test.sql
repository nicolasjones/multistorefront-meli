-- MSF-467 · Opiniones, Fase 3 (T020). RF-OPI-17, CA-OPI-10. Límite por visitante (HMAC) con claves propias:
--   escritura 10 por minuto (cuentan las inválidas), lectura 30 por minuto (ficha y «Mis opiniones»), sin cuenta no gasta cupo, «sin-ip» compartido.
begin;

select plan(21);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');
insert into auth.users (id, email) values
  ('f5000000-0000-0000-0000-000000000001', 'cli-a@example.com'),
  ('f5000000-0000-0000-0000-000000000002', 'cli-b@example.com'),
  ('f5000000-0000-0000-0000-000000000003', 'suspendida@example.com'),
  ('f5000000-0000-0000-0000-000000000004', 'nohabilitada@example.com'),
  ('f5000000-0000-0000-0000-000000000005', 'panel@example.com'),
  ('f5000000-0000-0000-0000-000000000006', 'cli-x@example.com'),
  ('f5000000-0000-0000-0000-000000000007', 'cli-a2@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f5000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo');
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda B', true),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Tienda pausada', false),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda X', true);
insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'opi-a.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'opi-b.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000003', 'opi-p.ejemplo.com'),
  ('22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-000000000001', 'opi-x.ejemplo.com');
-- P1 y P2 visibles en A y B; P3 oculto en A; P4 inactivo; P5 de otra organización.
insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Alfa', 'SKU-ALFA', 1000, 'ARS', true),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Beta', 'SKU-BETA', 2000, 'ARS', true),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Oculto en A', 'SKU-OCU', 500, 'ARS', true),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Inactivo', 'SKU-INA', 500, 'ARS', false),
  ('a2000000-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222', 'Otra organización', 'SKU-OTR', 500, 'ARS', true);
insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo)
select ('b1000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, '11111111-1111-1111-1111-111111111111', 'Masivo ' || n, 'MAS-' || n, 100, 'ARS', true
  from generate_series(1, 60) n;
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id)
select p.id, 'e1000000-0000-0000-0000-000000000001', p.organizacion_id
  from dominio.productos p where p.organizacion_id = '11111111-1111-1111-1111-111111111111';
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id) values
  ('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111'),
  ('a1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111'),
  ('a2000000-0000-0000-0000-000000000005', 'e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222');
insert into dominio.productos_tienda (empresa_id, producto_id, organizacion_id, visible, destacado) values
  ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', false, false);
insert into dominio.existencias (producto_id, organizacion_id, cantidad)
select p.id, p.organizacion_id, 7 from dominio.productos p
on conflict (producto_id) do update set cantidad = excluded.cantidad;

insert into dominio.clientes (id, organizacion_id, numero, nombre, correo, tipo) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 910, 'Valeria Sánchez', 'v@example.com', 'minorista'),
  ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 911, 'Bruno Díaz', 'b@example.com', 'minorista'),
  ('c1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 912, 'Suspendida Ejemplo', 'su@example.com', 'minorista'),
  ('c1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 913, 'No habilitada', 'nh@example.com', 'minorista'),
  ('c1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 914, 'Carla Gómez', 'c@example.com', 'minorista'),
  ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 910, 'Xavier Otro', 'x@example.com', 'minorista');
insert into clientes_empresas (cliente_id, empresa_id, organizacion_id) values
  ('c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111'),
  ('c1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c1000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c2000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222');
insert into cuentas_cliente (id, organizacion_id, cliente_id, empresa_id, auth_user_id, estado) values
  ('ca000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000001', 'activa'),
  ('ca000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000002', 'f5000000-0000-0000-0000-000000000002', 'activa'),
  ('ca000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000003', 'suspendida'),
  ('ca000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000004', 'activa'),
  ('ca000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000007', 'activa'),
  ('ca000000-0000-0000-0000-000000000009', '22222222-2222-2222-2222-222222222222', 'c2000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000006', 'activa');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
create function pg_temp.anonimo() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
end $$;
create temp table res (k text primary key, v jsonb);
grant all on res to public;
select set_config('request.headers', '{"x-forwarded-for":"10.5.0.1"}', true);

update public.banderas_plataforma set activa = true where clave = 'tienda_opiniones';
create function pg_temp.ip(n integer) returns void language sql as $$
  select set_config('request.headers', json_build_object('x-forwarded-for', '10.8.0.' || n)::text, true);
$$;

-- Escritura: 10 llamadas por minuto por visitante; cuentan también las inválidas (CA-OPI-10)
select pg_temp.ip(1);
select pg_temp.como('f5000000-0000-0000-0000-000000000001');
select is((select count(*)::int from generate_series(1, 5) n
            where publico.guardar_opinion_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000002', 0, 'x')->>'estado' = 'invalido'), 5, 'las 5 primeras inválidas responden invalido');
select is((select count(*)::int from generate_series(1, 5) n
            where publico.borrar_opinion_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000002')->>'estado' = 'ok'), 5, 'borrar comparte el cupo de escritura (10 en total)');
insert into res select 'l11', publico.guardar_opinion_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000002', 0, 'x');
select is((select v->>'estado' from res where k = 'l11'), 'limite', 'la 11.ª llamada del minuto: limite, aun inválida');
select ok((select (v->>'espera_segundos')::int between 1 and 60 from res where k = 'l11'), 'trae espera_segundos');
select is(publico.guardar_opinion_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000002', 5, 'Un comentario válido y largo')->>'estado', 'limite', 'una válida tampoco pasa');
select is(publico.borrar_opinion_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000002')->>'estado', 'limite', 'borrar tampoco');
reset role;
select is((select count(*)::int from dominio.opiniones_producto), 0, 'lo limitado no guardó nada');

-- Otro visitante (otra IP) tiene su propio cupo
select pg_temp.ip(2);
select pg_temp.como('f5000000-0000-0000-0000-000000000001');
select is(publico.guardar_opinion_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000002', 5, 'Un comentario válido y largo')->>'estado', 'ok', 'otra IP: cupo propio');

-- Sin cuenta no se gasta cupo (la cuenta se verifica antes que el límite)
reset role;
delete from public.limite_pedidos_publicos;
select pg_temp.ip(3);
select pg_temp.como('f5000000-0000-0000-0000-000000000002');
select is((select count(*)::int from generate_series(1, 12) n
            where publico.guardar_opinion_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000002', 5, 'Un comentario válido y largo')->>'estado' = 'sin_acceso'), 12, 'sin acceso nunca responde limite (no gasta cupo)');
reset role;
select is((select count(*)::int from public.limite_pedidos_publicos where visitante like 'opinion|%'), 0, 'sin acceso: ninguna fila del limitador');

-- Sin cabecera x-forwarded-for: un único cupo compartido («sin-ip», falla cerrada)
select set_config('request.headers', '{}', true);
select pg_temp.como('f5000000-0000-0000-0000-000000000001');
select is((select count(*)::int from generate_series(1, 10) n
            where publico.guardar_opinion_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000002', 0, 'x')->>'estado' = 'invalido'), 10, 'sin cabecera: 10 llamadas pasan');
select pg_temp.como('f5000000-0000-0000-0000-000000000007');
select is(publico.guardar_opinion_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000002', 0, 'x')->>'estado', 'limite', 'sin cabecera: todos comparten el mismo cupo');

-- Lectura: 30 por minuto por visitante, clave propia
reset role;
delete from public.limite_pedidos_publicos;
select pg_temp.ip(4);
select pg_temp.anonimo();
select is((select count(*)::int from generate_series(1, 30) n
            where publico.opiniones_producto_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001')->>'estado' = 'ok'), 30, 'lectura: 30 llamadas pasan');
select is(publico.opiniones_producto_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001')->>'estado', 'limite', 'lectura: la 31.ª es limite');
select is(publico.opiniones_producto_por_dominio('opi-a.ejemplo.com', null)->>'estado', 'limite', 'lectura: una llamada inválida también cuenta');
reset role;
select is((select count(*)::int from public.limite_pedidos_publicos where visitante like 'opinion|lectura|%'), 1, 'la lectura usa su clave propia');
select is((select count(*)::int from public.limite_pedidos_publicos where visitante like 'opinion|escritura|%'), 0, 'y no toca la de escritura');

-- «Mis opiniones» comparte el cupo de lectura (30 por minuto): el catálogo efectivo no se evalúa sin tope
reset role;
delete from public.limite_pedidos_publicos;
select pg_temp.ip(5);
select pg_temp.como('f5000000-0000-0000-0000-000000000001');
select is((select count(*)::int from generate_series(1, 30) n
            where publico.mis_opiniones_por_dominio('opi-a.ejemplo.com')->>'estado' = 'ok'), 30, 'mis opiniones: 30 llamadas pasan');
select is(publico.mis_opiniones_por_dominio('opi-a.ejemplo.com')->>'estado', 'limite', 'mis opiniones: la 31.ª es limite');
select ok((publico.mis_opiniones_por_dominio('opi-a.ejemplo.com')->>'espera_segundos')::int between 1 and 60, 'mis opiniones: trae espera_segundos');
reset role;
select is((select count(*)::int from public.limite_pedidos_publicos where visitante like 'opinion|lectura|%'), 1, 'mis opiniones usa la clave de lectura');

select * from finish();
rollback;
