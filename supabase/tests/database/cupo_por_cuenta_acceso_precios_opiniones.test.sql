-- MSF-1001: cupo por cuenta en publico.acceso_cliente_por_dominio, publico.precios_cliente_por_dominio y
-- publico.mis_opiniones_por_dominio. El tope real (240, 240 y 120) se baja a 3 SOLO en esta transacción para
-- recorrer la frontera con llamadas reales: 3 pasan, la 4.ª responde `limite`. Cubre además: contadores
-- independientes entre las tres funciones y entre cuentas, la respuesta normal sin cambios, el cupo
-- persistido (fila en limite_pedidos_publicos) y que `precios` ya no gasta el cupo de `acceso`.
begin;

select plan(19);

insert into organizaciones (id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Organización Uno');
insert into auth.users (id, email) values
  ('f9400000-0000-0000-0000-000000000001', 'cupo-a@example.com'),
  ('f9400000-0000-0000-0000-000000000002', 'cupo-b@example.com');
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('a9400000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda Cupo', true);
insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'a9400000-0000-0000-0000-000000000001', 'cupo.ejemplo.com');
insert into dominio.clientes (id, organizacion_id, numero, nombre, correo, tipo) values
  ('c9400000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 91, 'Cuenta A', 'ca@example.com', 'mayorista'),
  ('c9400000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 92, 'Cuenta B', 'cb@example.com', 'minorista');
insert into clientes_empresas (cliente_id, empresa_id, organizacion_id) values
  ('c9400000-0000-0000-0000-000000000001', 'a9400000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c9400000-0000-0000-0000-000000000002', 'a9400000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');
insert into cuentas_cliente (id, organizacion_id, cliente_id, empresa_id, auth_user_id, estado) values
  ('ca940000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c9400000-0000-0000-0000-000000000001', 'a9400000-0000-0000-0000-000000000001', 'f9400000-0000-0000-0000-000000000001', 'activa'),
  ('ca940000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'c9400000-0000-0000-0000-000000000002', 'a9400000-0000-0000-0000-000000000001', 'f9400000-0000-0000-0000-000000000002', 'activa');
update public.banderas_plataforma set activa = true where clave = 'tienda_opiniones';

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Los topes reales.
select is(private.limite_acceso_cliente_por_minuto(), 240, 'el cupo real de acceso es de 240 llamadas por minuto y cuenta');
select is(private.limite_precios_cliente_por_minuto(), 240, 'el cupo real de precios es de 240 llamadas por minuto y cuenta');
select is(private.limite_llamadas_cuenta_por_minuto(), 120, 'el cupo real de opiniones por cuenta (el de «Mi cuenta») es de 120');

-- Se bajan a 3 solo en esta transacción.
create or replace function private.limite_acceso_cliente_por_minuto() returns integer language sql immutable set search_path = '' as $$ select 3; $$;
create or replace function private.limite_precios_cliente_por_minuto() returns integer language sql immutable set search_path = '' as $$ select 3; $$;
create or replace function private.limite_llamadas_cuenta_por_minuto() returns integer language sql immutable set search_path = '' as $$ select 3; $$;
delete from public.limite_pedidos_publicos;

-- ACCESO: la cuenta A llama 3 veces (la respuesta normal, sin cambios) y la 4.ª recibe `limite`.
select pg_temp.como('f9400000-0000-0000-0000-000000000001');
select is(publico.acceso_cliente_por_dominio('cupo.ejemplo.com'), '{"estado": "activa", "tipo": "mayorista"}'::jsonb, 'acceso: la 1.ª llamada responde como siempre');
select publico.acceso_cliente_por_dominio('cupo.ejemplo.com');
select is(publico.acceso_cliente_por_dominio('cupo.ejemplo.com') ->> 'estado', 'activa', 'acceso: la 3.ª llamada (el tope) todavía responde');
select is(publico.acceso_cliente_por_dominio('cupo.ejemplo.com') ->> 'estado', 'limite', 'acceso: la 4.ª llamada supera el cupo');
select ok((publico.acceso_cliente_por_dominio('cupo.ejemplo.com') ->> 'espera_segundos')::int between 1 and 60, 'acceso: avisa cuántos segundos esperar');
reset role;
select is((select pedidos from public.limite_pedidos_publicos where visitante = 'acceso|f9400000-0000-0000-0000-000000000001' and ventana = date_trunc('minute', now())), 5,
  'acceso: el contador se persistió y cuenta también las llamadas rechazadas');

-- Otra cuenta no se ve afectada.
select pg_temp.como('f9400000-0000-0000-0000-000000000002');
select is(publico.acceso_cliente_por_dominio('cupo.ejemplo.com') ->> 'estado', 'activa', 'acceso: el cupo es por cuenta: otra cuenta sigue respondiendo');
-- Sin sesión no hay cuenta ni cupo.
reset role;
select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
set local role authenticated;
select is(publico.acceso_cliente_por_dominio('cupo.ejemplo.com'), '{"estado": "sin_cuenta", "tipo": null}'::jsonb, 'acceso: sin sesión responde igual y no toma cupo');
reset role;
select is((select count(*)::int from public.limite_pedidos_publicos where visitante like 'acceso|%'), 2, 'acceso: sin sesión no escribe ningún contador (solo los de las dos cuentas)');

-- PRECIOS: contador propio (la cuenta A ya agotó el de acceso y aun así precios responde) y no gasta el de acceso.
select pg_temp.como('f9400000-0000-0000-0000-000000000001');
select is(publico.precios_cliente_por_dominio('cupo.ejemplo.com', '{}') ->> 'tipo', 'mayorista', 'precios: responde con el tipo aunque el cupo de acceso esté agotado (contadores independientes)');
select publico.precios_cliente_por_dominio('cupo.ejemplo.com', '{}');
select publico.precios_cliente_por_dominio('cupo.ejemplo.com', '{}');
select is(publico.precios_cliente_por_dominio('cupo.ejemplo.com', '{}') ->> 'estado', 'limite', 'precios: la 4.ª llamada supera el cupo');
reset role;
select is((select pedidos from public.limite_pedidos_publicos where visitante = 'acceso|f9400000-0000-0000-0000-000000000001' and ventana = date_trunc('minute', now())), 5,
  'precios: no gastó el cupo de acceso (sigue en 5: ya no llama a la pública)');
select is((select pedidos from public.limite_pedidos_publicos where visitante = 'precios|f9400000-0000-0000-0000-000000000001' and ventana = date_trunc('minute', now())), 4,
  'precios: su propio contador quedó persistido');

-- OPINIONES: cupo por cuenta, además del de visitante.
select pg_temp.como('f9400000-0000-0000-0000-000000000001');
select is(publico.mis_opiniones_por_dominio('cupo.ejemplo.com') ->> 'estado', 'ok', 'opiniones: la 1.ª llamada responde como siempre');
select publico.mis_opiniones_por_dominio('cupo.ejemplo.com');
select publico.mis_opiniones_por_dominio('cupo.ejemplo.com');
select is(publico.mis_opiniones_por_dominio('cupo.ejemplo.com') ->> 'estado', 'limite', 'opiniones: la 4.ª llamada supera el cupo por cuenta');
reset role;
select is((select pedidos from public.limite_pedidos_publicos where visitante = 'opiniones_cuenta|ca940000-0000-0000-0000-000000000001' and ventana = date_trunc('minute', now())), 4,
  'opiniones: el contador de la cuenta quedó persistido, separado del de «Mi cuenta»');
select is((select count(*)::int from public.limite_pedidos_publicos where visitante = 'cuenta|ca940000-0000-0000-0000-000000000001'), 0,
  'opiniones: no usa el contador de las cinco RPC de «Mi cuenta»');

select * from finish();
rollback;
