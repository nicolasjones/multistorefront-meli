-- Lote 42: `dominio.empresas` — UPDATE por sección `empresas` en edición (antes: `puede_escribir`, global) y sin fuga de
-- CUIT, correo ni WhatsApp por la política de SELECT. Cubre: administrador edita; rol sin la sección no (RLS: cero filas);
-- rol personalizado con `empresas` en edición sí edita (aunque no sea administrador); otra organización no; la fuga
-- por filtro (`where cuit = …`) y por `returning` sigue cerrada; la identidad visual de la tienda no depende de esta política.
begin;

select plan(11);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');
insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'administracion@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'administracion'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');
insert into dominio.empresas (id, organizacion_id, nombre, cuit, correo) values
  ('e1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Tienda A', '30712345671', 'a@tienda.example'),
  ('e2000000-0000-0000-0000-00000000000d', '22222222-2222-2222-2222-222222222222', 'Tienda D', '30712345671', 'd@tienda.example');
-- Rol de la organización con la sección `empresas` en edición sin ser administrador (matriz editable, MSF-2).
update public.permisos_rol set nivel = 'edicion'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'administracion' and seccion = 'empresas';

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Operador (sección empresas en ninguno): lee la lista básica, no edita ni filtra por columnas sensibles.
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is((select count(*)::int from dominio.empresas), 1, 'el miembro ve la fila de su organización (selector de empresas)');
select throws_ok($$select id from dominio.empresas where cuit = '30712345671'$$, '42501', null, 'no averigua el CUIT filtrando por la columna');
select throws_ok($$update dominio.empresas set nombre = 'x' where id = 'e1000000-0000-0000-0000-00000000000a' returning correo$$, '42501', null, 'ni lee el correo con returning');
with u as (update dominio.empresas set nombre = 'Hackeada' where id = 'e1000000-0000-0000-0000-00000000000a' returning 1)
select is((select count(*)::int from u), 0, 'sin la sección empresas el UPDATE no afecta filas');

-- Administración con empresas=edicion (no administrador): ahora puede editar.
select pg_temp.como('d1000000-0000-0000-0000-000000000003');
with u as (update dominio.empresas set instagram = '@a' where id = 'e1000000-0000-0000-0000-00000000000a' returning 1)
select is((select count(*)::int from u), 1, 'un rol con empresas en edición edita aunque no sea administrador');

-- Administrador: edita, también horarios (columna de la tienda) y activa.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
with u as (update dominio.empresas set nombre = 'Tienda A bis', horarios = 'Lu a Vi 9 a 18', activa = true where id = 'e1000000-0000-0000-0000-00000000000a' returning 1)
select is((select count(*)::int from u), 1, 'el administrador edita nombre, horarios y activa');
with u as (update dominio.empresas set nombre = 'Cruzada' where id = 'e2000000-0000-0000-0000-00000000000d' returning 1)
select is((select count(*)::int from u), 0, 'no edita una empresa de otra organización');
select throws_ok($$update dominio.empresas set organizacion_id = '22222222-2222-2222-2222-222222222222' where id = 'e1000000-0000-0000-0000-00000000000a'$$, '42501', null, 'organizacion_id sigue inmutable (grant por columna)');

-- Política: ya no usa puede_escribir y sí la sección.
reset role;
select is((select count(*)::int from pg_policies where schemaname = 'dominio' and tablename = 'empresas' and policyname = 'empresas_update'
  and qual like '%nivel_seccion%' and with_check like '%nivel_seccion%' and qual not like '%puede_escribir%'), 1,
  'empresas_update exige nivel_seccion(empresas) en using y with check');

-- Otra organización: no toca la empresa de la primera.
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
with u as (update dominio.empresas set nombre = 'Hackeada' where id = 'e1000000-0000-0000-0000-00000000000a' returning 1)
select is((select count(*)::int from u), 0, 'otra organización no edita la empresa');
select is((select count(*)::int from dominio.empresas where nombre like 'Tienda A%'), 0, 'ni siquiera la ve');

select * from finish();
rollback;
