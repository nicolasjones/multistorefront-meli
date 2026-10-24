-- MSF-562 · F-NOT-01 (FR-012): la consulta nueva emite su aviso con private.emitir_aviso, de modo que
-- respeta preferencias, agrupación y el acceso a la empresa, en lugar de salir directo.
begin;

select plan(17);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno');

insert into auth.users (id, email) values
  ('a1000000-0000-0000-0000-000000000001', 'admin1@example.com'),
  ('a1000000-0000-0000-0000-000000000002', 'admin2@example.com'),
  ('a1000000-0000-0000-0000-000000000003', 'operador@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'operador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Mundo JC');

-- La persona operadora tiene la sección `consultas`, pero solo acceso a Mundo JC.
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('a1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-00000000000b',
   '11111111-1111-1111-1111-111111111111', 'operador');

insert into dominio.productos (id, organizacion_id, nombre, precio_lista) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Remera', 1000);

-- ============================================================================
-- La rama de fallo no frena el alta (FR-012)
-- ============================================================================

delete from public.tipos_aviso where clave = 'consulta_nueva';

select throws_ok(
  $$select private.emitir_aviso('consulta_nueva', '11111111-1111-1111-1111-111111111111', '{}'::jsonb)$$,
  '22023', null, 'sin el tipo en el catálogo, emitir_aviso falla'
);

insert into dominio.consultas (id, organizacion_id, empresa_id, origen, nombre, contacto, mensaje) values
  ('c1000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111',
   'a1000000-0000-0000-0000-00000000000a', 'formulario', 'Falla', 'falla@example.com', 'Igual se guarda');

select is(
  (select count(*)::int from dominio.consultas where id = 'c1000000-0000-0000-0000-000000000009'), 1,
  'aunque emitir falle, la consulta se guarda'
);
select is(
  (select count(*)::int from public.avisos_pendientes), 0,
  'la rama de fallo no deja avisos a medias'
);

insert into public.tipos_aviso (clave, nombre, seccion) values
  ('consulta_nueva', 'Consulta nueva', 'consultas');

-- La segunda persona apaga el aviso de consulta nueva.
insert into public.preferencias_aviso (user_id, tipo_aviso, activo)
values ('a1000000-0000-0000-0000-000000000002', 'consulta_nueva', false);

insert into dominio.consultas (id, organizacion_id, empresa_id, origen, nombre, contacto, mensaje, producto_id) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'a1000000-0000-0000-0000-00000000000a', 'formulario', 'Ana Pérez', 'ana@example.com', 'Hola',
   'd1000000-0000-0000-0000-000000000001');

select is((select count(*)::int from public.avisos_pendientes where tipo_aviso = 'consulta_nueva'), 1,
  'la consulta nueva encola un aviso solo para quien lo tiene encendido');
select is((select user_id from public.avisos_pendientes where tipo_aviso = 'consulta_nueva'),
  'a1000000-0000-0000-0000-000000000001'::uuid, 'el destinatario es la persona con la preferencia encendida');
select is((select datos ->> 'Empresa' from public.avisos_pendientes), 'San Javucho', 'el aviso lleva el nombre de la empresa');
select is((select datos ->> 'Nombre' from public.avisos_pendientes), 'Ana Pérez', 'el aviso lleva el nombre del visitante');
select is((select datos ->> 'Origen' from public.avisos_pendientes), 'Formulario de contacto', 'el aviso lleva el origen legible');
select is((select datos ->> 'Mensaje' from public.avisos_pendientes), 'Hola', 'el aviso lleva el mensaje');
select is((select datos ->> 'Producto' from public.avisos_pendientes), 'Remera', 'el aviso lleva el nombre del producto');
select is((select count(*)::int from dominio.consultas_avisos), 0, 'ya no se encola por el camino directo');

-- Agrupación: una segunda consulta dentro de la ventana suma al mismo grupo.
insert into dominio.consultas (id, organizacion_id, empresa_id, origen, nombre, contacto) values
  ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'a1000000-0000-0000-0000-00000000000a', 'whatsapp', 'Carlos', '+54 9 11 5555-1234');
select is((select count(*)::int from public.avisos_pendientes where tipo_aviso = 'consulta_nueva' and datos ->> 'Empresa' = 'San Javucho'), 2, 'la segunda consulta suma otro aviso');
select is((select count(distinct grupo_id)::int from public.avisos_pendientes where datos ->> 'Empresa' = 'San Javucho'), 1, 'los dos avisos comparten grupo (agrupación)');
select is((select datos ->> 'Origen' from public.avisos_pendientes where datos ->> 'Nombre' = 'Carlos'), 'WhatsApp', 'origen WhatsApp legible');
select ok((select not (datos ? 'Mensaje') from public.avisos_pendientes where datos ->> 'Nombre' = 'Carlos'),
  'sin mensaje, el aviso no trae la clave');

-- ============================================================================
-- Aislamiento por empresa (FR-012, Principios I y VIII)
-- ============================================================================

insert into dominio.consultas (id, organizacion_id, empresa_id, origen, nombre, contacto, mensaje) values
  ('c1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'a1000000-0000-0000-0000-00000000000b', 'formulario', 'Bruno', 'bruno@example.com', 'De Mundo JC');

select is(
  (select count(*)::int from public.avisos_pendientes
    where user_id = 'a1000000-0000-0000-0000-000000000003' and datos ->> 'Empresa' = 'Mundo JC'), 1,
  'quien accede a la empresa recibe su aviso'
);
select is(
  (select count(*)::int from public.avisos_pendientes
    where user_id = 'a1000000-0000-0000-0000-000000000003' and datos ->> 'Empresa' = 'San Javucho'), 0,
  'quien no accede a la empresa no recibe el aviso con los datos del visitante'
);

select * from finish();
rollback;
