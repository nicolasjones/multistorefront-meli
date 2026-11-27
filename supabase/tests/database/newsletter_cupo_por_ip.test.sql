-- Lote 95 (MSF-971 y MSF-980; migración 20270511000000): cupo persistente por IP hasheada para la suscripción al newsletter y la baja de correo masivo.
-- Todo con objetos reales y el rol del CI (no superusuario): nada se omite con skip. Datos inventados.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno');
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e9500000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda cupo A', true),
  ('e9500000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda cupo B', true);
insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e9500000-0000-0000-0000-000000000001', 'nl-cupo-a.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e9500000-0000-0000-0000-000000000002', 'nl-cupo-b.ejemplo.com');
insert into dominio.newsletter_configuracion (empresa_id, organizacion_id, activo) values
  ('e9500000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', true),
  ('e9500000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', true);
update public.banderas_plataforma set activa = true where clave = 'newsletter';

create temp table res (clave text primary key, j jsonb);
-- Consume n veces, una por una (una función en FROM sin correlación se evaluaría una sola vez), y cuenta cuántas pasaron.
create function pg_temp.consumir_baja_n(p_ip text, p_n integer) returns integer language plpgsql as $$
declare v_ok integer := 0; v_r boolean;
begin
  for i in 1..p_n loop
    select se_consumio into v_r from public.consumir_cupo_baja_correo(p_ip);
    if v_r then v_ok := v_ok + 1; end if;
  end loop;
  return v_ok;
end $$;
create function pg_temp.consumir_nl_n(p_empresa uuid, p_n integer) returns integer language plpgsql as $$
declare v_ok integer := 0; v_r boolean;
begin
  for i in 1..p_n loop
    select se_consumio into v_r from private.consumir_cupo_newsletter(p_empresa);
    if v_r then v_ok := v_ok + 1; end if;
  end loop;
  return v_ok;
end $$;
-- Fija la IP del pedido y llama a la suscripción (una IP distinta por llamada, dentro de una misma consulta).
create function pg_temp.suscribir_desde(p_host text, p_ip text, p_correo text, p_clave uuid) returns jsonb language plpgsql as $$
begin
  perform set_config('request.headers', json_build_object('x-forwarded-for', p_ip)::text, true);
  return publico.suscribirse_newsletter(p_host, p_correo, true, p_clave, '');
end $$;
grant all on res to anon;

-- ===== Estructura y ACL =====
select has_table('private', 'cupo_publico_ip', 'la tabla del cupo existe en private (no expuesta por PostgREST)');
select col_is_pk('private', 'cupo_publico_ip', array['ambito', 'clave', 'ventana'], 'clave primaria (ámbito, clave, ventana)');
select is((select relrowsecurity from pg_class where oid = 'private.cupo_publico_ip'::regclass), true, 'RLS activado');
select is(
  (select array_agg(pg_get_expr(polqual, polrelid) || '/' || pg_get_expr(polwithcheck, polrelid) || '/' || polcmd::text order by polname)
     from pg_policy where polrelid = 'private.cupo_publico_ip'::regclass),
  array['false/false/*'], 'una única política que deniega todo');
select is(
  (select bool_or(has_table_privilege(r, 'private.cupo_publico_ip', p))
     from unnest(array['anon', 'authenticated', 'service_role']) r, unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p),
  false, 'ni anon, ni authenticated ni service_role tienen privilegios sobre la tabla');
select is(
  (select count(*)::int from pg_attribute where attrelid = 'private.cupo_publico_ip'::regclass and attnum > 0 and not attisdropped),
  4, 'la tabla guarda solo ámbito, clave, ventana y usos: ninguna columna para la IP');
select is(
  (select bool_and(p.prosecdef and p.proconfig = array['search_path=""'])
     from pg_proc p where p.oid in ('private.consumir_cupo_ip(text,text,integer)'::regprocedure, 'private.consumir_cupo_newsletter(uuid)'::regprocedure,
                                    'public.consumir_cupo_baja_correo(text)'::regprocedure)),
  true, 'las tres funciones son security definer con search_path vacío');
select is(
  (select bool_or(has_function_privilege(r, f, 'execute'))
     from unnest(array['anon', 'authenticated', 'public']) r,
          unnest(array['private.consumir_cupo_ip(text,text,integer)', 'private.consumir_cupo_newsletter(uuid)', 'public.consumir_cupo_baja_correo(text)',
                        'private.ip_cliente_publica()', 'private.red_de_ip(text)']) f),
  false, 'anon, authenticated y public no ejecutan ninguna función del cupo');
select is(has_function_privilege('service_role', 'public.consumir_cupo_baja_correo(text)', 'execute'), true, 'service_role ejecuta el cupo de la baja');
select is(has_function_privilege('service_role', 'private.consumir_cupo_ip(text,text,integer)', 'execute'), false, 'service_role no ejecuta la función interna');
select is(has_function_privilege('anon', 'publico.suscribirse_newsletter(text, text, boolean, uuid, text)', 'execute'), true, 'suscribirse_newsletter conserva el permiso de anon');

-- ===== Topes (un solo lugar cada uno) =====
select is(private.limite_newsletter_visitante_hora(), 5, 'tope por visitante: 5 por hora');
select is(private.limite_newsletter_red_hora(), 30, 'tope por red: 30 por hora');
select is(private.limite_baja_correo_hora(), 60, 'tope de la baja: 60 por hora');

-- ===== Red de una IP =====
select is(private.red_de_ip('10.1.2.3'), '10.1.2', 'IPv4: se descarta el último octeto (/24)');
select is(private.red_de_ip('10.1.2.255'), '10.1.2', 'IPv4: el borde alto del último octeto');
select is(private.red_de_ip('2001:db8:1:2:3:4:5:6'), '2001:db8:1:2', 'IPv6: los primeros cuatro grupos');
select is(private.red_de_ip('2001:db8::1'), '2001:db8::1', 'IPv6 comprimida: los primeros cuatro campos del texto (incluye el vacío del ::)');
select is(private.red_de_ip('sin-ip'), 'sin-ip', 'sin IP: se devuelve igual');
select is(private.red_de_ip('1.2.3'), '1.2.3', 'un texto que no es IPv4 completa se devuelve igual');

-- ===== IP del cliente =====
select set_config('request.headers', '{"x-forwarded-for":"9.9.9.9, 10.2.3.4"}', true);
select is(private.ip_cliente_publica(), '10.2.3.4', 'con la cadena de proxies se toma el último valor (saltos de confianza = 0)');
select set_config('request.headers', '{}', true);
select is(private.ip_cliente_publica(), 'sin-ip', 'sin cabecera: sin-ip');
select set_config('request.headers', '', true);
select is(private.ip_cliente_publica(), 'sin-ip', 'cabeceras vacías: sin-ip');
select set_config('request.headers', json_build_object('x-forwarded-for', repeat('9', 200))::text, true);
select is(char_length(private.ip_cliente_publica()), 64, 'un valor enorme se acota a 64 caracteres');

-- ===== consumir_cupo_ip: límite - 1, límite y límite + 1 (tope 3) =====
select is((select se_consumio from private.consumir_cupo_ip('baja-correo', repeat('a', 64), 3)), true, 'uso 1 de 3: consume');
select results_eq($$ select se_consumio, usos_actuales from private.consumir_cupo_ip('baja-correo', repeat('a', 64), 3) $$, $$ values (true, 2) $$, 'uso 2 de 3 (límite - 1)');
select results_eq($$ select se_consumio, usos_actuales from private.consumir_cupo_ip('baja-correo', repeat('a', 64), 3) $$, $$ values (true, 3) $$, 'uso 3 de 3 (el límite)');
select results_eq($$ select se_consumio, usos_actuales from private.consumir_cupo_ip('baja-correo', repeat('a', 64), 3) $$, $$ values (false, 3) $$, 'uso 4 de 3 (límite + 1): no consume');
select is((select usos from private.cupo_publico_ip where ambito = 'baja-correo' and clave = repeat('a', 64)), 3, 'los rechazos no incrementan lo guardado');
select is(
  (select segundos_hasta_reinicio from private.consumir_cupo_ip('baja-correo', repeat('a', 64), 3)),
  (ceil(extract(epoch from ((date_trunc('hour', now() at time zone 'UTC') at time zone 'UTC') + interval '1 hour' - now())))::int),
  'segundos_hasta_reinicio es lo que falta para la próxima hora en punto UTC');
select results_eq($$ select se_consumio, usos_actuales from private.consumir_cupo_ip('baja-correo', repeat('b', 64), 3) $$, $$ values (true, 1) $$, 'otra clave arranca en 1');
select results_eq($$ select se_consumio, usos_actuales from private.consumir_cupo_ip('newsletter-red', repeat('a', 64), 3) $$, $$ values (true, 1) $$, 'otro ámbito con la misma clave arranca en 1');
select results_eq($$ select se_consumio, usos_actuales from private.consumir_cupo_ip('baja-correo', repeat('a', 64), 2) $$, $$ values (false, 3) $$, 'con el tope bajado a 2 y 3 usos: no consume y no retrocede');

-- Ventana anterior: no cuenta en la actual y se poda (la de hace tres horas) pero no la de la hora previa.
insert into private.cupo_publico_ip (ambito, clave, ventana, usos) values
  ('baja-correo', repeat('c', 64), (date_trunc('hour', now() at time zone 'UTC') at time zone 'UTC') - interval '1 hour', 9),
  ('baja-correo', repeat('d', 64), (date_trunc('hour', now() at time zone 'UTC') at time zone 'UTC') - interval '3 hours', 9);
select results_eq($$ select se_consumio, usos_actuales from private.consumir_cupo_ip('baja-correo', repeat('c', 64), 3) $$, $$ values (true, 1) $$, 'con la hora anterior agotada, la actual arranca de cero');
select is((select count(*)::int from private.cupo_publico_ip where clave = repeat('d', 64)), 0, 'la ventana de hace tres horas se poda en el consumo');
select is((select usos from private.cupo_publico_ip where clave = repeat('c', 64)
            and ventana = (date_trunc('hour', now() at time zone 'UTC') at time zone 'UTC') - interval '1 hour'), 9, 'la ventana de la hora previa no se toca');

-- ===== Argumentos y restricciones =====
select throws_ok($$ select * from private.consumir_cupo_ip('baja-correo', repeat('a', 64), 0) $$, '22023', 'consumir_cupo_ip: el límite debe ser un entero entre 1 y 1000', 'límite 0');
select throws_ok($$ select * from private.consumir_cupo_ip('baja-correo', repeat('a', 64), null) $$, '22023', 'consumir_cupo_ip: el límite debe ser un entero entre 1 y 1000', 'límite nulo');
select throws_ok($$ select * from private.consumir_cupo_ip('baja-correo', repeat('a', 64), 1001) $$, '22023', 'consumir_cupo_ip: el límite debe ser un entero entre 1 y 1000', 'límite 1001');
select results_eq($$ select se_consumio from private.consumir_cupo_ip('baja-correo', repeat('e', 64), 1000) $$, $$ values (true) $$, 'límite 1000 (el máximo) es válido');
select throws_ok($$ select * from private.consumir_cupo_ip('otro', repeat('a', 64), 3) $$, '23514',
  'new row for relation "cupo_publico_ip" violates check constraint "cupo_publico_ip_ambito_valido"', 'un ámbito desconocido se rechaza');
select throws_ok($$ select * from private.consumir_cupo_ip('baja-correo', '10.1.2.3', 3) $$, '23514',
  'new row for relation "cupo_publico_ip" violates check constraint "cupo_publico_ip_clave_hmac"', 'una IP en claro como clave se rechaza');
select throws_ok($$ insert into private.cupo_publico_ip values ('baja-correo', repeat('f', 64), now(), 1) $$, '23514',
  'new row for relation "cupo_publico_ip" violates check constraint "cupo_publico_ip_ventana_horaria"', 'la ventana es una hora en punto');
select throws_ok($$ insert into private.cupo_publico_ip values ('baja-correo', repeat('f', 64), date_trunc('hour', now() at time zone 'UTC') at time zone 'UTC', 0) $$, '23514',
  'new row for relation "cupo_publico_ip" violates check constraint "cupo_publico_ip_usos_positivos"', 'usos >= 1');

-- ===== Baja de correo masivo (MSF-980): 60 por hora y visitante =====
select is(pg_temp.consumir_baja_n('203.0.113.7', 60), 60, 'los primeros 60 pedidos de una IP pasan');
select results_eq($$ select se_consumio, segundos_hasta_reinicio between 1 and 3600 from public.consumir_cupo_baja_correo('203.0.113.7') $$, $$ values (false, true) $$,
  'el pedido 61 se rechaza con la espera en segundos');
select results_eq($$ select se_consumio from public.consumir_cupo_baja_correo('203.0.113.8') $$, $$ values (true) $$, 'otra IP tiene su propio cupo');
select results_eq($$ select se_consumio from public.consumir_cupo_baja_correo(null) $$, $$ values (true) $$, 'sin IP cae en el cupo único sin-ip');
select results_eq($$ select se_consumio from public.consumir_cupo_baja_correo('   ') $$, $$ values (true) $$, 'una IP en blanco también cae en sin-ip');
select is((select usos from private.cupo_publico_ip where ambito = 'baja-correo' and clave = private.hmac_visitante('baja-correo|sin-ip')), 2, 'null y en blanco comparten el cupo sin-ip');
select is((select usos from private.cupo_publico_ip where ambito = 'baja-correo' and clave = private.hmac_visitante('baja-correo|203.0.113.7')), 60, 'la clave guardada es el HMAC del ámbito y la IP');
select is((select count(*)::int from private.cupo_publico_ip where clave ~ '203\.0\.113' or clave ~ '\.'), 0, 'ninguna clave guardada contiene la IP');

-- ===== Suscripción: cupo propio por visitante y por red (MSF-971) =====
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
select set_config('request.headers', '{"x-forwarded-for":"10.9.0.1"}', true);
set local role anon;
insert into res select 'v_' || g, publico.suscribirse_newsletter('nl-cupo-a.ejemplo.com', 'visitante' || g || '@ejemplo.com', true, ('00000000-0000-0000-0000-0000000001' || lpad(g::text, 2, '0'))::uuid, '')
  from generate_series(1, 6) g;
reset role;
select is((select count(*)::int from res where clave like 'v\_%' and j ->> 'resultado' = 'ok'), 5, 'el visitante hace 5 altas por hora (el tope)');
select results_eq($$ select j ->> 'resultado', (j ->> 'espera_segundos')::int between 1 and 3600 from res where clave = 'v_6' $$, $$ values ('limite', true) $$,
  'la sexta responde limite con la espera (límite + 1)');
select is((select count(*)::int from dominio.newsletter_suscriptores where correo = 'visitante6@ejemplo.com'), 0, 'lo rechazado por el cupo no se guarda');
-- (Con el tope por visitante igual al compartido de 5, el sexto lo corta antes `registrar_envio_tienda`: el cupo propio por visitante se prueba
-- directo, más abajo; el de la red sí se alcanza por la suscripción.)

-- Otra tienda: cupo propio por tienda.
set local role anon;
insert into res values ('otra_tienda', publico.suscribirse_newsletter('nl-cupo-b.ejemplo.com', 'otra.tienda@ejemplo.com', true, '00000000-0000-0000-0000-000000000201', ''));
reset role;
select is((select j ->> 'resultado' from res where clave = 'otra_tienda'), 'ok', 'el mismo visitante en otra tienda tiene su propio cupo');

-- Red: 30 visitantes distintos de 10.9.1.0/24 pasan; el 31 de la misma red se rechaza; otra red pasa.
set local role anon;
insert into res select 'r_' || g, pg_temp.suscribir_desde('nl-cupo-a.ejemplo.com', '10.9.1.' || g, 'red' || g || '@ejemplo.com', ('00000000-0000-0000-0000-0000000003' || lpad(g::text, 2, '0'))::uuid)
  from generate_series(1, 31) g;
reset role;
select is((select count(*)::int from res where clave like 'r\_%' and j ->> 'resultado' = 'ok'), 30, 'una red /24 hace 30 altas por hora (el tope por red)');
select is((select j ->> 'resultado' from res where clave = 'r_31'), 'limite', 'la alta 31 de la misma red se rechaza aunque venga de otra IP (límite + 1)');
select is((select count(*)::int from dominio.tienda_envios where clave_envio = '00000000-0000-0000-0000-000000000331'), 0,
  'un rechazo por el cupo propio deshace el registro compartido: el reintento con la misma clave no responde ok en vano');
select is((select count(*)::int from dominio.tienda_envios where clave_envio = '00000000-0000-0000-0000-000000000330'), 1,
  'la alta 30 (la última que pasó) sí conserva su registro');
select is((select count(*)::int from dominio.newsletter_suscriptores where correo = 'red31@ejemplo.com'), 0, 'la alta rechazada por la red no se guarda');
select set_config('request.headers', '{"x-forwarded-for":"10.9.2.1"}', true);
set local role anon;
insert into res values ('otra_red', publico.suscribirse_newsletter('nl-cupo-a.ejemplo.com', 'otra.red@ejemplo.com', true, '00000000-0000-0000-0000-000000000401', ''));
reset role;
select is((select j ->> 'resultado' from res where clave = 'otra_red'), 'ok', 'otra red /24 no se ve afectada');

-- Cupo propio por visitante, directo: 5 por hora y tienda (límite - 1, límite y límite + 1).
select set_config('request.headers', '{"x-forwarded-for":"10.9.4.1"}', true);
select is(pg_temp.consumir_nl_n('e9500000-0000-0000-0000-000000000001', 5), 5,
  'los primeros 5 pasan');
select results_eq($$ select se_consumio, segundos_hasta_reinicio between 1 and 3600 from private.consumir_cupo_newsletter('e9500000-0000-0000-0000-000000000001') $$,
  $$ values (false, true) $$, 'el sexto del mismo visitante se rechaza con la espera');
select is((select usos from private.cupo_publico_ip where ambito = 'newsletter-red'
            and clave = private.hmac_visitante('newsletter-red|e9500000-0000-0000-0000-000000000001|10.9.4')), 5,
  'el visitante agotado no gastó el cupo de su red con el intento rechazado');
select set_config('request.headers', '{"x-forwarded-for":"10.9.0.1"}', true);

-- No enumera: el rechazo no depende de la dirección (una ya suscripta y una nueva reciben lo mismo desde un origen agotado).
select set_config('request.headers', '{"x-forwarded-for":"10.9.0.1"}', true);
set local role anon;
insert into res values
  ('enum_existente', publico.suscribirse_newsletter('nl-cupo-a.ejemplo.com', 'visitante1@ejemplo.com', true, '00000000-0000-0000-0000-000000000501', '')),
  ('enum_nueva', publico.suscribirse_newsletter('nl-cupo-a.ejemplo.com', 'nunca.vista@ejemplo.com', true, '00000000-0000-0000-0000-000000000502', ''));
reset role;
select is((select count(distinct j)::int from res where clave like 'enum\_%'), 1, 'una dirección existente y una nueva reciben la misma respuesta desde un origen agotado');

-- Qué se guardó: solo HMAC; ninguna IP ni correo.
select is((select count(*)::int from private.cupo_publico_ip where ambito like 'newsletter-%' and (clave !~ '^[0-9a-f]{64}$')), 0, 'las claves del newsletter son todas HMAC hexadecimal');
select is((select count(*)::int from private.cupo_publico_ip where ambito = 'newsletter-visitante'
            and clave = private.hmac_visitante('newsletter-visitante|e9500000-0000-0000-0000-000000000001|10.9.0.1')), 1, 'la clave del visitante es el HMAC de ámbito, tienda e IP');
select is((select count(*)::int from private.cupo_publico_ip where ambito = 'newsletter-red'
            and clave = private.hmac_visitante('newsletter-red|e9500000-0000-0000-0000-000000000001|10.9.1')), 1, 'la clave de la red es el HMAC de ámbito, tienda y prefijo');

-- ===== Falla cerrada: sin el secreto de Vault no se cuenta ni se acepta nada =====
delete from vault.secrets where name = 'visitante_hmac';
select throws_ok($$ select * from public.consumir_cupo_baja_correo('198.51.100.1') $$, 'P0001', 'falta el secreto visitante_hmac en Vault', 'la baja sin secreto falla (no se cuenta con la IP en claro)');
select set_config('request.headers', '{"x-forwarded-for":"10.9.3.1"}', true);
set local role anon;
insert into res values ('sin_secreto', publico.suscribirse_newsletter('nl-cupo-a.ejemplo.com', 'sin.secreto@ejemplo.com', true, '00000000-0000-0000-0000-000000000601', ''));
reset role;
select is((select j ->> 'resultado' from res where clave = 'sin_secreto'), 'error', 'la suscripción sin secreto responde error y no guarda nada');
select is((select count(*)::int from dominio.newsletter_suscriptores where correo = 'sin.secreto@ejemplo.com'), 0, 'la alta sin secreto no se guarda');

select * from finish();
rollback;
