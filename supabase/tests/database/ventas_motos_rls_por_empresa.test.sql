-- F-VTA-24 (MSF-145): la lectura directa de `dominio.envios_moto` respeta el nivel de `ventas` DE LA TIENDA del
-- envío, no el más alto de la persona (hallazgo de la revisión final: con `ventas` en edición en la tienda A y sin
-- `ventas` en la B, se leían por la API los envíos de B aunque las RPC devolvían 0).
begin;

select plan(12);

insert into organizaciones (id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Org Uno');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000099', 'mixto@example.com'),
  ('d1000000-0000-0000-0000-000000000098', 'solo-a@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000099', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('d1000000-0000-0000-0000-000000000098', '11111111-1111-1111-1111-111111111111', 'operador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Tienda A'),
  ('a1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Tienda B');

-- «Mixto»: Operador en A y Consulta en B; el rol Consulta no tiene `ventas`. «Solo A»: Operador solo en A.
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000099', 'a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d1000000-0000-0000-0000-000000000099', 'a1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d1000000-0000-0000-0000-000000000098', 'a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'operador');
update permisos_rol set nivel = 'ninguno'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'consulta' and seccion = 'ventas';

insert into clientes (id, organizacion_id, numero, nombre, tipo) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Cliente', 'minorista');
insert into dominio.formas_envio (id, organizacion_id, empresa_id, nombre, tipo) values
  ('b1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'Moto A', 'moto'),
  ('b1000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000b', 'Moto B', 'moto');
insert into dominio.comprobantes_venta
  (id, organizacion_id, empresa_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva, confirmado_en, envio_id) values
  ('f1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000005', '2027-02-05', 'confirmada', 800, 800, now(), 'b1000000-0000-0000-0000-00000000000a'),
  ('f1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000b', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000006', '2027-02-06', 'confirmada', 900, 900, now(), 'b1000000-0000-0000-0000-00000000000c');
insert into dominio.envios_moto (organizacion_id, comprobante_id, mensajero, abono) values
  ('11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000005', 'Mensajero A', 4000),
  ('11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000006', 'Mensajero B', 5000);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

select pg_temp.como('d1000000-0000-0000-0000-000000000099');
select is(private.nivel_ventas_en_empresa('a1000000-0000-0000-0000-00000000000b'), 'ninguno',
  'sin ventas en la tienda B (el rol global es más alto por la tienda A)');
select is((select count(*) from dominio.envios_moto where mensajero = 'Mensajero B'), 0::bigint,
  'leyendo la tabla directo no ve los envíos de la tienda B, donde no tiene ventas');
select is((select count(*) from dominio.envios_moto where mensajero = 'Mensajero A'), 1::bigint,
  'sí ve los de la tienda A, donde tiene ventas');
select is((select count(*) from dominio.envios_moto), (select count(*) from public.listar_envios_moto()),
  'la lectura directa y listar_envios_moto coinciden');

select pg_temp.como('d1000000-0000-0000-0000-000000000098');
select is((select count(*) from dominio.envios_moto where mensajero = 'Mensajero B'), 0::bigint,
  'quien solo accede a la tienda A tampoco ve los de B');
select is((select count(*) from dominio.envios_moto), 1::bigint,
  'y ve exactamente el de su tienda');

-- puedo_registrar_envios_moto: la misma regla que registrar_envio_moto (rol Operador/Administrador y ventas en edición).
-- «Mixto» es Operador en A (puede) y Consulta en B (no: ni siquiera tiene ventas).
select pg_temp.como('d1000000-0000-0000-0000-000000000099');
select is(public.puedo_registrar_envios_moto('a1000000-0000-0000-0000-00000000000a'), true, 'Operador en la tienda A: puede registrar');
select is(public.puedo_registrar_envios_moto('a1000000-0000-0000-0000-00000000000b'), false, 'Consulta sin ventas en la tienda B: no puede');
select is(public.puedo_registrar_envios_moto(null), true, 'con «Todas las tiendas»: puede si puede en alguna');

-- Un Mostrador (ventas en edición, pero no es Operador ni Administrador) NO puede registrar.
reset role;
insert into auth.users (id, email) values ('d1000000-0000-0000-0000-000000000097', 'mostrador@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000097', '11111111-1111-1111-1111-111111111111', 'mostrador', 'activo');
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000097', 'a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'mostrador');
select pg_temp.como('d1000000-0000-0000-0000-000000000097');
select is(private.nivel_ventas_en_empresa('a1000000-0000-0000-0000-00000000000a'), 'edicion', 'Mostrador tiene ventas en edición');
select is(public.puedo_registrar_envios_moto('a1000000-0000-0000-0000-00000000000a'), false, 'pero no puede registrar envíos en moto (no es Operador ni Administrador)');

-- Sin sesión (anon) no se ejecuta.
reset role;
select is(has_function_privilege('anon', 'public.puedo_registrar_envios_moto(uuid)', 'EXECUTE'), false, 'anon no ejecuta puedo_registrar_envios_moto');

select * from finish();
rollback;
