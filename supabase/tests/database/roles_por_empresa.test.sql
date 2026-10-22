-- F-ROL-04 · Rol por empresa (épica MSF-121, FR-001…FR-008, SC-001).
-- 2 organizaciones × empresas; una persona es Operador en la empresa A y Consulta en la B,
-- sobre tablas de prueba de Ventas (por empresa), Consultas (por empresa) y Productos
-- (compartida). Fixture como postgres; verificaciones como `authenticated` (request.jwt.claims).
begin;

select plan(36);

-- ============================================================================
-- Fixture
-- ============================================================================

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Tienda A'),
  ('e1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Tienda B'),
  ('e2000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222', 'Tienda C');

insert into auth.users (id, email) values
  ('c1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('c1000000-0000-0000-0000-000000000002', 'doble@example.com'),
  ('c1000000-0000-0000-0000-000000000003', 'sin-empresas@example.com'),
  ('c1000000-0000-0000-0000-000000000004', 'sin-activa@example.com'),
  ('c2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

-- `doble` tiene rol de organización `administracion` a propósito: sus niveles por empresa
-- (Operador / Consulta) difieren del que le daría el rol de organización.
insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'administracion'),
  ('c1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('c1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'administracion'),
  ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('c1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('c1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('c1000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'operador');

insert into usuario_empresa_activa (user_id, empresa_id) values
  ('c1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-00000000000a');

-- Tablas de prueba con el contrato de nivel_seccion (se descartan con el rollback).
create table public.prueba_ventas (
  id int generated always as identity primary key,
  organizacion_id uuid not null references organizaciones (id),
  nombre text not null
);
create table public.prueba_consultas (like public.prueba_ventas including all);
create table public.prueba_productos (like public.prueba_ventas including all);

do $$
declare
  t record;
begin
  for t in select * from (values ('prueba_ventas', 'ventas'), ('prueba_consultas', 'consultas'), ('prueba_productos', 'productos')) v(tabla, seccion) loop
    execute format('alter table public.%I enable row level security', t.tabla);
    execute format($p$create policy %I on public.%I for select to authenticated
      using (organizacion_id = (select private.organizacion_id()) and (select private.nivel_seccion(%L)) in ('lectura', 'edicion'))$p$,
      t.tabla || '_select', t.tabla, t.seccion);
    execute format($p$create policy %I on public.%I for insert to authenticated
      with check (organizacion_id = (select private.organizacion_id()) and (select private.nivel_seccion(%L)) = 'edicion')$p$,
      t.tabla || '_insert', t.tabla, t.seccion);
    execute format('grant select, insert on public.%I to authenticated', t.tabla);
  end loop;
end $$;

grant usage on all sequences in schema public to authenticated;

insert into public.prueba_ventas (organizacion_id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Venta Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Venta Dos');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Esquema, RLS y restricciones (FR-001, FR-002, FR-004)
-- ============================================================================

select has_table('public', 'usuarios_empresas', 'usuarios_empresas vive en public');
select has_table('public', 'usuario_empresa_activa', 'usuario_empresa_activa vive en public');
select ok(
  (select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('usuarios_empresas', 'usuario_empresa_activa')),
  'ambas tablas tienen RLS');

select throws_ok(
  $$insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id)
    values ('c1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'administrador')$$,
  '23514', null, 'el rol administrador por empresa lo rechaza la base');
select throws_ok(
  $$insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id)
    values ('c1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'miembro')$$,
  '23514', null, 'el rol miembro por empresa lo rechaza la base');
select throws_ok(
  $$insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id)
    values ('c1000000-0000-0000-0000-000000000003', 'e2000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'consulta')$$,
  '23514', null, 'una empresa de otra organización se rechaza');
select throws_ok(
  $$insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id)
    values ('c2000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', '22222222-2222-2222-2222-222222222222', 'consulta')$$,
  '23514', null, 'una empresa que no es de la organización declarada se rechaza');
select lives_ok(
  $$insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id)
    values ('c1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'mostrador')$$,
  'una asignación válida se acepta');
delete from usuarios_empresas where user_id = 'c1000000-0000-0000-0000-000000000003';

-- ============================================================================
-- Rol por empresa en secciones por empresa (escenario 1, SC-001)
-- ============================================================================

select pg_temp.como('c1000000-0000-0000-0000-000000000002');

select is((select private.nivel_seccion('ventas')), 'edicion', 'Operador en la empresa activa A: ventas = edicion');
select lives_ok(
  $$insert into public.prueba_ventas (organizacion_id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Nueva A')$$,
  'con A activa puede insertar ventas');
select is((select private.nivel_seccion('consultas')), 'edicion', 'Operador en A: consultas = edicion');
select ok((select private.puede_accion('ventas', 'exportar')), 'Operador en A puede exportar ventas');
select ok(not (select private.puede_accion('ventas', 'eliminar')), 'Operador no elimina ventas (solo Administrador)');

reset role;
update usuario_empresa_activa set empresa_id = 'e1000000-0000-0000-0000-00000000000b'
  where user_id = 'c1000000-0000-0000-0000-000000000002';
select pg_temp.como('c1000000-0000-0000-0000-000000000002');

select is((select private.nivel_seccion('ventas')), 'lectura', 'Consulta en la empresa activa B: ventas = lectura');
select throws_ok(
  $$insert into public.prueba_ventas (organizacion_id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Nueva B')$$,
  '42501', null, 'con B activa la base rechaza escribir ventas');
select is((select count(*)::int from public.prueba_ventas), 2, 'con B activa lee las ventas de su organización, no las de la otra');
select ok(not (select private.puede_accion('ventas', 'exportar')), 'Consulta en B no exporta ventas');

-- Compartida: el mejor nivel entre sus empresas, sin importar la activa (escenario 2).
select is((select private.nivel_seccion('productos')), 'edicion', 'productos compartida = mejor nivel (Operador) con B activa');
select lives_ok(
  $$insert into public.prueba_productos (organizacion_id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Producto')$$,
  'puede insertar productos con B activa');

-- Sección no listada: rol de organización (escenario 4).
select is((select private.nivel_seccion('rentabilidad')), 'lectura', 'rentabilidad (no listada) = rol de organización administracion');

-- ============================================================================
-- Empresa activa inválida (casos borde)
-- ============================================================================

reset role;
update dominio.empresas set activa = false where id = 'e1000000-0000-0000-0000-00000000000b';
select pg_temp.como('c1000000-0000-0000-0000-000000000002');
select is((select private.nivel_seccion('ventas')), 'edicion', 'sin empresa activa válida: ventas = mejor rol entre sus empresas (A Operador) — «Todas mis empresas»');
select is((select private.nivel_seccion('productos')), 'edicion', 'las compartidas siguen con la otra empresa (A)');

-- Asignación quitada: la empresa activa (B, reactivada) ya no es válida para la persona.
reset role;
update dominio.empresas set activa = true where id = 'e1000000-0000-0000-0000-00000000000b';
delete from usuarios_empresas
  where user_id = 'c1000000-0000-0000-0000-000000000002' and empresa_id = 'e1000000-0000-0000-0000-00000000000b';
select pg_temp.como('c1000000-0000-0000-0000-000000000002');
select is((select private.nivel_seccion('ventas')), 'edicion', 'asignación quitada a la activa: ventas = mejor rol entre las que quedan (A) — «Todas mis empresas»');
select is((select private.nivel_seccion('productos')), 'edicion', 'asignación quitada: la compartida sigue con la otra empresa (A)');
select ok((select private.puede_accion('productos', 'exportar')), 'asignación quitada: puede_accion en sección compartida usa la otra empresa (A)');

reset role;
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('c1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'consulta');
update dominio.empresas set activa = false where id = 'e1000000-0000-0000-0000-00000000000b';

-- Usuario suspendido en la organización: ninguna empresa es válida.
update usuarios_organizacion set estado = 'suspendido'
  where user_id = 'c1000000-0000-0000-0000-000000000002';
select pg_temp.como('c1000000-0000-0000-0000-000000000002');
select is((select private.nivel_seccion('ventas')), 'ninguno', 'usuario suspendido: ventas = ninguno');
select is((select private.nivel_seccion('productos')), 'ninguno', 'usuario suspendido: la compartida también = ninguno');
reset role;
update usuarios_organizacion set estado = 'activo'
  where user_id = 'c1000000-0000-0000-0000-000000000002';

select pg_temp.como('c1000000-0000-0000-0000-000000000004');
select is((select private.nivel_seccion('ventas')), 'edicion', 'con asignaciones y sin empresa activa: ventas = mejor rol (Operador en A) — «Todas mis empresas»');

-- Sin asignaciones: rol de organización (supuesto de la spec).
select pg_temp.como('c1000000-0000-0000-0000-000000000003');
select is((select private.nivel_seccion('ventas')), 'lectura', 'sin asignaciones: rol de organización (consulta) en ventas');

-- ============================================================================
-- Administrador, aislamiento y privilegios (escenarios 3 y 5)
-- ============================================================================

select pg_temp.como('c1000000-0000-0000-0000-000000000001');
select is((select private.nivel_seccion('ventas')), 'edicion', 'Administrador sin filas: edicion');
select is((select count(*)::int from private.empresas_accesibles()), 1, 'Administrador accede a todas las empresas activas de su organización (B inactiva)');

select pg_temp.como('c2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.usuarios_empresas), 0, 'otra organización no ve asignaciones ajenas');

select pg_temp.como('c1000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.usuarios_empresas), 0, 'un usuario no ve las asignaciones de otros');
select throws_ok(
  $$insert into public.usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id)
    values ('c1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'operador')$$,
  '42501', null, 'authenticated no escribe usuarios_empresas directamente');

reset role;
set local role anon;
select throws_ok($$select * from public.usuarios_empresas$$, '42501', null, 'anon no lee usuarios_empresas');
select throws_ok($$select * from public.usuario_empresa_activa$$, '42501', null, 'anon no lee usuario_empresa_activa');

select * from finish();
rollback;
