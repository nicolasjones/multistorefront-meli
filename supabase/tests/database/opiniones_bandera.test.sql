-- MSF-467 · Opiniones, Fases 3 y 4 (T015). RF-OPI-12, CA-OPI-9, SC-004. Con la bandera apagada ninguna RPC de la tienda lee ni escribe datos:
--   sin_acceso (cuenta) o lista vacía (ficha), la tabla no cambia, no se gasta cupo y capacidades devuelve opiniones:false.
begin;

select plan(14);

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

insert into clientes (id, organizacion_id, numero, nombre, correo, tipo) values
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

-- La bandera queda APAGADA (valor por defecto de la migración); se verifica y no se enciende.
select is((select activa from public.banderas_plataforma where clave = 'tienda_opiniones'), false, 'la bandera nace apagada');
insert into dominio.opiniones_producto (id, organizacion_id, empresa_id, cuenta_cliente_id, producto_id, puntuacion, comentario, estado, moderada_por, moderada_en)
values ('0b000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001',
        'a1000000-0000-0000-0000-000000000001', 5, 'Opinión ya aceptada antes de apagar', 'aceptada', 'f5000000-0000-0000-0000-000000000005', now());
create temp table antes as select * from dominio.opiniones_producto;
grant all on antes to public;

select pg_temp.como('f5000000-0000-0000-0000-000000000001');
select is(publico.guardar_opinion_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000002', 5, 'Un comentario válido y largo'), '{"estado":"sin_acceso"}'::jsonb, 'apagada: guardar = sin_acceso');
select is(publico.guardar_opinion_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', 1, 'Editar con la bandera apagada'), '{"estado":"sin_acceso"}'::jsonb, 'apagada: editar = sin_acceso');
select is(publico.borrar_opinion_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001'), '{"estado":"sin_acceso"}'::jsonb, 'apagada: borrar = sin_acceso');
select is(publico.mis_opiniones_por_dominio('opi-a.ejemplo.com'), '{"estado":"sin_acceso"}'::jsonb, 'apagada: mis opiniones = sin_acceso');
select is(publico.guardar_opinion_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000002', 0, 'x'), '{"estado":"sin_acceso"}'::jsonb, 'apagada: ni siquiera valida (bandera primero)');
reset role;
select is((select count(*)::int from (select * from dominio.opiniones_producto except select * from antes) d), 0, 'apagada: la tabla no cambió (ninguna fila nueva ni modificada)');
select is((select count(*)::int from dominio.opiniones_producto), (select count(*)::int from antes), 'apagada: ninguna fila borrada ni agregada');
select is((select count(*)::int from public.limite_pedidos_publicos where visitante like 'opinion|%'), 0, 'apagada: no consume cupo por visitante');

-- Lectura pública apagada: lista vacía, sin tocar datos y sin error
select pg_temp.anonimo();
select is(publico.opiniones_producto_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001'),
  '{"estado":"ok","resumen":{"promedio":null,"cantidad":0},"filas":[],"siguiente":null}'::jsonb, 'apagada: la ficha no recibe nada aunque haya aceptadas');
select is(publico.capacidades_opiniones_por_dominio('opi-a.ejemplo.com'), '{"estado":"ok","opiniones":false}'::jsonb, 'apagada: capacidades opiniones = false');
select is(publico.capacidades_opiniones_por_dominio('desconocido.ejemplo.com'), '{"estado":"error"}'::jsonb, 'capacidades: host desconocido = error');
select is(publico.capacidades_opiniones_por_dominio('opi-p.ejemplo.com'), '{"estado":"error"}'::jsonb, 'capacidades: tienda pausada = error idéntico');
reset role;
update public.banderas_plataforma set activa = true where clave = 'tienda_opiniones';
select pg_temp.anonimo();
select is(publico.capacidades_opiniones_por_dominio('opi-a.ejemplo.com'), '{"estado":"ok","opiniones":true}'::jsonb, 'encendida: capacidades opiniones = true');

select * from finish();
rollback;
