-- MSF-287 · F-REP-08 (épica MSF-265, spec 20261101-100000-analitica-avanzada-y-resumen-por-correo,
-- FR-010, FR-013, FR-014): reclamo idempotente del resumen semanal por destinatario y semana,
-- cierre del envío (enviado / fallido con motivo), aislamiento por organización y privilegios
-- mínimos del rol de Kestra.
--
-- El fixture corre como postgres (RLS no aplica); las comprobaciones de RLS usan el rol
-- `authenticated` con el JWT de quien corresponde, igual que PostgREST.
begin;

select plan(32);

-- ============================================================================
-- Fixture
-- ============================================================================

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('a1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('a1000000-0000-0000-0000-000000000002', 'miembro-uno@example.com'),
  ('a2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'miembro', 'activo'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

-- Productos: la organización uno tiene un producto sin stock; la dos, dos sin stock y uno bajo.
-- El estado sale de `public.stock_estados` (la única fuente del estado de stock).
insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Teclado', 'TEC-1', 1000),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Mouse', 'MOU-2', 500),
  ('b2000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Teclado', 'TEC-2', 1000),
  ('b2000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Parlante', 'PAR-2', 800);

insert into dominio.existencias (producto_id, organizacion_id, cantidad, minimo) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 0, 5),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 0, 5),
  ('b2000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 3, 5),
  ('b2000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 0, 5)
on conflict (producto_id) do update
  set cantidad = excluded.cantidad, minimo = excluded.minimo;

-- Semanas de prueba: relativas al reloj (nada del test depende de una fecha fija).
create temp table semanas on commit drop as
select to_char(now() - interval '3 weeks', 'IYYY-"W"IW') as w1,
       to_char(now() - interval '2 weeks', 'IYYY-"W"IW') as w2,
       to_char(now() - interval '1 week', 'IYYY-"W"IW') as w3;

-- ============================================================================
-- Tipo de aviso (FR-010)
-- ============================================================================

select is(
  (select t.seccion from public.tipos_aviso t where t.clave = 'resumen_semanal'),
  'rentabilidad',
  'el tipo de aviso del resumen semanal vive en la sección rentabilidad'
);

select is(
  (select count(*)::int from public.tipos_aviso t where t.clave = 'resumen_semanal'),
  1,
  'el tipo de aviso del resumen semanal está registrado una sola vez'
);

-- ============================================================================
-- Reclamo idempotente por destinatario y semana (FR-010, FR-013)
-- ============================================================================

create temp table q1 on commit drop as
  select * from private.reclamar_resumen_semanal(50, (select w1 from semanas));

select is(
  (select count(*)::int from q1),
  2,
  'reclama un envío por destinatario con acceso (el miembro sin acceso a rentabilidad no entra)'
);

select is(
  (select q.organizacion_id from q1 q where q.destinatario = 'admin-uno@example.com'),
  '11111111-1111-1111-1111-111111111111',
  'cada envío se reclama para la organización del destinatario'
);

select is(
  (select count(*)::int from private.reclamar_resumen_semanal(50, (select w1 from semanas))),
  0,
  'reclamar dos veces la misma semana no duplica'
);

select is(
  (select e.estado from dominio.resumen_semanal_envios e where e.destinatario_id = 'a1000000-0000-0000-0000-000000000001'),
  'enviando',
  'la fila reclamada queda en envío'
);

select is(
  (select e.intentos from dominio.resumen_semanal_envios e where e.destinatario_id = 'a1000000-0000-0000-0000-000000000001'),
  1,
  'la fila cuenta el intento'
);

select ok(
  (select e.reclamado_hasta > now() from dominio.resumen_semanal_envios e where e.destinatario_id = 'a1000000-0000-0000-0000-000000000001'),
  'el reclamo tiene vencimiento'
);

select is(
  (select e.origen from dominio.resumen_semanal_envios e where e.destinatario_id = 'a1000000-0000-0000-0000-000000000001'),
  'kestra:resumen-semanal',
  'la fila deja registrado el origen de la corrida'
);

-- ============================================================================
-- Aislamiento por organización (FR-014)
-- ============================================================================

select is(
  (select count(*)::int from dominio.resumen_semanal_envios),
  2,
  'hay un envío por organización'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'a1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::int from dominio.resumen_semanal_envios),
  1,
  'el administrador ve solo los envíos de su organización'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'a2000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::int from dominio.resumen_semanal_envios),
  1,
  'la otra organización tampoco ve los envíos ajenos'
);

reset role;

-- ============================================================================
-- Cierre del envío (FR-013)
-- ============================================================================

select is(
  private.marcar_resumen_semanal_enviado(
    (select q.envio_id from q1 q where q.destinatario = 'admin-uno@example.com')),
  'enviado',
  'marcar enviado cierra el envío'
);

select is(
  private.marcar_resumen_semanal_enviado(
    (select q.envio_id from q1 q where q.destinatario = 'admin-uno@example.com')),
  'enviado',
  'repetir la marca es idempotente'
);

create temp table marca on commit drop as
select e.enviado_en
  from dominio.resumen_semanal_envios e
 where e.destinatario_id = 'a1000000-0000-0000-0000-000000000001';

select is(
  private.marcar_resumen_semanal_enviado(
    (select q.envio_id from q1 q where q.destinatario = 'admin-uno@example.com')),
  'enviado',
  'repetir la marca no falla'
);

select is(
  (select e.enviado_en from dominio.resumen_semanal_envios e where e.destinatario_id = 'a1000000-0000-0000-0000-000000000001'),
  (select m.enviado_en from marca m),
  'repetir la marca no cambia el momento del envío'
);

select is(
  (select count(*)::int from private.reclamar_resumen_semanal(50, (select w1 from semanas))),
  0,
  'un envío confirmado no se vuelve a reclamar: la corrida repetida no duplica'
);

select is(
  private.registrar_fallo_resumen_semanal(
    (select q.envio_id from q1 q where q.destinatario = 'admin-uno@example.com'), 'SMTP 535'),
  'enviado',
  'un fallo tardío no reabre un envío ya confirmado'
);

select is(
  private.registrar_fallo_resumen_semanal(
    (select q.envio_id from q1 q where q.destinatario = 'admin-dos@example.com'), 'SMTP 535: credenciales rechazadas'),
  'fallido',
  'un envío fallido queda fallido'
);

select is(
  (select e.ultimo_error from dominio.resumen_semanal_envios e where e.destinatario_id = 'a2000000-0000-0000-0000-000000000001'),
  'SMTP 535: credenciales rechazadas',
  'queda el error útil'
);

select is(
  (select count(*)::int from private.reclamar_resumen_semanal(50, (select w1 from semanas))),
  0,
  'un envío fallido no se vuelve a reclamar en la misma semana'
);

create temp table q2 on commit drop as
  select * from private.reclamar_resumen_semanal(50, (select w2 from semanas));

select is(
  (select count(*)::int from q2),
  2,
  'la semana siguiente vuelve a reclamar los mismos destinatarios'
);

-- ============================================================================
-- El resumen trae los datos de su organización y solo de ella (FR-014)
-- ============================================================================

create temp table secciones on commit drop as
select q.destinatario, d.dato ->> 'clave' as clave, d.dato ->> 'valor' as valor
  from q2 q
  cross join lateral jsonb_array_elements(q.resumen -> 'secciones') as s(seccion)
  cross join lateral jsonb_array_elements(s.seccion -> 'datos') as d(dato)
 where s.seccion ->> 'clave' = 'stock';

select is(
  (select s.valor from secciones s where s.destinatario = 'admin-uno@example.com' and s.clave = 'sin_stock'),
  '1',
  'el resumen de la organización uno trae sus propios datos'
);

select is(
  (select s.valor from secciones s where s.destinatario = 'admin-dos@example.com' and s.clave = 'sin_stock'),
  '2',
  'el resumen de la organización dos trae los suyos'
);

select is(
  (select s.valor from secciones s where s.destinatario = 'admin-uno@example.com' and s.clave = 'stock_bajo'),
  '0',
  'el resumen no trae los datos de la otra organización'
);

-- ============================================================================
-- La preferencia del tipo decide quién lo recibe (FR-010)
-- ============================================================================

insert into public.preferencias_aviso (user_id, tipo_aviso, activo) values
  ('a2000000-0000-0000-0000-000000000001', 'resumen_semanal', false);

create temp table q3 on commit drop as
  select * from private.reclamar_resumen_semanal(50, (select w3 from semanas));

select is(
  (select count(*)::int from q3 where q.destinatario = 'admin-dos@example.com'),
  0,
  'quien apaga el tipo en «Avisos por correo» no recibe el resumen'
);

select is(
  (select count(*)::int from q3 where q.destinatario = 'admin-uno@example.com'),
  1,
  'los demás destinatarios siguen recibiendo el resumen'
);

-- ============================================================================
-- Privilegios (T009): el rol de Kestra ejecuta las funciones y nada más
-- ============================================================================

select ok(
  has_function_privilege('kestra_orquestacion', 'private.reclamar_resumen_semanal(integer, text)', 'execute')
  and has_function_privilege('kestra_orquestacion', 'private.marcar_resumen_semanal_enviado(uuid)', 'execute')
  and has_function_privilege('kestra_orquestacion', 'private.registrar_fallo_resumen_semanal(uuid, text)', 'execute'),
  'el rol de Kestra ejecuta las tres funciones del resumen'
);

select ok(
  not has_table_privilege('kestra_orquestacion', 'dominio.resumen_semanal_envios', 'select')
  and not has_function_privilege('authenticated', 'private.reclamar_resumen_semanal(integer, text)', 'execute')
  and not has_function_privilege('anon', 'private.reclamar_resumen_semanal(integer, text)', 'execute'),
  'sin acceso directo a la tabla ni a las funciones desde la app'
);

-- ============================================================================
-- Semana por omisión y semana inválida
-- ============================================================================

create temp table q4 on commit drop as
  select * from private.reclamar_resumen_semanal(50);

select is(
  (select count(*)::int from q4),
  2,
  'el reclamo sin semana reclama a los mismos destinatarios'
);

select is(
  (select count(*)::int from q4 where q.semana <> to_char(now(), 'IYYY-"W"IW')),
  0,
  'el reclamo sin semana usa la semana actual'
);

select throws_ok(
  $$select private.reclamar_resumen_semanal(50, 'semana-invalida')$$,
  '22023',
  null,
  'una semana inválida se rechaza'
);

select * from finish();
rollback;
