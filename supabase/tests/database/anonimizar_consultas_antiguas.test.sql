-- Retención de consultas (lote 39, decisión de producto): `private.anonimizar_consultas_antiguas(p_meses)`.
-- Plazo de 24 meses desde la última actividad (`updated_at`); se anonimizan nombre, contacto y mensaje (y se cortan los vínculos y
-- la nota interna) y se conservan producto, origen, estado, fechas e ítems del pedido. Casos borde: 23/24/25 meses, el límite exacto,
-- ya anonimizadas (idempotencia), parámetro inválido (menos de 12 meses, nulo), privilegios (anon, authenticated) y un log por
-- organización sin datos personales, y que una edición real reinicia el plazo (el plazo mide `updated_at`).
begin;

select plan(38);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');
insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a2000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');
insert into dominio.categorias (id, organizacion_id, nombre) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joysticks');
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, categoria_id, activo) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 'ARS', 1000, 'c1000000-0000-0000-0000-000000000001', true);
insert into dominio.clientes (id, organizacion_id, numero, nombre, tipo) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Distribuidora Norte', 'minorista');

-- Consultas con `updated_at` explícito (el insert lo respeta; solo el update lo normaliza).
--   e01: 23 meses · e02: 24 meses exactos (límite: no) · e03: 24 meses y 1 segundo · e04: 25 meses · e05: pedido viejo con ítems
--   e06: WhatsApp vieja sin mensaje · e07: ya anonimizada · e08: vieja de la otra organización · e09: reciente
insert into dominio.consultas (id, organizacion_id, empresa_id, origen, nombre, contacto, mensaje, producto_id, estado, nota_interna, cliente_id, created_at, updated_at) values
  ('e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'formulario', 'Ana', 'ana@example.com', 'Hola', 'b1000000-0000-0000-0000-000000000001', 'resuelta', null, null, now() - interval '40 months', now() - interval '23 months'),
  ('e0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'formulario', 'Beto', 'beto@example.com', 'Hola', 'b1000000-0000-0000-0000-000000000001', 'resuelta', null, null, now() - interval '40 months', now() - interval '24 months'),
  ('e0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'formulario', 'Carla', 'carla@example.com', 'Hola', 'b1000000-0000-0000-0000-000000000001', 'resuelta', 'llamar al 1155550000', 'c5000000-0000-0000-0000-000000000001', now() - interval '40 months', now() - interval '24 months' - interval '1 second'),
  ('e0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'formulario', 'Diego', 'diego@example.com', 'Hola', null, 'nueva', null, null, now() - interval '40 months', now() - interval '25 months'),
  ('e0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'pedido', 'Elena', 'elena@example.com', 'Pedido de 1 producto', 'b1000000-0000-0000-0000-000000000001', 'en_curso', null, null, now() - interval '40 months', now() - interval '30 months'),
  ('e0000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'whatsapp', 'Fede', '+5491100000000', null, 'b1000000-0000-0000-0000-000000000001', 'resuelta', null, null, now() - interval '40 months', now() - interval '36 months'),
  ('e0000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'formulario', '[anonimizado]', '[anonimizado]', '[anonimizado]', null, 'resuelta', null, null, now() - interval '60 months', now() - interval '50 months'),
  ('e0000000-0000-0000-0000-000000000008', '22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-00000000000c', 'formulario', 'Gaby', 'gaby@example.com', 'Hola', null, 'resuelta', null, null, now() - interval '40 months', now() - interval '28 months'),
  ('e0000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'formulario', 'Hugo', 'hugo@example.com', 'Hola', null, 'nueva', null, null, now(), now());
insert into dominio.consulta_items (organizacion_id, empresa_id, consulta_id, orden, producto_id, descripcion, cantidad) values
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000005', 1, 'b1000000-0000-0000-0000-000000000001', 'Joystick', 2);

-- e10: creada hace 40 meses y sin actividad hace 30, pero alguien la EDITA hoy: la edición real reinicia el plazo
-- (el plazo mide `updated_at`, la última actividad, y no `created_at`).
insert into dominio.consultas (id, organizacion_id, empresa_id, origen, nombre, contacto, mensaje, estado, created_at, updated_at) values
  ('e0000000-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'formulario', 'Irene', 'irene@example.com', 'Hola', 'nueva', now() - interval '40 months', now() - interval '30 months');
update dominio.consultas set estado = 'en_curso' where id = 'e0000000-0000-0000-0000-000000000010';

create temp table antes_agregados as
  select count(*) as total, count(*) filter (where producto_id is not null) as con_producto,
         count(*) filter (where estado = 'resuelta') as resueltas, min(created_at) as primera
    from dominio.consultas;

-- Privilegios
select is(has_function_privilege('anon', 'private.anonimizar_consultas_antiguas(integer)', 'execute'), false, 'anon no ejecuta la anonimización');
select is(has_function_privilege('authenticated', 'private.anonimizar_consultas_antiguas(integer)', 'execute'), false, 'authenticated no ejecuta la anonimización');
select is(has_function_privilege('service_role', 'private.anonimizar_consultas_antiguas(integer)', 'execute'), true, 'service_role la ejecuta');
select is((select prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = 'private.anonimizar_consultas_antiguas(integer)'::regprocedure),
  true, 'es security definer con search_path vacío');

-- Parámetro inválido: no anonimiza nada
select throws_ok($$select private.anonimizar_consultas_antiguas(0)$$, '22023', null, '0 meses se rechaza');
select throws_ok($$select private.anonimizar_consultas_antiguas(1)$$, '22023', null, '1 mes se rechaza');
select throws_ok($$select private.anonimizar_consultas_antiguas(11)$$, '22023', null, '11 meses se rechaza (el mínimo es 12)');
select throws_ok($$select private.anonimizar_consultas_antiguas(-24)$$, '22023', null, 'un plazo negativo se rechaza');
select throws_ok($$select private.anonimizar_consultas_antiguas(null)$$, '22023', null, 'un plazo nulo se rechaza');
select is((select count(*)::int from dominio.consultas where nombre = '[anonimizado]'), 1, 'los rechazos no anonimizaron nada (solo la que ya estaba)');

-- Corrida con el plazo por defecto (24 meses)
select is(private.anonimizar_consultas_antiguas(), 5, 'anonimiza 5 consultas: 24m+1s, 25, 30 y 36 meses de la org 1 y la de 28 meses de la org 2');
select is((select nombre || '|' || contacto || '|' || mensaje from dominio.consultas where id = 'e0000000-0000-0000-0000-000000000001'), 'Ana|ana@example.com|Hola', '23 meses: se conserva');
select is((select nombre from dominio.consultas where id = 'e0000000-0000-0000-0000-000000000002'), 'Beto', '24 meses exactos: se conserva (el límite no alcanza)');
select is((select nombre || '|' || contacto || '|' || mensaje from dominio.consultas where id = 'e0000000-0000-0000-0000-000000000003'), '[anonimizado]|[anonimizado]|[anonimizado]', '24 meses y 1 segundo: se anonimiza');
select is((select nombre from dominio.consultas where id = 'e0000000-0000-0000-0000-000000000004'), '[anonimizado]', '25 meses: se anonimiza');
select is((select nota_interna is null and cliente_id is null from dominio.consultas where id = 'e0000000-0000-0000-0000-000000000003'), true, 'se borra la nota interna y se corta el vínculo con el cliente');
select is((select mensaje is null from dominio.consultas where id = 'e0000000-0000-0000-0000-000000000005'), true, 'el pedido queda sin mensaje');
select is((select mensaje is null and contacto = '[anonimizado]' from dominio.consultas where id = 'e0000000-0000-0000-0000-000000000006'), true, 'WhatsApp: sin mensaje y contacto anonimizado');
select is((select nombre from dominio.consultas where id = 'e0000000-0000-0000-0000-000000000009'), 'Hugo', 'una consulta reciente no se toca');
select is((select nombre from dominio.consultas where id = 'e0000000-0000-0000-0000-000000000008'), '[anonimizado]', 'rige para todas las organizaciones');

-- El plazo mide la última actividad (`updated_at`), no la fecha de alta: una consulta vieja editada hace poco no se anonimiza
select is((select nombre from dominio.consultas where id = 'e0000000-0000-0000-0000-000000000010'), 'Irene', 'una edición real reinicia el plazo: no se anonimiza');
select is((select created_at < now() - interval '36 months' from dominio.consultas where id = 'e0000000-0000-0000-0000-000000000010'), true, 'aunque su fecha de alta es de hace más de 36 meses');

-- Se conserva lo que sirve a los reportes
select is((select count(*) from dominio.consultas), (select total from antes_agregados), 'no se borra ninguna consulta');
select is((select count(*) filter (where producto_id is not null) from dominio.consultas), (select con_producto from antes_agregados), 'se conserva el producto');
select is((select count(*) filter (where estado = 'resuelta') from dominio.consultas), (select resueltas from antes_agregados), 'se conserva el estado');
select is((select min(created_at) from dominio.consultas), (select primera from antes_agregados), 'se conserva la fecha de alta');
select is((select origen from dominio.consultas where id = 'e0000000-0000-0000-0000-000000000005'), 'pedido', 'se conserva el origen');
select is((select count(*)::int from dominio.consulta_items where consulta_id = 'e0000000-0000-0000-0000-000000000005'), 1, 'se conservan los ítems del pedido');
select is((select producto_id from dominio.consultas where id = 'e0000000-0000-0000-0000-000000000003'), 'b1000000-0000-0000-0000-000000000001'::uuid, 'el producto de la consulta anonimizada sigue');

-- Log por organización, sin datos personales
select is((select count(*)::int from public.registro_actividad where tipo = 'sistema.consultas_anonimizadas'), 2, 'un evento por organización');
select is((select detalle from public.registro_actividad where tipo = 'sistema.consultas_anonimizadas' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  'Anonimizó 4 consultas sin actividad en los últimos 24 meses', 'el evento cuenta las filas de la organización');
select is((select count(*)::int from public.registro_actividad where tipo = 'sistema.consultas_anonimizadas' and (detalle ~* '@|ana|carla|diego|elena|fede')), 0, 'el log no trae datos personales');

-- Idempotencia
select is(private.anonimizar_consultas_antiguas(24), 0, 'una segunda corrida no toca nada');
select is((select count(*)::int from public.registro_actividad where tipo = 'sistema.consultas_anonimizadas'), 2, 'y no deja otro evento');

-- Plazo mayor: con 36 meses nada nuevo; con 12 caen las de 23 y 24 meses
select is(private.anonimizar_consultas_antiguas(36), 0, 'con 36 meses no hay nada más');
select is(private.anonimizar_consultas_antiguas(12), 2, 'con 12 meses se anonimizan las de 23 y 24 meses');
select is((select nombre from dominio.consultas where id = 'e0000000-0000-0000-0000-000000000001'), '[anonimizado]', 'la de 23 meses cae con un plazo de 12');
select is((select nombre from dominio.consultas where id = 'e0000000-0000-0000-0000-000000000009'), 'Hugo', 'la reciente sigue intacta');

select * from finish();
rollback;
