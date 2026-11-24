-- Lote 38: dominio.empresas — CUIT, correo y WhatsApp solo para quien tiene la sección `empresas`.
-- Cubre: authenticated no lee las columnas sensibles de la tabla (ni con select *), sí las demás (selector de empresas),
-- las RPC empresa_datos y empresa_contacto_documentos según la sección, otra organización, y anon. El UPDATE por columnas sigue.
begin;

select plan(18);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');
insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'deposito@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'service@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'deposito'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'mostrador'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');
insert into dominio.empresas (id, organizacion_id, nombre, whatsapp, correo, cuit, direccion) values
  ('e1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Tienda A', '+5491100000000', 'a@tienda.example', '30712345671', 'Calle 1'),
  ('e2000000-0000-0000-0000-00000000000d', '22222222-2222-2222-2222-222222222222', 'Tienda D', '+5491122222222', 'd@tienda.example', '30712345671', 'Calle 4');
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'deposito'),
  ('d1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'mostrador');
insert into usuario_empresa_activa (user_id, empresa_id) values
  ('d1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-00000000000a'),
  ('d1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-00000000000a');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Rol sin sección empresas (depósito): lista básica sí, columnas sensibles no.
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is((select nombre from dominio.empresas where id = 'e1000000-0000-0000-0000-00000000000a'), 'Tienda A', 'lee las columnas básicas (selector de empresas)');
select throws_ok($$select cuit from dominio.empresas$$, '42501', null, 'no lee el CUIT');
select throws_ok($$select correo from dominio.empresas$$, '42501', null, 'no lee el correo');
select throws_ok($$select whatsapp from dominio.empresas$$, '42501', null, 'no lee el WhatsApp');
select throws_ok($$select * from dominio.empresas$$, '42501', null, 'select * tampoco devuelve las sensibles');
select throws_ok($$select * from public.empresa_datos('e1000000-0000-0000-0000-00000000000a')$$, '42501', null, 'empresa_datos exige la sección empresas');
select throws_ok($$select * from public.empresa_contacto_documentos('e1000000-0000-0000-0000-00000000000a')$$, '42501', null, 'el contacto para documentos exige empresas o service_tecnico');

-- Técnico (service_tecnico): contacto para documentos sin CUIT; no empresa_datos.
select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select is((select correo from public.empresa_contacto_documentos('e1000000-0000-0000-0000-00000000000a')), 'a@tienda.example', 'service_tecnico lee el contacto para el documento');
select throws_ok($$select * from public.empresa_datos('e1000000-0000-0000-0000-00000000000a')$$, '42501', null, 'service_tecnico no lee los datos completos');
select throws_ok($$select * from public.empresa_contacto_documentos('e2000000-0000-0000-0000-00000000000d')$$, '42501', null, 'ni el contacto de una empresa de otra organización');

-- Administrador: datos completos; el UPDATE por columnas sigue.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is((select cuit from public.empresa_datos('e1000000-0000-0000-0000-00000000000a')), '30712345671', 'el administrador lee el CUIT por la RPC');
select is((select count(*)::int from public.empresa_datos('e2000000-0000-0000-0000-00000000000d')), 0, 'una empresa de otra organización no devuelve filas');
select lives_ok($$update dominio.empresas set correo = 'nuevo@tienda.example' where id = 'e1000000-0000-0000-0000-00000000000a'$$, 'el administrador sigue pudiendo actualizar el correo');
select is((select correo from public.empresa_datos('e1000000-0000-0000-0000-00000000000a')), 'nuevo@tienda.example', 'y lo lee de vuelta por la RPC');

-- Otra organización.
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.empresa_datos('e1000000-0000-0000-0000-00000000000a')), 0, 'la Dos no lee datos de la Uno');

-- anon.
reset role;
select is(has_column_privilege('anon', 'dominio.empresas', 'cuit', 'select'), false, 'anon no lee el CUIT');
select is(has_function_privilege('anon', 'public.empresa_datos(uuid)', 'execute'), false, 'anon no ejecuta empresa_datos');
select is(has_function_privilege('anon', 'public.empresa_contacto_documentos(uuid)', 'execute'), false, 'anon no ejecuta el contacto para documentos');

select * from finish();
rollback;
