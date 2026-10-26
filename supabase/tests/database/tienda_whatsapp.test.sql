-- F-TDA-14 (MSF-433, épica MSF-212): registro de la consulta por WhatsApp desde la ficha del producto.
-- Cubre FR-025 y SC-006: producto visible de la tienda del host, rechazo idéntico de oculto /
-- inactivo / de otra empresa, límite compartido con el formulario, idempotencia, origen `whatsapp`
-- y respuestas sin datos internos (FR-061). Además comprueba el aislamiento entre tiendas (FR-060).
-- Las llamadas públicas se hacen como `anon` con `request.headers` (IP del visitante) y se guardan en
-- una tabla temporal; las verificaciones corren como postgres (o como `authenticated` para el RLS).
begin;

select plan(33);

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

insert into dominio.empresas (id, organizacion_id, nombre, whatsapp, correo, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', '+54 9 11 5555-0001', 'a@ejemplo.com', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda B', '+54 9 11 5555-0002', 'b@ejemplo.com', true),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Tienda apagada', '123456789', 'x@ejemplo.com', false),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda Dos', '11112222', 'dos@ejemplo.com', true);

insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'wa-a.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'wa-b.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000003', 'wa-apagada.ejemplo.com'),
  ('22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-000000000001', 'wa-dos.ejemplo.com');

insert into dominio.categorias (id, organizacion_id, nombre, posicion) values
  ('ca000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Accesorios', 1);

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo, categoria_id) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Alfa', 'WA-1', 1000, 'ARS', true, 'ca000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Beta', 'WA-2', 2000, 'ARS', true, 'ca000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Gamma', 'WA-3', 3000, 'ARS', false, 'ca000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Epsilon', 'WA-5', 5000, 'ARS', true, 'ca000000-0000-0000-0000-000000000001'),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Delta', 'WA-4', 4000, 'ARS', true, null);

insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id) values
  ('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('a1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('a1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  -- «Epsilon» es de «Tienda B», otra empresa de la MISMA organización: no puede terminar en la bandeja
  -- de «Tienda A» aunque las dos pertenezcan a la misma organización.
  ('a1000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111'),
  ('b2000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222');

-- La tienda A oculta «Beta»; «Gamma» está inactivo, «Delta» es de la otra organización y «Epsilon» es de
-- otra empresa de la MISMA organización (Tienda B).
insert into dominio.productos_tienda (empresa_id, producto_id, organizacion_id, visible, destacado) values
  ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', false, false);

-- ============================================================================
-- Privilegios y estructura (FR-025)
-- ============================================================================

select is(has_function_privilege('anon', 'publico.registrar_consulta_whatsapp(text, uuid, uuid)', 'execute'), true, 'anon ejecuta registrar_consulta_whatsapp');
select is(has_function_privilege('authenticated', 'publico.registrar_consulta_whatsapp(text, uuid, uuid)', 'execute'), true, 'authenticated ejecuta registrar_consulta_whatsapp');
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
select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'publico' and p.proname = 'registrar_consulta_whatsapp'),
  true, 'la función pública es SECURITY DEFINER (la empresa sale del host, no del cliente)'
);
-- Misma convención del resto de las RPC `security definer` del repo (stock_toma_inventario,
-- stock_traslado, stock_reservas, catalogo_disponibilidad): el `search_path` tiene que estar vacío.
-- Esta función la puede ejecutar `anon` desde internet: sin `search_path` vacío, un objeto sin
-- cualificar podría resolver a otra cosa que el dueño y escalarse (el riesgo clásico de
-- `security definer`). La migración lo fija; este assert lo vigila para que una regresión se vea.
select is(
  (select p.prosecdef and p.proconfig @> array['search_path=""']
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'publico' and p.proname = 'registrar_consulta_whatsapp'),
  true, 'la función pública es SECURITY DEFINER con search_path vacío'
);
-- La consulta que registra esta historia aterriza en `dominio.consultas`: su aislamiento por
-- organización (FR-060) depende de que esa tabla tenga RLS.
select is(
  (select relrowsecurity from pg_class where oid = 'dominio.consultas'::regclass),
  true, 'dominio.consultas tiene RLS (el aislamiento de la consulta depende de eso)'
);
-- Quién puede ejecutarla (FR-025: `revoke … from public, anon` + `grant execute … to anon, authenticated`).
-- `has_function_privilege` NO alcanza para probarlo: si PUBLIC tuviera EXECUTE también respondería true
-- para anon y authenticated. Por eso se mira el ACL real de la función con `aclexplode`: `coalesce` con
-- `acldefault('f', …)` modela el ACL por defecto de una función (que le da EXECUTE a PUBLIC), así el test
-- falla si alguien saca el `revoke … from public`.
select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where n.nspname = 'publico'
      and p.proname = 'registrar_consulta_whatsapp'
      and acl.grantee = 0::oid
      and acl.privilege_type = 'EXECUTE'),
  0, 'la función pública NO es ejecutable por PUBLIC (revoke ... from public aplicado)'
);
select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl on true
     join pg_roles r on r.oid = acl.grantee
    where n.nspname = 'publico'
      and p.proname = 'registrar_consulta_whatsapp'
      and acl.privilege_type = 'EXECUTE'
      and acl.grantee <> p.proowner
      and r.rolname::text not in ('anon', 'authenticated')),
  0, 'ningún rol ajeno al dueño, anon y authenticated puede ejecutar la función pública'
);

-- ============================================================================
-- Producto visible y rechazos idénticos (FR-025, FR-061)
-- ============================================================================

create temp table res (clave text primary key, j jsonb);
grant all on res to anon;

-- ============================================================================
-- Falla interna: la respuesta sigue siendo la genérica (FR-025, FR-061)
-- ============================================================================

-- Se simula una falla de la base en la búsqueda del producto (la parte que antes no estaba
-- protegida). La función pública tiene que responder el MISMO error genérico: al llamante anónimo
-- no le puede llegar el mensaje crudo de Postgres (FR-061).
alter function private.catalogo_tienda_efectivo(uuid) rename to catalogo_tienda_efectivo_real;
create function private.catalogo_tienda_efectivo(p_empresa uuid)
returns table (
  producto_id uuid, nombre text, activo boolean, moneda text, precio numeric, stock integer,
  categoria_id uuid, visible boolean, destacado boolean, efectivo boolean, motivo text
)
language plpgsql
volatile
set search_path = ''
as $$
begin
  raise exception 'detalle interno simulado: la tabla privada_secreta no existe';
end;
$$;
revoke execute on function private.catalogo_tienda_efectivo(uuid) from public, anon, authenticated;

select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
select set_config('request.headers', '{"x-forwarded-for":"10.0.0.9"}', true);
set local role anon;
insert into res values
  ('w_falla_interna', publico.registrar_consulta_whatsapp('wa-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e1'));
reset role;

-- Se restaura la función real: el rename conserva su definición (no hay que copiarla).
alter function private.catalogo_tienda_efectivo(uuid) rename to catalogo_tienda_efectivo_stub;
alter function private.catalogo_tienda_efectivo_real(uuid) rename to catalogo_tienda_efectivo;

select is(
  (select j from res where clave = 'w_falla_interna'),
  '{"estado":"error"}'::jsonb,
  'una falla interna responde el mismo error genérico (no escapa el mensaje de Postgres)'
);
select is(
  (select count(*)::int from dominio.consultas),
  0,
  'la falla interna no registra ninguna consulta'
);
select is(
  (select count(*)::int from dominio.tienda_envios),
  0,
  'la falla interna no gasta cupo'
);

select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
select set_config('request.headers', '{"x-forwarded-for":"10.0.0.1"}', true);
set local role anon;

insert into res values
  ('w_ok', publico.registrar_consulta_whatsapp('wa-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1')),
  ('w_ok_repetido', publico.registrar_consulta_whatsapp('wa-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1')),
  ('w_oculto', publico.registrar_consulta_whatsapp('wa-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b2')),
  ('w_inactivo', publico.registrar_consulta_whatsapp('wa-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000b3')),
  ('w_ajeno', publico.registrar_consulta_whatsapp('wa-a.ejemplo.com', 'b2000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b4')),
  ('w_ajeno_misma_org', publico.registrar_consulta_whatsapp('wa-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000b9')),
  ('w_inexistente', publico.registrar_consulta_whatsapp('wa-a.ejemplo.com', 'c3000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b5')),
  ('w_sin_producto', publico.registrar_consulta_whatsapp('wa-a.ejemplo.com', null, '00000000-0000-0000-0000-0000000000b6')),
  ('w_desconocido', publico.registrar_consulta_whatsapp('no-existe.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b7')),
  ('w_apagada', publico.registrar_consulta_whatsapp('wa-apagada.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b8'));

reset role;

select is((select j from res where clave = 'w_ok'), '{"estado":"ok"}'::jsonb, 'producto visible de la tienda → ok');
select is((select j from res where clave = 'w_ok_repetido'), '{"estado":"ok"}'::jsonb, 'idempotencia: la misma clave responde ok');
select is(
  (select count(*)::int from dominio.consultas
    where empresa_id = 'e1000000-0000-0000-0000-000000000001'
      and origen = 'whatsapp'
      and producto_id = 'a1000000-0000-0000-0000-000000000001'),
  1, 'idempotencia: la clave repetida entrega una sola consulta'
);
select is(
  (select row(origen, empresa_id, producto_id)::text from dominio.consultas
    where origen = 'whatsapp' and producto_id = 'a1000000-0000-0000-0000-000000000001'),
  '(whatsapp,e1000000-0000-0000-0000-000000000001,a1000000-0000-0000-0000-000000000001)',
  'la consulta llega a la bandeja de SU empresa con origen whatsapp y el producto'
);
-- El visitante no deja datos en la plataforma: se registran marcas explícitas (sin nombre ni teléfono
-- inventados) y la consulta queda SIN mensaje (nulo), que es como la base normaliza el campo vacío
-- (private.normalizar_consulta) y como lo muestra la bandeja («No dejó mensaje»). Las tres
-- verificaciones apuntan al producto registrado por el caso válido: si un rechazo se colara, la fila
-- extra no vuelve ambigua la comprobación (y el fallo dice qué se rompió).
select is(
  (select nombre from dominio.consultas
    where origen = 'whatsapp' and producto_id = 'a1000000-0000-0000-0000-000000000001'),
  'Visitante de WhatsApp'::text,
  'el visitante no deja un nombre real: la consulta registra la marca explícita'
);
select is(
  (select contacto from dominio.consultas
    where origen = 'whatsapp' and producto_id = 'a1000000-0000-0000-0000-000000000001'),
  'visitante@sin-datos.invalid'::text,
  'el visitante no deja un teléfono ni un correo real: la consulta registra la marca explícita'
);
select ok(
  (select mensaje is null from dominio.consultas
    where origen = 'whatsapp' and producto_id = 'a1000000-0000-0000-0000-000000000001'),
  'el visitante no deja mensaje: la consulta queda sin mensaje (nulo), no con una cadena vacía'
);
select ok(
  (select j = '{"estado":"error"}'::jsonb from res where clave = 'w_oculto')
  and (select j = '{"estado":"error"}'::jsonb from res where clave = 'w_inactivo')
  and (select j = '{"estado":"error"}'::jsonb from res where clave = 'w_ajeno')
  and (select j = '{"estado":"error"}'::jsonb from res where clave = 'w_ajeno_misma_org')
  and (select j = '{"estado":"error"}'::jsonb from res where clave = 'w_inexistente')
  and (select j = '{"estado":"error"}'::jsonb from res where clave = 'w_sin_producto'),
  'producto oculto, inactivo, de otra empresa o inexistente → el mismo error genérico'
);
select is(
  (select count(*)::int from dominio.consultas where empresa_id = 'e1000000-0000-0000-0000-000000000002'),
  0, 'el producto de otra empresa de la misma organización no deja consulta en ninguna bandeja'
);
select ok(
  (select j = (select j from res where clave = 'w_oculto') from res where clave = 'w_desconocido')
  and (select j = (select j from res where clave = 'w_oculto') from res where clave = 'w_apagada'),
  'host desconocido y empresa desactivada → la misma respuesta que un producto no visible'
);
select is(
  (select count(*)::int from dominio.consultas),
  1, 'los rechazos no registran ninguna consulta'
);
select is(
  (select count(*)::int from dominio.tienda_envios where empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  1, 'los rechazos no gastan cupo: solo queda el envío válido'
);
select is(
  (select array(select jsonb_object_keys(j) order by 1) from res where clave = 'w_ok'),
  array['estado'],
  'la respuesta es la lista blanca: sin ids de organización, IP ni hash del visitante'
);
select ok(
  not exists (select 1 from res r where (r.j - 'estado') <> '{}'::jsonb),
  'ninguna respuesta trae claves fuera de la lista blanca (ni en los rechazos ni en el límite)'
);

-- ============================================================================
-- Límite compartido con el formulario (FR-003, D3)
-- ============================================================================

select set_config('request.headers', '{"x-forwarded-for":"10.0.0.2"}', true);
set local role anon;

insert into res values
  ('f_1', publico.enviar_consulta_contacto('wa-a.ejemplo.com', 'Ana', 'ana@ejemplo.com', 'Uno', '00000000-0000-0000-0000-0000000000c1')),
  ('f_2', publico.enviar_consulta_contacto('wa-a.ejemplo.com', 'Ana', 'ana@ejemplo.com', 'Dos', '00000000-0000-0000-0000-0000000000c2')),
  ('f_3', publico.enviar_consulta_contacto('wa-a.ejemplo.com', 'Ana', 'ana@ejemplo.com', 'Tres', '00000000-0000-0000-0000-0000000000c3')),
  ('f_4', publico.enviar_consulta_contacto('wa-a.ejemplo.com', 'Ana', 'ana@ejemplo.com', 'Cuatro', '00000000-0000-0000-0000-0000000000c4')),
  ('w_5', publico.registrar_consulta_whatsapp('wa-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c5')),
  ('w_6', publico.registrar_consulta_whatsapp('wa-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c6')),
  ('f_7', publico.enviar_consulta_contacto('wa-a.ejemplo.com', 'Ana', 'ana@ejemplo.com', 'Siete', '00000000-0000-0000-0000-0000000000c7'));

reset role;

select ok(
  (select j = '{"estado":"ok"}'::jsonb from res where clave = 'f_1')
  and (select j = '{"estado":"ok"}'::jsonb from res where clave = 'f_2')
  and (select j = '{"estado":"ok"}'::jsonb from res where clave = 'f_3')
  and (select j = '{"estado":"ok"}'::jsonb from res where clave = 'f_4')
  and (select j = '{"estado":"ok"}'::jsonb from res where clave = 'w_5'),
  'los cuatro envíos de formulario y el de WhatsApp responden ok (comparten el mismo cupo)'
);
select ok(
  (select j = '{"estado":"limite"}'::jsonb from res where clave = 'w_6'),
  'el sexto envío (de WhatsApp) → limite'
);
select ok(
  (select j ->> 'estado' = 'limite' from res where clave = 'f_7'),
  'el formulario también topa con el cupo usado por WhatsApp (mismo límite)'
);
select is(
  (select count(*)::int from dominio.tienda_envios
    where empresa_id = 'e1000000-0000-0000-0000-000000000001'
      and clave_envio::text like '00000000-0000-0000-0000-0000000000c%'),
  5, 'el límite compartido registró exactamente 5 envíos; los dos siguientes no se guardaron'
);
select is(
  (select count(*)::int from dominio.consultas
    where empresa_id = 'e1000000-0000-0000-0000-000000000001'
      and origen = 'whatsapp'
      and producto_id = 'a1000000-0000-0000-0000-000000000001'
      and created_at > now() - interval '5 minutes'),
  2, 'la consulta de WhatsApp del cupo shared llegó a la bandeja (la del sexto no)'
);

-- ============================================================================
-- Aislamiento entre tiendas (FR-060)
-- ============================================================================

select set_config('request.jwt.claims', json_build_object('sub', 'd2000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from dominio.consultas), 0, 'RLS: otra organización no ve la consulta de WhatsApp');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'd1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select ok((select count(*)::int from dominio.consultas) > 0, 'RLS: la organización dueña ve la consulta de WhatsApp');
reset role;

select * from finish();
rollback;
