-- Newsletter de la tienda, Fase 3 (T013, T018b): RPC del panel para suscriptores (RF-NL-10…12, RF-NL-24, CA-NL-7, CA-NL-8).
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');
insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'lector-a@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'sinclientes@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda B', true),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda Dos', true);
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta');
insert into usuario_empresa_activa (user_id, empresa_id) values ('d1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001');

insert into dominio.newsletter_suscriptores (id, organizacion_id, empresa_id, correo, estado, version_consentimiento, baja_en, creado_en) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ana@ejemplo.com', 'confirmado', 'v1', null, now() - interval '3 days'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'beto@ejemplo.com', 'pendiente', 'v1', null, now() - interval '2 days'),
  -- Una dirección en baja que un tercero dejó `pendiente`: conserva baja_en y NO es un destinatario (MSF-967).
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'caro@ejemplo.com', 'pendiente', 'v1', now() - interval '10 days', now() - interval '1 day'),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'dani@ejemplo.com', 'baja', 'v1', now(), now() - interval '5 days'),
  ('a1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'eli@ejemplo.com', 'confirmado', 'v1', null, now()),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-000000000001', 'otra@ejemplo.com', 'confirmado', 'v1', null, now());

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Administrador de la organización 1.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is((public.resumen_newsletter(null) ->> 'confirmados')::int, 2, 'T018b: solo `confirmado` cuenta como activo (el pendiente con baja_en no)');
select is((public.resumen_newsletter(null) ->> 'pendientes')::int, 2, 'resumen: pendientes');
select is((public.resumen_newsletter(null) ->> 'bajas')::int, 1, 'resumen: bajas');
select is((public.resumen_newsletter('e1000000-0000-0000-0000-000000000001') ->> 'confirmados')::int, 1, 'resumen: filtra por tienda');
select is(jsonb_array_length(public.resumen_newsletter(null) -> 'tiendas'), 2, 'resumen: una fila de interruptor por tienda accesible de la organización');
select is((public.resumen_newsletter(null) ->> 'bandera')::boolean, false, 'resumen: informa la bandera apagada');
select is((public.listar_suscriptores_newsletter(null, null, null, 1, 25) ->> 'total')::int, 5, 'listar: todas las tiendas de la organización, nunca la otra');
select is((public.listar_suscriptores_newsletter(null, 'confirmado', null, 1, 25) ->> 'total')::int, 2, 'T018b: el filtro confirmado excluye al pendiente con baja_en');
select is((public.listar_suscriptores_newsletter('e1000000-0000-0000-0000-000000000002', null, null, 1, 25) ->> 'total')::int, 1, 'listar: filtra por tienda');
select is((public.listar_suscriptores_newsletter(null, null, 'ANA@', 1, 25) ->> 'total')::int, 1, 'listar: búsqueda por correo sin distinguir mayúsculas');
select is((public.listar_suscriptores_newsletter(null, null, '%', 1, 25) ->> 'total')::int, 0, 'listar: la búsqueda es literal (el comodín no coincide con todo)');
select is((public.listar_suscriptores_newsletter(null, null, null, 1, 2) -> 'filas' -> 0 ->> 'correo'), 'eli@ejemplo.com', 'listar: más nuevos primero');
select is(jsonb_array_length(public.listar_suscriptores_newsletter(null, null, null, 2, 2) -> 'filas'), 2, 'listar: segunda tanda');
select is(jsonb_array_length(public.listar_suscriptores_newsletter(null, null, null, 1, 1000) -> 'filas'), 5, 'listar: el tamaño se acota a 100');
select throws_ok($$select public.listar_suscriptores_newsletter(null, 'otro', null, 1, 25)$$, '22023', null, 'listar: estado inválido');
select throws_ok($$select public.listar_suscriptores_newsletter('e2000000-0000-0000-0000-000000000001', null, null, 1, 25)$$, '42501', null, 'CA-NL-8: no lista una tienda de otra organización');
select is((select count(*)::int from jsonb_object_keys(public.listar_suscriptores_newsletter(null, null, null, 1, 1) -> 'filas' -> 0) k where k in ('confirmacion_hash')), 0, 'listar: no expone el hash de confirmación');

-- Interruptor: bandera apagada = 55000; encendida = guarda y registra.
select throws_ok($$select public.guardar_newsletter_configuracion('e1000000-0000-0000-0000-000000000001', true)$$, '55000', null, 'RF-NL-10: con la bandera apagada responde 55000');
reset role;
update public.banderas_plataforma set activa = true where clave = 'newsletter';
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(public.guardar_newsletter_configuracion('e1000000-0000-0000-0000-000000000001', true), '{"empresa_id":"e1000000-0000-0000-0000-000000000001","activo":true}'::jsonb, 'RF-NL-10: enciende la tienda');
select is((select activo from dominio.newsletter_configuracion where empresa_id = 'e1000000-0000-0000-0000-000000000001'), true, 'queda guardado');
select is(public.guardar_newsletter_configuracion('e1000000-0000-0000-0000-000000000001', false) ->> 'activo', 'false', 'lo apaga');
select throws_ok($$select public.guardar_newsletter_configuracion('e2000000-0000-0000-0000-000000000001', true)$$, 'P0002', null, 'CA-NL-8: otra organización = P0002');
select throws_ok($$select public.guardar_newsletter_configuracion(null, true)$$, 'P0002', null, 'sin tienda = P0002');
select throws_ok($$select public.guardar_newsletter_configuracion('e1000000-0000-0000-0000-000000000001', null)$$, '22023', null, 'sin valor = 22023');
select is((select count(*)::int from public.registro_actividad where tipo = 'newsletter.configurar'), 2, 'RF-NL-24: cada cambio del interruptor registra un evento');

-- Baja manual: idempotente, pendiente incluido, evento sin correo.
select is(public.dar_de_baja_suscriptor_newsletter('a1000000-0000-0000-0000-000000000001'), '{"ok":true}'::jsonb, 'baja manual de un confirmado');
select is((select estado from dominio.newsletter_suscriptores where id = 'a1000000-0000-0000-0000-000000000001'), 'baja', 'queda en baja');
select is(public.dar_de_baja_suscriptor_newsletter('a1000000-0000-0000-0000-000000000001'), '{"ok":true}'::jsonb, 'la baja manual es idempotente');
select is(public.dar_de_baja_suscriptor_newsletter('a1000000-0000-0000-0000-000000000002'), '{"ok":true}'::jsonb, 'baja manual de un pendiente');
select is((select count(*)::int from public.registro_actividad where tipo = 'newsletter.baja_manual'), 2, 'RF-NL-24: un evento por baja efectiva (la repetida no suma)');
select is((select count(*)::int from public.registro_actividad where tipo like 'newsletter.%' and (detalle ilike '%@ejemplo.com%' or valor_nuevo::text ilike '%@%')), 0, 'RF-NL-24: ningún evento lleva correos');
select throws_ok($$select public.dar_de_baja_suscriptor_newsletter('a2000000-0000-0000-0000-000000000001')$$, 'PT404', null, 'CA-NL-8: un suscriptor de otra organización no existe');
select throws_ok($$select public.dar_de_baja_suscriptor_newsletter('99999999-9999-9999-9999-999999999999')$$, 'PT404', null, 'un suscriptor inexistente = PT404');

-- Borrar datos.
select is(public.borrar_datos_suscriptor_newsletter('a1000000-0000-0000-0000-000000000004'), '{"ok":true}'::jsonb, 'borrar datos');
select is((select count(*)::int from dominio.newsletter_suscriptores where id = 'a1000000-0000-0000-0000-000000000004'), 0, 'la fila se elimina');
select throws_ok($$select public.borrar_datos_suscriptor_newsletter('a1000000-0000-0000-0000-000000000004')$$, 'PT404', null, 'borrar dos veces = PT404');
select throws_ok($$select public.borrar_datos_suscriptor_newsletter('a2000000-0000-0000-0000-000000000001')$$, 'PT404', null, 'CA-NL-8: no borra datos de otra organización');
select is((select count(*)::int from public.registro_actividad where tipo = 'newsletter.datos_borrados'), 1, 'RF-NL-24: evento de borrado sin correo');

-- Persona con solo lectura (consulta, tienda A): ve, no escribe (CA-NL-7).
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is((public.listar_suscriptores_newsletter(null, null, null, 1, 25) ->> 'total')::int, 3, 'CA-NL-7: el lector ve solo su tienda');
select is((public.resumen_newsletter(null) ->> 'confirmados')::int, 0, 'el lector ve el resumen de su tienda');
select throws_ok($$select public.guardar_newsletter_configuracion('e1000000-0000-0000-0000-000000000001', true)$$, '42501', null, 'CA-NL-7: el lector no cambia el interruptor');
select throws_ok($$select public.dar_de_baja_suscriptor_newsletter('a1000000-0000-0000-0000-000000000003')$$, '42501', null, 'CA-NL-7: el lector no da de baja');
select throws_ok($$select public.borrar_datos_suscriptor_newsletter('a1000000-0000-0000-0000-000000000003')$$, '42501', null, 'CA-NL-7: el lector no borra datos');
select throws_ok($$select public.listar_suscriptores_newsletter('e1000000-0000-0000-0000-000000000002', null, null, 1, 25)$$, '42501', null, 'CA-NL-8: sin acceso a la tienda B no la lista');

-- Un rol que NO es Administrador, aunque tenga edición en clientes, tampoco escribe (D6).
reset role;
insert into public.permisos_rol (organizacion_id, rol_id, seccion, nivel) values
  ('11111111-1111-1111-1111-111111111111', 'consulta', 'clientes', 'edicion')
on conflict (organizacion_id, rol_id, seccion) do update set nivel = excluded.nivel;
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select throws_ok($$select public.guardar_newsletter_configuracion('e1000000-0000-0000-0000-000000000001', true)$$, '42501', null, 'D6: un no Administrador con edición en clientes no cambia el interruptor');
select throws_ok($$select public.dar_de_baja_suscriptor_newsletter('a1000000-0000-0000-0000-000000000003')$$, '42501', null, 'D6: un no Administrador no da de baja');
select throws_ok($$select public.borrar_datos_suscriptor_newsletter('a1000000-0000-0000-0000-000000000003')$$, '42501', null, 'D6: un no Administrador no borra datos');
reset role;
delete from public.permisos_rol where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'consulta' and seccion = 'clientes';

-- Sin lectura en clientes: nada.
select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select is((select count(*)::int from dominio.newsletter_suscriptores), 0, 'sin acceso a ninguna tienda no ve filas');

-- Administrador de otra organización.
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is((public.listar_suscriptores_newsletter(null, null, null, 1, 25) ->> 'total')::int, 1, 'CA-NL-8: el administrador de otra organización solo ve lo suyo');
select throws_ok($$select public.dar_de_baja_suscriptor_newsletter('a1000000-0000-0000-0000-000000000003')$$, 'PT404', null, 'CA-NL-8: ni toca suscriptores ajenos');

-- anon no ejecuta las RPC del panel.
reset role;
select is(has_function_privilege('anon', 'public.listar_suscriptores_newsletter(uuid,text,text,integer,integer)', 'execute'), false, 'anon no lista suscriptores');
select is(has_function_privilege('anon', 'public.borrar_datos_suscriptor_newsletter(uuid)', 'execute'), false, 'anon no borra datos');
select is(has_function_privilege('authenticated', 'public.borrar_datos_suscriptor_newsletter(uuid)', 'execute'), true, 'authenticated sí ejecuta (el permiso se comprueba adentro)');

select * from finish();
rollback;
