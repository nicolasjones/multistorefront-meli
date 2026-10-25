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
