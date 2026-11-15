-- Newsletter de la tienda, Fase 4 (T019, T020, T024b): borradores, foto del contenido, vista previa y prueba
-- (RF-NL-14, RF-NL-15, RF-NL-16, RF-NL-24, CA-NL-7, CA-NL-8, CA-NL-9, CA-NL-12).
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');
insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'lector@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda B', true),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda Dos', true);
insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'nlcomp-a.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'nlcomp-b.ejemplo.com');
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta');
insert into usuario_empresa_activa (user_id, empresa_id) values ('d1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001');

insert into dominio.precios_empresa (empresa_id, organizacion_id, base, ajuste_pct, mostrar_con_iva) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'central', 0, false),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'central', 0, false);
insert into dominio.cotizacion_inicial (organizacion_id, valor) values ('11111111-1111-1111-1111-111111111111', 1500);

-- Ocho productos destacados (el tope es 6), uno oculto, uno inactivo y uno no destacado.
insert into dominio.productos (id, organizacion_id, nombre, sku, compatible_con, precio_lista, moneda, activo)
select ('a1000000-0000-0000-0000-00000000000' || n)::uuid, '11111111-1111-1111-1111-111111111111', 'Producto ' || n, 'NL-' || n, '{}', 1000 * n, 'ARS', true
  from generate_series(1, 8) n;
insert into dominio.productos (id, organizacion_id, nombre, sku, compatible_con, precio_lista, moneda, activo) values
  ('a1000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'Oculto', 'NL-O', '{}', 500, 'ARS', true),
  ('a1000000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'Inactivo', 'NL-I', '{}', 500, 'ARS', false),
  ('a1000000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111', 'Común', 'NL-C', '{}', 500, 'ARS', true);
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id)
select p.id, e.id, '11111111-1111-1111-1111-111111111111'
  from dominio.productos p
  cross join (values ('e1000000-0000-0000-0000-000000000001'::uuid), ('e1000000-0000-0000-0000-000000000002'::uuid)) e(id)
 where p.organizacion_id = '11111111-1111-1111-1111-111111111111';
insert into dominio.productos_tienda (empresa_id, producto_id, organizacion_id, visible, destacado)
select 'e1000000-0000-0000-0000-000000000001', p.id, '11111111-1111-1111-1111-111111111111',
       p.sku <> 'NL-O', p.sku not in ('NL-C')
  from dominio.productos p where p.organizacion_id = '11111111-1111-1111-1111-111111111111';

-- Promociones: una vigente en tienda A (Producto 1), una vencida (Producto 2) y una futura (Producto 3).
insert into dominio.promociones_precio (organizacion_id, empresa_id, producto_id, precio_promocional, desde, hasta) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 800, now() - interval '1 hour', now() + interval '2 days'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', 1500, now() - interval '3 days', now() - interval '1 day'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000003', 2000, now() + interval '1 day', now() + interval '3 days');

insert into dominio.newsletter_suscriptores (id, organizacion_id, empresa_id, correo, estado, version_consentimiento, baja_en) values
  ('51000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ana@ejemplo.com', 'confirmado', 'v1', null),
  ('51000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'beto@ejemplo.com', 'pendiente', 'v1', null),
  -- Estuvo en baja y un tercero la dejó `pendiente`: no cuenta (T024b).
  ('51000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'caro@ejemplo.com', 'pendiente', 'v1', now() - interval '5 days'),
  ('51000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'dani@ejemplo.com', 'baja', 'v1', now()),
  ('51000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'eli@ejemplo.com', 'confirmado', 'v1', null);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create temp table ids (clave text primary key, valor jsonb);
grant all on ids to authenticated;

-- ---- Guardar borrador ----
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok($$select public.guardar_newsletter(null, null, 'e1000000-0000-0000-0000-000000000001', 'Marzo', 'Novedades', 'Hola', true, true)$$, '55000', null, 'RF-NL-14: con la bandera apagada responde 55000');
reset role;
update public.banderas_plataforma set activa = true where clave = 'newsletter';
select pg_temp.como('d1000000-0000-0000-0000-000000000001');

insert into ids select 'n1', public.guardar_newsletter(null, null, 'e1000000-0000-0000-0000-000000000001', 'Marzo', 'Novedades', E'Hola <script>alert(1)</script>\nSegunda línea', true, false);
select is((select valor ->> 'version' from ids where clave = 'n1'), '1', 'crea el borrador en versión 1');
select is((select mensaje from dominio.newsletters where id = (select (valor ->> 'id')::uuid from ids where clave = 'n1')), E'Hola <script>alert(1)</script>\nSegunda línea', 'el texto se guarda literal (se escapa al renderizar)');

insert into ids select 'n1b', public.guardar_newsletter((select (valor ->> 'id')::uuid from ids where clave = 'n1'), 1, 'e1000000-0000-0000-0000-000000000001', 'Marzo', 'Novedades 2', 'Hola', true, true);
select is((select valor ->> 'version' from ids where clave = 'n1b'), '2', 'actualizar sube la versión');
select throws_ok(format($$select public.guardar_newsletter(%L, 1, 'e1000000-0000-0000-0000-000000000001', 'Marzo', 'Pisa', 'Hola', true, true)$$, (select valor ->> 'id' from ids where clave = 'n1')), '40001', null, 'RF-NL-14: una versión vieja responde 40001');
select is((select asunto from dominio.newsletters where id = (select (valor ->> 'id')::uuid from ids where clave = 'n1')), 'Novedades 2', 'el borrador no se pisó');
select throws_ok($$select public.guardar_newsletter(null, null, 'e1000000-0000-0000-0000-000000000001', '  ', 'A', 'B', true, true)$$, '22023', null, 'el nombre interno es obligatorio');
select throws_ok($$select public.guardar_newsletter(null, null, 'e1000000-0000-0000-0000-000000000001', repeat('x', 101), 'A', 'B', true, true)$$, '22023', null, 'el nombre admite hasta 100');
select throws_ok(format($$select public.guardar_newsletter(null, null, 'e1000000-0000-0000-0000-000000000001', 'N', %L, 'B', true, true)$$, E'Asunto\ncon salto'), '22023', null, 'el asunto no admite saltos de línea');
select throws_ok(format($$select public.guardar_newsletter(null, null, 'e1000000-0000-0000-0000-000000000001', 'N', 'A', %L, true, true)$$, repeat('x', 10001)), '22023', null, 'el mensaje admite hasta 10000');
select throws_ok($$select public.guardar_newsletter(null, null, 'e1000000-0000-0000-0000-000000000001', 'N', 'A', 'B', null, true)$$, '22023', null, 'las secciones son obligatorias');
select throws_ok($$select public.guardar_newsletter(null, null, 'e2000000-0000-0000-0000-000000000001', 'N', 'A', 'B', true, true)$$, 'P0002', null, 'CA-NL-8: la tienda de otra organización no existe');
select throws_ok(format($$select public.guardar_newsletter(%L, 2, 'e1000000-0000-0000-0000-000000000001', 'N', 'A', 'B', true, true)$$, gen_random_uuid()), 'P0002', null, 'un borrador inexistente = P0002');
select is((select count(*)::int from public.registro_actividad where tipo = 'newsletter.guardar'), 2, 'RF-NL-24: cada guardado registra un evento');
select is((select count(*)::int from public.registro_actividad where tipo like 'newsletter.%' and (detalle ilike '%Novedades%' or detalle ilike '%script%')), 0, 'los eventos no llevan asunto ni texto');

-- Detalle
select is(public.detalle_newsletter((select (valor ->> 'id')::uuid from ids where clave = 'n1')) ->> 'estado', 'borrador', 'detalle: estado borrador');
select is(public.detalle_newsletter((select (valor ->> 'id')::uuid from ids where clave = 'n1')) ->> 'tienda', 'Tienda A', 'detalle: nombre de la tienda');
select throws_ok(format($$select public.detalle_newsletter(%L)$$, gen_random_uuid()), 'P0002', null, 'detalle: inexistente = P0002');

-- Un enviado no se edita ni se descarta (CA-NL-12): se simula el envío como postgres.
reset role;
insert into dominio.campanas_correo (id, organizacion_id, empresa_id, clave, asunto, mensaje, tipo)
values ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', gen_random_uuid(), 'Enviado', 'Hola', 'newsletter');
insert into dominio.newsletters (id, organizacion_id, empresa_id, nombre_interno, asunto, mensaje, campana_id, enviada_en, contenido_enviado)
values ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'Enviado', 'Enviado', 'Hola', 'c1000000-0000-0000-0000-000000000001', now(), '{}');
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok($$select public.guardar_newsletter('b1000000-0000-0000-0000-000000000001', 1, 'e1000000-0000-0000-0000-000000000001', 'N', 'A', 'B', true, true)$$, '55000', null, 'CA-NL-12: un newsletter enviado no se edita');
select throws_ok($$select public.descartar_newsletter('b1000000-0000-0000-0000-000000000001')$$, '55000', null, 'un newsletter enviado no se descarta');
select is(public.descartar_newsletter((select (valor ->> 'id')::uuid from ids where clave = 'n1')), '{"ok":true}'::jsonb, 'descartar un borrador');
select throws_ok(format($$select public.detalle_newsletter(%L)$$, (select valor ->> 'id' from ids where clave = 'n1')), 'P0002', null, 'el borrador descartado ya no existe');

-- ---- Vista previa y foto ----
reset role;
update public.banderas_plataforma set activa = false where clave = 'promociones_precio';
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
create temp table vp (clave text primary key, j jsonb);
grant all on vp to authenticated;
insert into vp select 'ambas', public.vista_previa_newsletter('e1000000-0000-0000-0000-000000000001', true, true);
insert into vp select 'ninguna', public.vista_previa_newsletter('e1000000-0000-0000-0000-000000000001', false, false);
select is(jsonb_array_length((select j -> 'bloques' -> 'destacados' from vp where clave = 'ambas')), 6, 'RF-NL-15: hasta 6 destacados');
select is((select j -> 'bloques' -> 'destacados' -> 0 ->> 'nombre' from vp where clave = 'ambas'), 'Producto 1', 'destacados en orden alfabético');
select is((select count(*)::int from vp, jsonb_array_elements(j -> 'bloques' -> 'destacados') d where clave = 'ambas' and d ->> 'nombre' in ('Oculto', 'Inactivo', 'Común')), 0, 'no entran los ocultos, inactivos ni no destacados');
select is((select j -> 'bloques' -> 'destacados' -> 1 ->> 'precio' from vp where clave = 'ambas')::numeric, 2000::numeric, 'precio público de la tienda');
select is((select j -> 'bloques' -> 'destacados' -> 0 ->> 'url' from vp where clave = 'ambas'), 'https://nlcomp-a.ejemplo.com/producto/a1000000-0000-0000-0000-000000000001', 'enlace a la ficha en el dominio de la tienda');
select is((select j -> 'bloques' -> 'destacados' -> 0 -> 'imagen_url' from vp where clave = 'ambas'), 'null'::jsonb, 'sin imagen (bucket privado)');
select is(jsonb_array_length((select j -> 'bloques' -> 'promociones' from vp where clave = 'ambas')), 0, 'RF-NL-15: con la bandera de promociones apagada no hay sección de promociones');
select is(jsonb_array_length((select j -> 'bloques' -> 'destacados' from vp where clave = 'ninguna')), 0, 'sección apagada = vacía');
select is((select (j ->> 'confirmados')::int from vp where clave = 'ambas'), 1, 'T024b: solo cuenta el suscriptor confirmado de esa tienda (no pendiente con baja_en, no baja, no otra tienda)');
select isnt((select j ->> 'generado_en' from vp where clave = 'ambas'), null, 'incluye la fecha de la foto');

reset role;
update public.banderas_plataforma set activa = true where clave = 'promociones_precio';
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
insert into vp select 'promos', public.vista_previa_newsletter('e1000000-0000-0000-0000-000000000001', false, true);
select is(jsonb_array_length((select j -> 'bloques' -> 'promociones' from vp where clave = 'promos')), 1, 'solo la promoción vigente (ni vencida ni futura)');
select is((select j -> 'bloques' -> 'promociones' -> 0 ->> 'precio_promocional' from vp where clave = 'promos')::numeric, 800::numeric, 'precio promocional');
select is((select j -> 'bloques' -> 'promociones' -> 0 ->> 'precio' from vp where clave = 'promos')::numeric, 1000::numeric, 'precio normal tachado');
select isnt((select j -> 'bloques' -> 'promociones' -> 0 ->> 'hasta' from vp where clave = 'promos'), null, 'incluye hasta cuándo rige');
select is((select (public.vista_previa_newsletter('e1000000-0000-0000-0000-000000000002', true, true) ->> 'confirmados')::int), 1, 'la otra tienda cuenta los suyos');
select throws_ok($$select public.vista_previa_newsletter('e2000000-0000-0000-0000-000000000001', true, true)$$, 'P0002', null, 'CA-NL-8: no previsualiza una tienda ajena');

-- ---- Prueba ----
select is(public.solicitar_prueba_newsletter('e1000000-0000-0000-0000-000000000001', 'Asunto de prueba', 'Hola', true, true), '{"ok":true}'::jsonb, 'RF-NL-16: deja una prueba');
reset role;
select is((select correo from dominio.correo_masivo_pruebas where asunto = 'Asunto de prueba'), 'admin-uno@example.com', 'va al correo del autor');
select is((select empresa_id from dominio.correo_masivo_pruebas where asunto = 'Asunto de prueba'), 'e1000000-0000-0000-0000-000000000001'::uuid, 'queda la tienda');
select is(jsonb_array_length((select bloques -> 'destacados' from dominio.correo_masivo_pruebas where asunto = 'Asunto de prueba')), 6, 'lleva la foto del contenido');
select is((select count(*)::int from dominio.campanas_correo where asunto = 'Asunto de prueba'), 0, 'la prueba no crea campaña');
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select public.solicitar_prueba_newsletter('e1000000-0000-0000-0000-000000000001', 'P2', 'Hola', false, false);
select public.solicitar_prueba_newsletter('e1000000-0000-0000-0000-000000000001', 'P3', 'Hola', false, false);
select public.solicitar_prueba_newsletter('e1000000-0000-0000-0000-000000000001', 'P4', 'Hola', false, false);
select public.solicitar_prueba_newsletter('e1000000-0000-0000-0000-000000000001', 'P5', 'Hola', false, false);
select throws_ok($$select public.solicitar_prueba_newsletter('e1000000-0000-0000-0000-000000000001', 'P6', 'Hola', false, false)$$, '22023', null, 'D18: el sexto pedido de la hora se rechaza');
select throws_ok($$select public.solicitar_prueba_newsletter('e2000000-0000-0000-0000-000000000001', 'X', 'Hola', false, false)$$, 'P0002', null, 'CA-NL-8: prueba de una tienda ajena');
reset role;
select is((select count(*)::int from public.registro_actividad where tipo = 'newsletter.prueba' and detalle ilike '%@%'), 0, 'el evento de prueba no lleva correo');

-- ---- Permisos ----
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select throws_ok($$select public.guardar_newsletter(null, null, 'e1000000-0000-0000-0000-000000000001', 'N', 'A', 'B', true, true)$$, '42501', null, 'CA-NL-7: el lector no guarda');
select throws_ok($$select public.vista_previa_newsletter('e1000000-0000-0000-0000-000000000001', true, true)$$, '42501', null, 'CA-NL-7: el lector no previsualiza');
select throws_ok($$select public.solicitar_prueba_newsletter('e1000000-0000-0000-0000-000000000001', 'A', 'B', true, true)$$, '42501', null, 'CA-NL-7: el lector no pide pruebas');
select throws_ok($$select public.descartar_newsletter('b1000000-0000-0000-0000-000000000001')$$, '42501', null, 'CA-NL-7: el lector no descarta');
select is(public.detalle_newsletter('b1000000-0000-0000-0000-000000000001') ->> 'estado', 'enviada', 'el lector sí ve el detalle de su tienda');
select is((select count(*)::int from dominio.newsletters), 1, 'el lector ve solo los newsletters de su tienda');

select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from dominio.newsletters), 0, 'CA-NL-8: otra organización no ve newsletters ajenos');
select throws_ok($$select public.detalle_newsletter('b1000000-0000-0000-0000-000000000001')$$, 'P0002', null, 'CA-NL-8: ni su detalle');
select throws_ok($$select public.descartar_newsletter('b1000000-0000-0000-0000-000000000001')$$, 'P0002', null, 'CA-NL-8: ni lo descarta');

reset role;
select is(has_function_privilege('anon', 'public.guardar_newsletter(uuid,integer,uuid,text,text,text,boolean,boolean)', 'execute'), false, 'anon no guarda');
select is(has_function_privilege('authenticated', 'private.armar_bloques_newsletter(uuid,boolean,boolean)', 'execute'), false, 'authenticated no arma bloques directamente');
select is(has_table_privilege('authenticated', 'dominio.newsletters', 'insert'), false, 'authenticated no escribe la tabla');
select is(has_table_privilege('anon', 'dominio.newsletters', 'select'), false, 'anon no lee la tabla');

select * from finish();
rollback;
