-- F-TDA-16 (MSF-437, épica MSF-212): contacto con formulario de la tienda pública.
-- Cubre FR-001…FR-006, FR-008 (espejo servidor), FR-014, FR-060, FR-061, SC-001 y SC-002: lista blanca,
-- `null` idéntico, validación, límite de 5 por hora (por visitante y por empresa), ventana de una hora,
-- idempotencia, reversión si falla la entrega, HTML literal y tabla con RLS sin acceso de `anon`.
-- Las llamadas públicas se hacen como `anon` con `request.headers` (IP del visitante) y se guardan en una
-- tabla temporal; las verificaciones corren como postgres.
begin;

select plan(40);

-- ============================================================================
-- Fixture (como postgres: RLS no aplica)
-- ============================================================================

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre, whatsapp, correo, horarios, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', '+54 9 11 5555-0001', 'a@ejemplo.com', 'Lunes a viernes de 10 a 19 h', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda B', '   ', null, null, true),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Tienda apagada', '123456789', 'x@ejemplo.com', null, false),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda Dos', '11112222', 'dos@ejemplo.com', null, true);

insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ct-a.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'ct-b.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000003', 'ct-apagada.ejemplo.com'),
  ('22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-000000000001', 'ct-dos.ejemplo.com');

-- Falla de entrega simulada: la bandeja rechaza cualquier consulta de «FALLA» (se revierte con el rollback).
create function public.tmp_rechazar_falla() returns trigger language plpgsql as $$
begin
  if new.nombre = 'FALLA' then raise exception 'falla simulada de la bandeja'; end if;
  return new;
end;
$$;
create trigger consultas_falla_simulada before insert on dominio.consultas
  for each row execute function public.tmp_rechazar_falla();

-- ============================================================================
-- Privilegios y estructura (FR-001, FR-002, FR-014)
-- ============================================================================

select is(has_function_privilege('anon', 'publico.contacto_por_dominio(text)', 'execute'), true, 'anon ejecuta contacto_por_dominio');
select is(has_function_privilege('anon', 'publico.enviar_consulta_contacto(text, text, text, text, uuid)', 'execute'), true, 'anon ejecuta enviar_consulta_contacto');
select is(
  has_function_privilege('anon', 'private.registrar_envio_tienda(uuid, text, uuid)', 'execute')
  or has_function_privilege('authenticated', 'private.registrar_envio_tienda(uuid, text, uuid)', 'execute')
  or has_function_privilege('anon', 'private.entregar_a_bandeja(uuid, text, text, text, text, uuid)', 'execute')
  or has_function_privilege('authenticated', 'private.entregar_a_bandeja(uuid, text, text, text, text, uuid)', 'execute'),
  false, 'las funciones internas no son ejecutables por roles de API'
);
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'publico' and c.relkind in ('r', 'p')),
  0, 'publico sigue sin tablas'
);
select is((select relrowsecurity from pg_class where oid = 'dominio.tienda_envios'::regclass), true, 'tienda_envios tiene RLS');
select is(
  has_table_privilege('anon', 'dominio.tienda_envios', 'select')
  or has_table_privilege('anon', 'dominio.tienda_envios', 'insert')
  or has_table_privilege('authenticated', 'dominio.tienda_envios', 'insert')
  or has_table_privilege('authenticated', 'dominio.tienda_envios', 'update')
  or has_table_privilege('authenticated', 'dominio.tienda_envios', 'delete'),
  false, 'tienda_envios: sin acceso de anon y sin escritura para authenticated'
);
select is(has_table_privilege('authenticated', 'dominio.tienda_envios', 'select'), true, 'authenticated solo lee tienda_envios (por RLS)');
select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'dominio.tienda_envios'::regclass and contype = 'u'
      and conkey = (select array_agg(attnum order by attnum) from pg_attribute
                     where attrelid = 'dominio.tienda_envios'::regclass and attname in ('empresa_id', 'clave_envio'))),
  1, 'unique (empresa_id, clave_envio)'
);
select is(
  (select count(*)::int from pg_indexes
    where schemaname = 'dominio' and tablename = 'tienda_envios'
      and indexdef like '%(empresa_id, visitante, creado_en)%'),
  1, 'índice (empresa_id, visitante, creado_en)'
);
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'dominio' and table_name = 'tienda_envios' and column_name in ('ip', 'ip_cliente', 'direccion_ip')),
  0, 'tienda_envios no guarda la IP'
);
select is(has_column_privilege('authenticated', 'dominio.empresas', 'horarios', 'update'), true, 'authenticated actualiza empresas.horarios');
select throws_ok(
  $$update dominio.empresas set horarios = repeat('x', 201) where id = 'e1000000-0000-0000-0000-000000000001'$$,
  '23514', null, 'horarios admite como máximo 200 caracteres'
);
select is(
  (select count(*)::int from pg_proc where pronamespace = 'private'::regnamespace
    and proname = 'registrar_envio_tienda' and prosrc like '%pg_advisory_xact_lock%'),
  1, 'el registro toma un advisory lock por (empresa, visitante)'
);

-- ============================================================================
-- Lecturas anónimas (FR-001, FR-060, FR-061)
-- ============================================================================

create temp table res (clave text primary key, j jsonb);
grant all on res to anon;

select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
select set_config('request.headers', '{"x-forwarded-for":"10.0.0.1"}', true);
set local role anon;

insert into res values
  ('c_a', publico.contacto_por_dominio('ct-a.ejemplo.com')),
  ('c_a_host', publico.contacto_por_dominio('  CT-A.Ejemplo.com.:8080 ')),
  ('c_b', publico.contacto_por_dominio('ct-b.ejemplo.com')),
  ('c_dos', publico.contacto_por_dominio('ct-dos.ejemplo.com')),
  ('c_apagada', publico.contacto_por_dominio('ct-apagada.ejemplo.com')),
  ('c_desconocido', publico.contacto_por_dominio('no-existe.ejemplo.com'));

reset role;

select is(
  (select array(select jsonb_object_keys(j) order by 1) from res where clave = 'c_a'),
  array['correo', 'horarios', 'nombre', 'whatsapp'],
  'contacto_por_dominio: solo la lista blanca (sin organizacion_id, instagram ni internos)'
);
select is(
  (select j from res where clave = 'c_a'),
  '{"nombre":"Tienda A","whatsapp":"+54 9 11 5555-0001","correo":"a@ejemplo.com","horarios":"Lunes a viernes de 10 a 19 h"}'::jsonb,
  'contacto_por_dominio: datos de la empresa del dominio'
);
select is((select j from res where clave = 'c_a_host'), (select j from res where clave = 'c_a'), 'contacto_por_dominio: normaliza el host');
select is(
  (select j from res where clave = 'c_b'),
  '{"nombre":"Tienda B","whatsapp":null,"correo":null,"horarios":null}'::jsonb,
  'contacto_por_dominio: vacíos como null y sin mezclar con la otra tienda'
);
select is((select j ->> 'nombre' from res where clave = 'c_dos'), 'Tienda Dos', 'contacto_por_dominio: otra organización, sus propios datos');
select ok(
  (select j is null from res where clave = 'c_apagada') and (select j is null from res where clave = 'c_desconocido'),
  'contacto_por_dominio: null idéntico para empresa desactivada y host desconocido'
);

-- ============================================================================
-- Envíos (FR-003…FR-006, FR-008, FR-060)
-- ============================================================================

set local role anon;

insert into res values
  -- Visitante 10.0.0.1 en la tienda A: dos veces la misma clave, datos inválidos y hosts que no sirven.
  ('e_k1', publico.enviar_consulta_contacto('ct-a.ejemplo.com', '  Ana  ', 'ana@ejemplo.com', 'Hola, ¿tienen stock?', '00000000-0000-0000-0000-0000000000a1')),
  ('e_k1_repetido', publico.enviar_consulta_contacto('ct-a.ejemplo.com', 'Ana', 'ana@ejemplo.com', 'Hola, ¿tienen stock?', '00000000-0000-0000-0000-0000000000a1')),
  ('e_vacio', publico.enviar_consulta_contacto('ct-a.ejemplo.com', '', '', '', '00000000-0000-0000-0000-0000000000f9')),
  ('e_largos', publico.enviar_consulta_contacto('ct-a.ejemplo.com', repeat('n', 101), 'sin-formato', repeat('m', 2001), '00000000-0000-0000-0000-0000000000f9')),
  ('e_telefono_corto', publico.enviar_consulta_contacto('ct-a.ejemplo.com', 'Ana', '1234567', 'Hola', '00000000-0000-0000-0000-0000000000f9')),
  ('e_telefono_ok', publico.enviar_consulta_contacto('ct-a.ejemplo.com', 'Ana', '+54 9 11 5555-1234', 'Hola', '00000000-0000-0000-0000-0000000000a2')),
  ('e_desconocido', publico.enviar_consulta_contacto('no-existe.ejemplo.com', 'Ana', 'ana@ejemplo.com', 'Hola', '00000000-0000-0000-0000-0000000000c1')),
  ('e_apagada', publico.enviar_consulta_contacto('ct-apagada.ejemplo.com', 'Ana', 'ana@ejemplo.com', 'Hola', '00000000-0000-0000-0000-0000000000c2')),
  -- Hasta completar los cinco y el sexto con espera.
  ('e_k3', publico.enviar_consulta_contacto('ct-a.ejemplo.com', 'Ana', 'ana@ejemplo.com', 'Dos', '00000000-0000-0000-0000-0000000000a3')),
  ('e_k4', publico.enviar_consulta_contacto('ct-a.ejemplo.com', 'Ana', 'ana@ejemplo.com', 'Tres', '00000000-0000-0000-0000-0000000000a4')),
  ('e_k5', publico.enviar_consulta_contacto('ct-a.ejemplo.com', 'Ana', 'ana@ejemplo.com', 'Cuatro', '00000000-0000-0000-0000-0000000000a5')),
  ('e_k6', publico.enviar_consulta_contacto('ct-a.ejemplo.com', 'Ana', 'ana@ejemplo.com', 'Seis', '00000000-0000-0000-0000-0000000000a6')),
  -- Una clave ya usada sigue respondiendo ok aunque el cupo esté agotado (no gasta cupo).
  ('e_k1_con_cupo_agotado', publico.enviar_consulta_contacto('ct-a.ejemplo.com', 'Ana', 'ana@ejemplo.com', 'Hola, ¿tienen stock?', '00000000-0000-0000-0000-0000000000a1')),
  -- Límite independiente por empresa: el mismo visitante en la tienda B.
  ('e_b', publico.enviar_consulta_contacto('ct-b.ejemplo.com', 'Ana', 'ana@ejemplo.com', 'Hola B', '00000000-0000-0000-0000-0000000000d1'));

-- Otro visitante en la tienda A (límite independiente por visitante) con HTML en los campos.
select set_config('request.headers', '{"x-forwarded-for":"10.0.0.2"}', true);
insert into res values
  ('e_html', publico.enviar_consulta_contacto('ct-a.ejemplo.com', '<b>Ana</b>', 'html@ejemplo.com', '<script>alert(1)</script> & "comillas"', '00000000-0000-0000-0000-0000000000e1')),
  ('e_falla', publico.enviar_consulta_contacto('ct-a.ejemplo.com', 'FALLA', 'ana@ejemplo.com', 'Esto no entra', '00000000-0000-0000-0000-0000000000f1'));

-- Sin cabecera de IP: cupo único «sin-ip».
select set_config('request.headers', '{}', true);
insert into res values
  ('e_sin_ip', publico.enviar_consulta_contacto('ct-a.ejemplo.com', 'Ana', 'ana@ejemplo.com', 'Sin IP', '00000000-0000-0000-0000-0000000000f2'));

reset role;

select is((select j from res where clave = 'e_k1'), '{"estado":"ok"}'::jsonb, 'enviar: datos válidos → ok');
select is(
  (select count(*)::int from dominio.consultas where empresa_id = 'e1000000-0000-0000-0000-000000000001' and mensaje = 'Hola, ¿tienen stock?'),
  1, 'idempotencia: la misma clave entrega una sola consulta'
);
select is(
  (select row(origen, nombre, contacto, empresa_id)::text from dominio.consultas where mensaje = 'Hola, ¿tienen stock?'),
  '(formulario,Ana,ana@ejemplo.com,e1000000-0000-0000-0000-000000000001)',
  'la consulta llega a la bandeja de SU empresa con origen formulario (textos recortados)'
);
select ok(
  (select j = '{"estado":"ok"}'::jsonb from res where clave = 'e_k1_repetido')
  and (select j = '{"estado":"ok"}'::jsonb from res where clave = 'e_k1_con_cupo_agotado'),
  'idempotencia: la clave repetida responde ok, también con el cupo agotado'
);
select is(
  (select j from res where clave = 'e_vacio'),
  '{"estado":"invalido","campos":["nombre","contacto","mensaje"]}'::jsonb,
  'validación: campos vacíos → invalido con los tres campos'
);
select is(
  (select j from res where clave = 'e_largos'),
  '{"estado":"invalido","campos":["nombre","contacto","mensaje"]}'::jsonb,
  'validación: topes de longitud y formato de contacto'
);
select is(
  (select j from res where clave = 'e_telefono_corto'),
  '{"estado":"invalido","campos":["contacto"]}'::jsonb,
  'validación: teléfono de menos de 8 dígitos'
);
select is((select j from res where clave = 'e_telefono_ok'), '{"estado":"ok"}'::jsonb, 'validación: teléfono con +, espacios y guiones');
select ok(
  (select j from res where clave = 'e_desconocido') = '{"estado":"error"}'::jsonb
  and (select j from res where clave = 'e_apagada') = (select j from res where clave = 'e_desconocido'),
  'host desconocido y empresa desactivada → el mismo error genérico'
);
select ok(
  (select j ->> 'estado' = 'limite' and (j ->> 'espera_segundos')::int between 1 and 3600 from res where clave = 'e_k6'),
  'el sexto envío de la hora → limite con la espera en segundos'
);
select is(
  (select count(*)::int from dominio.tienda_envios
    where empresa_id = 'e1000000-0000-0000-0000-000000000001' and clave_envio::text like '00000000-0000-0000-0000-0000000000a%'),
  5, 'el límite registró exactamente 5 envíos; el sexto no se guardó'
);
select is((select j from res where clave = 'e_b'), '{"estado":"ok"}'::jsonb, 'límite independiente por empresa');
select is((select j from res where clave = 'e_html'), '{"estado":"ok"}'::jsonb, 'límite independiente por visitante');
select ok(
  exists (select 1 from dominio.consultas
           where contacto = 'html@ejemplo.com' and nombre = '<b>Ana</b>'
             and mensaje = '<script>alert(1)</script> & "comillas"'),
  'el HTML se guarda literal'
);
select ok(
  (select j = '{"estado":"error"}'::jsonb from res where clave = 'e_falla')
  and not exists (select 1 from dominio.tienda_envios where clave_envio = '00000000-0000-0000-0000-0000000000f1')
  and not exists (select 1 from dominio.consultas where nombre = 'FALLA'),
  'si falla la entrega: error genérico y se revierte el registro del envío'
);
select ok(
  (select j ->> 'estado' = 'ok' and not (j ? 'organizacion_id') from res where clave = 'e_k1'),
  'la respuesta no incluye datos internos'
);

-- Ventana de una hora: se envejecen los cinco envíos del visitante 10.0.0.1 y vuelve a haber cupo.
update dominio.tienda_envios set creado_en = now() - interval '61 minutes'
 where empresa_id = 'e1000000-0000-0000-0000-000000000001' and clave_envio::text like '00000000-0000-0000-0000-0000000000a%';
select set_config('request.headers', '{"x-forwarded-for":"10.0.0.1"}', true);
set local role anon;
insert into res values
  ('e_ventana', publico.enviar_consulta_contacto('ct-a.ejemplo.com', 'Ana', 'ana@ejemplo.com', 'Pasó la hora', '00000000-0000-0000-0000-0000000000a7'));
reset role;
select is((select j from res where clave = 'e_ventana'), '{"estado":"ok"}'::jsonb, 'pasada la hora, el visitante vuelve a tener cupo');

-- Sin IP: cupo propio y hash fijo; nunca se guarda una IP.
select ok(
  (select j = '{"estado":"ok"}'::jsonb from res where clave = 'e_sin_ip')
  and exists (select 1 from dominio.tienda_envios
               where clave_envio = '00000000-0000-0000-0000-0000000000f2'
                 and visitante = encode(sha256(convert_to('sin-ip|e1000000-0000-0000-0000-000000000001', 'UTF8')), 'hex')),
  'sin cabecera de IP: cupo único «sin-ip»'
);
select is(
  (select count(*)::int from dominio.tienda_envios where visitante ~ '^[0-9.]+$' or visitante like '%10.0.0.%'),
  0, 'el visitante se guarda como hash, nunca como IP'
);

-- ============================================================================
-- Aislamiento por organización de la tabla (RLS, FR-060)
-- ============================================================================

select set_config('request.jwt.claims', json_build_object('sub', 'd2000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from dominio.tienda_envios), 0, 'RLS: otra organización no ve los envíos');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'd1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select ok((select count(*)::int from dominio.tienda_envios) > 0, 'RLS: la organización dueña ve sus envíos');
reset role;

select * from finish();
rollback;
