-- Datos de demostración se agregarán sólo cuando exista la primera spec de negocio.

-- Superadmin de desarrollo local. Sin esto, cada `supabase db reset` (o el
-- primer `pnpm dev:supabase`) deja la plataforma sin ningún superadmin y hay
-- que darlo de alta a mano por SQL (ver quickstart de la spec 003). Sólo
-- corre en local: seed.sql no se aplica contra un proyecto remoto.
--
-- Credenciales fijas, sólo para el stack local:
--   email:    superadmin@local.test
--   password: Superadmin-Local1!
do $$
declare
  v_user_id uuid;
begin
  select id into v_user_id
  from auth.users
  where email = 'superadmin@local.test';

  if v_user_id is null then
    v_user_id := gen_random_uuid();

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      created_at, updated_at
    ) values (
      '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated',
      'authenticated', 'superadmin@local.test',
      crypt('Superadmin-Local1!', gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      '', '', '', '',
      now(), now()
    );

    insert into auth.identities (
      id, provider_id, user_id, identity_data, provider, created_at, updated_at
    ) values (
      gen_random_uuid(), v_user_id::text, v_user_id,
      jsonb_build_object('sub', v_user_id::text, 'email', 'superadmin@local.test'),
      'email', now(), now()
    );
  end if;

  insert into superadmins (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;
end $$;

-- Completa el registro de chat-ia cuando la migración
-- 20261005000000_chat_companion_mechanism.sql no pudo hacerlo (reset desde
-- cero: migraciones corren antes que este seed, sin superadmin todavía).
-- registrar_feature exige impersonar un superadmin real (private.is_superadmin()
-- lee request.jwt.claims) — sin este set_config falla con "Solo un superadmin
-- puede registrar funcionalidades" aunque el caller sea postgres.
do $$
declare
  v_actor uuid;
begin
  select user_id into v_actor from public.superadmins order by user_id limit 1;
  if v_actor is null then
    return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_actor)::text, true);

  if not exists (select 1 from public.features where id = 'chat-ia') then
    perform public.registrar_feature(
      'chat-ia',
      'Chat',
      'Chat conversacional con acceso a los datos de las funcionalidades habilitadas de la organización.'
    );
  end if;
end $$;

-- Completa el registro de busqueda-documental cuando la migración
-- 20261005000000_rag_busqueda_documental.sql no pudo hacerlo (reset desde
-- cero: migraciones corren antes que este seed, sin superadmin todavía).
-- registrar_feature exige impersonar un superadmin real (private.is_superadmin()
-- lee request.jwt.claims) — sin este set_config falla con "Solo un superadmin
-- puede registrar funcionalidades" aunque el caller sea postgres.
do $$
declare
  v_actor uuid;
begin
  select user_id into v_actor from public.superadmins order by user_id limit 1;
  if v_actor is null then
    return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_actor)::text, true);

  if not exists (select 1 from public.features where id = 'busqueda-documental') then
    perform public.registrar_feature(
      'busqueda-documental',
      'Búsqueda documental (RAG)',
      'Subir documentos propios de la organización y preguntarles en lenguaje natural, con respuestas que citan el documento de origen.'
    );
  end if;
end $$;

-- Completa el registro de service-tecnico (F-SVC-01, MSF-254) cuando la migración
-- 20261020100700_service_funcionalidad.sql no pudo hacerlo (reset desde cero: las
-- migraciones corren antes que este seed, sin superadmin todavía). Registrarla no la
-- habilita: un superadmin la activa por organización desde Funcionalidades.
do $$
declare
  v_actor uuid;
begin
  select user_id into v_actor from public.superadmins order by user_id limit 1;
  if v_actor is null then
    return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_actor)::text, true);

  if not exists (select 1 from public.features where id = 'service-tecnico') then
    perform public.registrar_feature(
      'service-tecnico',
      'Service técnico',
      'Reparaciones de equipos: modelos, estados configurables, alta y seguimiento de cada reparación.'
    );
  end if;
end $$;

-- F-SVC-23 (MSF-168): registra el reporte «Service técnico» cuando la migración
-- 20270122130300_reportes_service.sql no pudo hacerlo (reset desde cero: las
-- migraciones corren antes que este seed, sin usuarios todavía, y la fila exige
-- `creado_por`). Los roles por defecto se cargan acá porque en el reset limpio la
-- migración tampoco pudo insertarlos (dependen de la fila). La asignación a las
-- organizaciones la hacen los triggers de esa migración cuando la organización
-- habilita el módulo `service-tecnico`.
do $$
declare
  v_actor uuid;
begin
  select user_id into v_actor from public.superadmins order by user_id limit 1;
  if v_actor is null then
    return;
  end if;

  if not exists (select 1 from public.reportes where nombre = 'Service técnico') then
    insert into public.reportes (superset_dashboard_uuid, nombre, creado_por, seccion)
    values ('service-tecnico', 'Service técnico', v_actor, 'service_tecnico');
  end if;

  insert into public.reportes_roles_default (reporte_id, rol_id)
  select r.id, d.rol_id
  from public.reportes r
  cross join (values ('administracion'), ('consulta')) as d(rol_id)
  where r.nombre = 'Service técnico'
  on conflict (reporte_id, rol_id) do nothing;
end $$;

-- F-AUD-01 (MSF-463): eventos de ejemplo para probar la pantalla Actividad.
-- Solo corre en local (seed.sql no se aplica a producción). Para cada
-- organización que todavía no tenga historial inserta unos pocos eventos
-- repartidos en los últimos días; si no hay organizaciones al correr el seed,
-- no hace nada (ver docs/actividad.md para sembrar una organización puntual).
do $$
declare
  v_org record;
  v_empresa uuid;
  v_actor uuid;
begin
  for v_org in
    select o.id from public.organizaciones o
    where not exists (select 1 from public.registro_actividad r where r.organizacion_id = o.id)
  loop
    select e.id into v_empresa from dominio.empresas e where e.organizacion_id = v_org.id order by e.created_at limit 1;
    select u.user_id into v_actor from public.usuarios_organizacion u where u.organizacion_id = v_org.id order by u.created_at limit 1;

    insert into public.registro_actividad (organizacion_id, empresa_id, actor_id, actor_nombre, tipo, detalle, creado_en)
    values
      (v_org.id, v_empresa, v_actor, 'Usuario de ejemplo', 'empresa.actualizada', 'Se actualizaron los datos de la empresa (campos: whatsapp, correo)', now() - interval '1 hour'),
      (v_org.id, v_empresa, v_actor, 'Usuario de ejemplo', 'empresa.pausada', 'Se pausó la empresa', now() - interval '1 day'),
      (v_org.id, v_empresa, v_actor, 'Usuario de ejemplo', 'empresa.reactivada', 'Se reactivó la empresa', now() - interval '20 hours'),
      (v_org.id, null, v_actor, 'Usuario de ejemplo', 'usuario.rol_cambiado', 'Cambió el rol de Ana Pérez: Consulta → Operador', now() - interval '2 days'),
      (v_org.id, null, v_actor, 'Usuario de ejemplo', 'invitacion.enviada', 'Invitó a nuevo@example.com con el rol Mostrador', now() - interval '3 days'),
      (v_org.id, null, v_actor, 'Usuario de ejemplo', 'permisos.matriz_guardada', 'Guardó cambios en la matriz de permisos (2 niveles, 0 acciones)', now() - interval '5 days'),
      (v_org.id, null, null, null, 'usuario.suspendido', 'Suspendió a Juan Gómez', now() - interval '9 days');
  end loop;
end $$;

-- F-CLI-08 (MSF-238): datos de ejemplo para probar el ranking de clientes y la
-- ficha (FR-002). Solo corre en local (seed.sql no se aplica a producción). Para
-- cada organización sin comprobantes crea unos clientes de ejemplo (minoristas y
-- mayoristas, números 9001+) y comprobantes de este mes y del anterior: facturas,
-- presupuestos y anuladas, y ventas del Consumidor final. Si no hay organizaciones
-- al correr el seed, no hace nada.
do $$
declare
  v_org record;
  v_inicio date := date_trunc('month', current_date)::date;
begin
  for v_org in
    select o.id from public.organizaciones o
    where not exists (select 1 from dominio.comprobantes_venta v where v.organizacion_id = o.id)
  loop
    insert into public.clientes (organizacion_id, numero, nombre, tipo) values
      (v_org.id, 9001, 'Ferretería Norte', 'mayorista'),
      (v_org.id, 9002, 'Distribuidora Sur', 'mayorista'),
      (v_org.id, 9003, 'María López', 'minorista'),
      (v_org.id, 9004, 'Taller Pérez', 'minorista'),
      (v_org.id, 9005, 'Cliente sin compras', 'minorista')
    on conflict do nothing;

    insert into dominio.comprobantes_venta
      (organizacion_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva)
    select v_org.id, c.id, d.tipo, d.numero, d.fecha, d.estado, d.sin_iva, round(d.sin_iva * 1.21, 2)
      from (values
        (9001, 'factura',     '0001-00009001', v_inicio + 2,                    'cobrada', 1250000.00),
        (9001, 'factura',     '0001-00009002', v_inicio + 9,                    'deuda',    480000.00),
        (9001, 'factura',     '0001-00009003', v_inicio - 20,                   'cobrada',  900000.00),
        (9001, 'presupuesto', '0001-00009004', v_inicio + 5,                    'emitida',  300000.00),
        (9002, 'factura',     '0001-00009005', v_inicio + 4,                    'cobrada',  760000.00),
        (9002, 'factura',     '0001-00009006', v_inicio - 12,                   'cobrada',  540000.00),
        (9002, 'factura',     '0001-00009007', v_inicio + 6,                    'anulada',  200000.00),
        (9003, 'factura',     '0001-00009008', v_inicio + 3,                    'cobrada',   85000.00),
        (9003, 'factura',     '0001-00009009', v_inicio - 25,                   'cobrada',   42000.00),
        (9004, 'factura',     '0001-00009010', v_inicio + 7,                    'emitida',  125000.00),
        (9004, 'presupuesto', '0001-00009011', v_inicio + 8,                    'emitida',   99000.00)
      ) as d(numero_cliente, tipo, numero, fecha, estado, sin_iva)
      join public.clientes c on c.organizacion_id = v_org.id and c.numero = d.numero_cliente;

    insert into dominio.comprobantes_venta
      (organizacion_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva)
    select v_org.id, c.id, 'factura', '0001-00009100', v_inicio + 1, 'cobrada', 310000.00, 375100.00
      from public.clientes c
     where c.organizacion_id = v_org.id and c.es_consumidor_final;
  end loop;
end $$;

-- MSF-241 (F-TDA-01, FR-004/FR-011): dos organizaciones con una empresa y una tienda activa cada
-- una (Mundo JC y San Javucho), con dominios de prueba. Sirven a los pgTAP y al E2E de la tienda
-- online. Solo corre en local (seed.sql no se aplica a producción); los dominios reales los
-- configura el equipo técnico (docs/tiendas-online.md). Idempotente: se puede correr de nuevo.
insert into public.organizaciones (id, nombre) values
  ('0f5eed00-0000-4000-8000-000000000001', 'Mundo JC (demo)'),
  ('0f5eed00-0000-4000-8000-000000000002', 'San Javucho (demo)')
on conflict (id) do nothing;

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('0f5eed01-0000-4000-8000-000000000001', '0f5eed00-0000-4000-8000-000000000001', 'Mundo JC'),
  ('0f5eed01-0000-4000-8000-000000000002', '0f5eed00-0000-4000-8000-000000000002', 'San Javucho')
on conflict (id) do nothing;

insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('0f5eed00-0000-4000-8000-000000000001', '0f5eed01-0000-4000-8000-000000000001', 'mundojc.localhost'),
  ('0f5eed00-0000-4000-8000-000000000002', '0f5eed01-0000-4000-8000-000000000002', 'sanjavucho.localhost')
on conflict (empresa_id) do nothing;
