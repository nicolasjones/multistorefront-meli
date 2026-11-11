-- MSF-164 (revisión independiente, hallazgos 6 y 12): tope de 50 páginas por empresa en
-- `guardar_pagina_tienda` y bordes del contenido (10000 / 10001 puntos de código, con emoji).
begin;

select plan(12);

insert into organizaciones (id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Organización Uno');
insert into auth.users (id, email) values ('d1000000-0000-0000-0000-000000000001', 'admin-tope@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador');
insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Uno A'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Uno B');
insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'tope-uno-a.ejemplo.com');

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

-- Bordes del contenido (el texto se recorta con btrim antes de contar).
select lives_ok(
  $$select public.guardar_pagina_tienda('e1000000-0000-0000-0000-000000000001', null, 'Borde exacto', repeat('a', 10000), false)$$,
  'un contenido de exactamente 10000 caracteres se acepta'
);
select throws_ok(
  $$select public.guardar_pagina_tienda('e1000000-0000-0000-0000-000000000001', null, 'Borde excedido', repeat('a', 10001), false)$$,
  '22023', 'El contenido no puede superar los 10000 caracteres', 'un contenido de 10001 caracteres se rechaza'
);
select lives_ok(
  $$select public.guardar_pagina_tienda('e1000000-0000-0000-0000-000000000001', null, 'Emoji exacto', repeat('😀', 10000), false)$$,
  '10000 emoji (20000 unidades UTF-16, 10000 puntos de código) se aceptan: se cuenta por caracteres'
);
select throws_ok(
  $$select public.guardar_pagina_tienda('e1000000-0000-0000-0000-000000000001', null, 'Emoji excedido', repeat('😀', 10001), false)$$,
  '22023', 'El contenido no puede superar los 10000 caracteres', '10001 emoji se rechazan'
);

-- Tope de páginas: ya hay 2; se completan hasta 50.
select lives_ok(
  $$select public.guardar_pagina_tienda('e1000000-0000-0000-0000-000000000001', null, 'Pagina ' || g, 'x', false) from generate_series(1, 48) g$$,
  'se llega a 50 páginas'
);
select is(
  (select count(*)::int from dominio.tienda_paginas where empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  50,
  'la empresa tiene exactamente 50 páginas'
);
select throws_ok(
  $$select public.guardar_pagina_tienda('e1000000-0000-0000-0000-000000000001', null, 'La 51', 'x', false)$$,
  '22023', 'La empresa ya tiene el máximo de 50 páginas. Eliminá alguna para crear otra', 'la página 51 se rechaza con un mensaje claro'
);
select is(
  (select count(*)::int from dominio.tienda_paginas where empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  50,
  'el rechazo no guarda nada'
);
select lives_ok(
  $$select public.guardar_pagina_tienda('e1000000-0000-0000-0000-000000000001', (select id from dominio.tienda_paginas where slug = 'pagina-1'), 'Pagina 1 editada', 'y', true)$$,
  'con 50 páginas, editar una existente sigue permitido'
);
select lives_ok(
  $$select public.guardar_pagina_tienda('e1000000-0000-0000-0000-000000000002', null, 'Otra empresa', 'x', false)$$,
  'el tope es por empresa: otra empresa de la organización puede crear'
);
select lives_ok(
  $$select public.eliminar_pagina_tienda('e1000000-0000-0000-0000-000000000001', (select id from dominio.tienda_paginas where slug = 'pagina-2'))$$,
  'al eliminar una página se libera un lugar'
);
select lives_ok(
  $$select public.guardar_pagina_tienda('e1000000-0000-0000-0000-000000000001', null, 'La 51 ahora si', 'x', false)$$,
  'tras eliminar, se puede crear otra'
);

select * from finish();
rollback;
