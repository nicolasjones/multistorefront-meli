-- MSF-562 · F-NOT-01 (FR-012): la consulta nueva emite su aviso con private.emitir_aviso, de modo que
-- respeta preferencias y agrupación en lugar de salir directo.
begin;

select plan(11);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno');

insert into auth.users (id, email) values
  ('a1000000-0000-0000-0000-000000000001', 'admin1@example.com'),
  ('a1000000-0000-0000-0000-000000000002', 'admin2@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'San Javucho');

-- La segunda persona apaga el aviso de consulta nueva.
insert into public.preferencias_aviso (user_id, tipo_aviso, activo)
values ('a1000000-0000-0000-0000-000000000002', 'consulta_nueva', false);

insert into dominio.consultas (id, organizacion_id, empresa_id, origen, nombre, contacto, mensaje) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'a1000000-0000-0000-0000-00000000000a', 'formulario', 'Ana Pérez', 'ana@example.com', 'Hola');

select is((select count(*)::int from public.avisos_pendientes where tipo_aviso = 'consulta_nueva'), 1,
  'la consulta nueva encola un aviso solo para quien lo tiene encendido');
select is((select user_id from public.avisos_pendientes where tipo_aviso = 'consulta_nueva'),
  'a1000000-0000-0000-0000-000000000001'::uuid, 'el destinatario es la persona con la preferencia encendida');
select is((select datos ->> 'Empresa' from public.avisos_pendientes), 'San Javucho', 'el aviso lleva el nombre de la empresa');
select is((select datos ->> 'Nombre' from public.avisos_pendientes), 'Ana Pérez', 'el aviso lleva el nombre del visitante');
select is((select datos ->> 'Origen' from public.avisos_pendientes), 'Formulario de contacto', 'el aviso lleva el origen legible');
select is((select datos ->> 'Mensaje' from public.avisos_pendientes), 'Hola', 'el aviso lleva el mensaje');
select is((select count(*)::int from dominio.consultas_avisos), 0, 'ya no se encola por el camino directo');

-- Agrupación: una segunda consulta dentro de la ventana suma al mismo grupo.
insert into dominio.consultas (id, organizacion_id, empresa_id, origen, nombre, contacto) values
  ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'a1000000-0000-0000-0000-00000000000a', 'whatsapp', 'Carlos', '+54 9 11 5555-1234');
select is((select count(*)::int from public.avisos_pendientes where tipo_aviso = 'consulta_nueva'), 2, 'la segunda consulta suma otro aviso');
select is((select count(distinct grupo_id)::int from public.avisos_pendientes), 1, 'los dos avisos comparten grupo (agrupación)');
select is((select datos ->> 'Origen' from public.avisos_pendientes where datos ->> 'Nombre' = 'Carlos'), 'WhatsApp', 'origen WhatsApp legible');
select ok((select not (datos ? 'Mensaje') from public.avisos_pendientes where datos ->> 'Nombre' = 'Carlos'),
  'sin mensaje, el aviso no trae la clave');

select * from finish();
rollback;
