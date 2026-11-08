-- MSF-149 (revisión independiente, hallazgos 3 y 11): endurecimiento de dominio.tienda_legal_enlaces
-- (URL sin credenciales, tope defensivo de 10 enlaces por empresa) y lectura denegada a un usuario
-- autenticado SIN permiso sobre la sección `empresas`.
begin;

select plan(11);

insert into organizaciones (id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Organización Uno');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-lim@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'miembro-lim@example.com');

-- `administrador` tiene edición sobre `empresas`; `deposito` tiene «ninguno» (matriz inicial de roles).
insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'deposito');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Lim A'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Lim B');

-- URL: sin credenciales en la autoridad.
select throws_ok(
  $$insert into dominio.tienda_legal_enlaces (organizacion_id, empresa_id, titulo, url)
    values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'x', 'https://usuario@host.ejemplo.com/t')$$,
  '23514', null, 'https://usuario@host se rechaza'
);
select throws_ok(
  $$insert into dominio.tienda_legal_enlaces (organizacion_id, empresa_id, titulo, url)
    values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'x', 'https://usuario:clave@host.ejemplo.com')$$,
  '23514', null, 'https://usuario:clave@host (sin ruta) se rechaza'
);
select throws_ok(
  $$insert into dominio.tienda_legal_enlaces (organizacion_id, empresa_id, titulo, url)
    values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'x', 'https://@host.ejemplo.com?x=1')$$,
  '23514', null, 'un @ vacío en la autoridad (antes de ?) se rechaza'
);
select lives_ok(
  $$insert into dominio.tienda_legal_enlaces (organizacion_id, empresa_id, titulo, url, orden)
    values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'Con arroba en la ruta', 'https://host.ejemplo.com/@perfil?m=a@b', 0)$$,
  'un @ en la ruta o la query es válido'
);

-- Tope defensivo: 10 por empresa.
select lives_ok(
  $$insert into dominio.tienda_legal_enlaces (organizacion_id, empresa_id, titulo, url, orden)
    select '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'E' || g, 'https://host.ejemplo.com/' || g, g
      from generate_series(1, 9) g$$,
  'hasta 10 enlaces por empresa (1 + 9)'
);
select throws_ok(
  $$insert into dominio.tienda_legal_enlaces (organizacion_id, empresa_id, titulo, url)
    values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'Sobra', 'https://host.ejemplo.com/11')$$,
  '23514', 'Una empresa admite hasta 10 enlaces legales.', 'el enlace 11 de la misma empresa se rechaza'
);
select lives_ok(
  $$insert into dominio.tienda_legal_enlaces (organizacion_id, empresa_id, titulo, url)
    values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'Otra empresa', 'https://host.ejemplo.com/b')$$,
  'el tope es por empresa: otra empresa sigue pudiendo cargar'
);
select throws_ok(
  $$update dominio.tienda_legal_enlaces set empresa_id = 'e1000000-0000-0000-0000-000000000001' where titulo = 'Otra empresa'$$,
  '23514', null, 'mover un enlace a una empresa llena también se rechaza'
);

-- Lectura: administrador (empresas = edición) ve; deposito (empresas = ninguno) no ve nada.
select set_config('request.jwt.claims', json_build_object('sub', 'd1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from dominio.tienda_legal_enlaces), 11, 'administrador lee los enlaces de su organización');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'd1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from dominio.tienda_legal_enlaces), 0, 'sin permiso de sección empresas: lectura denegada (0 filas)');
select throws_ok(
  $$insert into dominio.tienda_legal_enlaces (organizacion_id, empresa_id, titulo, url)
    values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'x', 'https://host.ejemplo.com/z')$$,
  '42501', null, 'authenticated no escribe (sin privilegio de insert)'
);
reset role;

select * from finish();
rollback;
