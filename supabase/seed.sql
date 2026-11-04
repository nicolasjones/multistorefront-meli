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

-- F-VTA-12/13/14 (épica MSF-195, cierre · T031): datos de prueba de DEV para cobros, conciliación
-- de pagos y contrarreembolsos. Solo corre en local (seed.sql no se aplica a producción).
--
-- Qué deja en la organización de ejemplo «Mundo JC (demo)»:
-- · Una persona de ejemplo (ventas@local.test / Ventas-Local1!) como Administradora: con ella se
--   pueden ver las tres pantallas con datos (tiene `ventas` en edición y las tres acciones de la
--   épica: registrar_cobro, conciliar_pago y cobrar_contrarreembolso).
-- · Una segunda tienda («Mundo JC Centro»): el filtro Tienda de Pagos y Transportes con dos
--   opciones, como pide la épica.
-- · Formas de pago, dos cuentas de cobro (más una marcada «No usar») y dos transportes (uno que
--   cobra contrarreembolso y otro que no).
-- · Facturas con cobros parciales y totales, repartidos en dos tiendas y dos cuentas, un pago
--   conciliado y un contrarreembolso pendiente abierto con `private.abrir_contrarreembolso` (la
--   simulación de la guía de despacho de F-VTA-16/MSF-135).
--
-- Todo es idempotente (se puede volver a correr sin duplicar nada) y **inventado**: los CBU/CUIT
-- son de prueba y los valida la base (`private.cbu_valido`, `private.cuit_valido`).
do $$
declare
  v_org uuid := '0f5eed00-0000-4000-8000-000000000001';
  v_empresa_1 uuid := '0f5eed01-0000-4000-8000-000000000001';
  v_empresa_2 uuid := '0f5eed01-0000-4000-8000-000000000003';
  v_usuario uuid := '0f5eed02-0000-4000-8000-000000000001';
  v_producto uuid := '0f5eed05-0000-4000-8000-000000000001';
  v_cuenta_1 uuid := '0f5eed03-0000-4000-8000-000000000001';
  v_cuenta_2 uuid := '0f5eed03-0000-4000-8000-000000000002';
  v_cuenta_no_usar uuid := '0f5eed03-0000-4000-8000-000000000003';
  v_transporte_cobra uuid := '0f5eed04-0000-4000-8000-000000000001';
  v_transporte_no_cobra uuid := '0f5eed04-0000-4000-8000-000000000002';
  v_cliente uuid;
  v_forma uuid;
  v_deposito uuid;
  v_alicuota uuid;
  v_numero integer;
  v_comprobante uuid;
  v_cobro uuid;
  v_actualizado timestamptz;
  v_dato record;
  v_hay_msf177 boolean;
begin
  -- Sin la organización de ejemplo (MSF-241) no hay dónde sembrar.
  if not exists (select 1 from public.organizaciones where id = v_org) then
    return;
  end if;

  -- ── 1. La persona de ejemplo ─────────────────────────────────────────────────
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000', v_usuario, 'authenticated',
    'authenticated', 'ventas@local.test',
    crypt('Ventas-Local1!', gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}'::jsonb,
    '{"nombre":"Ventas","apellido":"Demo"}'::jsonb,
    '', '', '', '', now(), now()
  )
  on conflict (id) do nothing;

  insert into auth.identities (
    id, provider_id, user_id, identity_data, provider, created_at, updated_at
  ) values (
    gen_random_uuid(), v_usuario::text, v_usuario,
    jsonb_build_object('sub', v_usuario::text, 'email', 'ventas@local.test'),
    'email', now(), now()
  )
  on conflict do nothing;

  insert into public.perfiles_usuario (user_id, nombre, apellido)
  values (v_usuario, 'Ventas', 'Demo')
  on conflict (user_id) do nothing;

  -- Administradora de la organización de ejemplo: `ventas` en edición y las tres acciones de la
  -- épica. `usuarios_organizacion` tiene una sola organización por persona (user_id es la PK).
  insert into public.usuarios_organizacion (user_id, organizacion_id, rol_id, estado)
  values (v_usuario, v_org, 'administrador', 'activo')
  on conflict (user_id) do nothing;

  -- ── 2. La segunda tienda y el cliente ────────────────────────────────────────
  insert into dominio.empresas (id, organizacion_id, nombre)
  values (v_empresa_2, v_org, 'Mundo JC Centro')
  on conflict (id) do nothing;

  insert into public.clientes (organizacion_id, numero, nombre, tipo)
  values (v_org, 9100, 'Distribuidora del Centro (DEV)', 'mayorista')
  on conflict (organizacion_id, numero) do nothing;

  select c.id into v_cliente
    from public.clientes c
   where c.organizacion_id = v_org and c.numero = 9100;

  -- Sin cliente no hay facturas: se sale (no se siembra a medias).
  if v_cliente is null then
    return;
  end if;

  insert into public.clientes_empresas (cliente_id, empresa_id, organizacion_id)
  select v_cliente, e.empresa_id, v_org
    from (values (v_empresa_1), (v_empresa_2)) as e(empresa_id)
  on conflict do nothing;

  -- ── 3. Catálogos: formas de pago, cuentas de cobro y transportes ─────────────
  insert into dominio.formas_pago (
    organizacion_id, empresa_id, nombre, tipo, exige_cuenta_cobro, genera_deuda, orden
  )
  select v_org, d.empresa_id, d.nombre, d.tipo, d.exige_cuenta, d.deuda, d.orden
    from (values
      (v_empresa_1, 'Efectivo',               'efectivo',         false, false, 1),
      (v_empresa_1, 'Transferencia bancaria', 'transferencia',    true,  false, 2),
      (v_empresa_1, 'Contrarreembolso',       'contrarreembolso', false, true,  3),
      (v_empresa_2, 'Efectivo',               'efectivo',         false, false, 1),
      (v_empresa_2, 'Transferencia bancaria', 'transferencia',    true,  false, 2),
      (v_empresa_2, 'Contrarreembolso',       'contrarreembolso', false, true,  3)
    ) as d(empresa_id, nombre, tipo, exige_cuenta, deuda, orden)
  on conflict do nothing;

  insert into dominio.cuentas_cobro (
    id, organizacion_id, nombre, titular, cuit, banco, cbu, tipo, moneda, orden, activa, notas
  ) values
    -- Los CBU son los dos vectores sintéticos válidos del pgTAP (eximidos en .gitleaks.toml);
    -- la base valida el dígito verificador de los dos bloques al insertar.
    (v_cuenta_1, v_org, 'Banco de Galicia · Cuenta corriente', 'Mundo JC (demo)', '20304050609',
     'Banco de Galicia', '0170099220000067797370', 'cuenta_corriente', 'ARS', 1, true,
     'Cuenta de prueba (DEV): recibe transferencias.'),
    (v_cuenta_2, v_org, 'Banco Macro · Caja de ahorro', 'Mundo JC (demo)', '30714236896',
     'Banco Macro', '2850590940090418135201', 'caja_ahorro', 'ARS', 2, true,
     'Cuenta de prueba (DEV): recibe depósitos.'),
    -- «No usar» no lleva CBU: es una cuenta vieja, sin datos bancarios que mostrar.
    (v_cuenta_no_usar, v_org, 'Banco de Galicia · Cuenta antigua', 'Mundo JC (demo)', '20304050609',
     'Banco de Galicia', null, 'cuenta_corriente', 'ARS', 3, false,
     'Marcada «No usar» (DEV): conserva su historial y no recibe cobros nuevos.')
  on conflict (id) do nothing;

  insert into dominio.cuentas_cobro_empresas (cuenta_id, empresa_id, organizacion_id)
  select c.id, e.empresa_id, v_org
    from dominio.cuentas_cobro c
    cross join (values (v_empresa_1), (v_empresa_2)) as e(empresa_id)
   where c.organizacion_id = v_org
     and c.id in (v_cuenta_1, v_cuenta_2, v_cuenta_no_usar)
  on conflict do nothing;

  insert into dominio.transportes (
    id, organizacion_id, nombre, tipo, comision_pct, plazo_rendicion_dias, cobra_contrarreembolso, orden
  ) values
    (v_transporte_cobra, v_org, 'Transporte Rápido del Sur (DEV)', 'expreso', 5.00, 15, true, 1),
    (v_transporte_no_cobra, v_org, 'Correo Interno (DEV)', 'correo', 0.00, 0, false, 2)
  on conflict (id) do nothing;

  insert into dominio.transportes_empresas (transporte_id, empresa_id, organizacion_id)
  select t.id, e.empresa_id, v_org
    from dominio.transportes t
    cross join (values (v_empresa_1), (v_empresa_2)) as e(empresa_id)
   where t.organizacion_id = v_org
     and t.id in (v_transporte_cobra, v_transporte_no_cobra)
  on conflict do nothing;

  -- Un producto y una línea por factura: el detalle del comprobante se ve como una factura de
  -- verdad (con su ítem), no como una cabecera vacía.
  insert into dominio.productos (id, organizacion_id, nombre, sku, descripcion, moneda, precio_lista)
  values (
    v_producto, v_org, 'Herramienta de ejemplo (DEV)', 'DEV-0001',
    'Producto de prueba para los datos de desarrollo de Ventas.', 'ARS', 1000.00
  )
  on conflict (id) do nothing;

  -- El producto de ejemplo arranca CON stock. Al crearlo, el trigger `productos_crear_existencias`
  -- deja `dominio.existencias` en 0, y con 0 (`cantidad - reservado <= 0`) el estado es «sin_stock»:
  -- la organización de ejemplo entraba en el barrido de alertas de reposición de Stock (MSF-394,
  -- `public.organizaciones_con_resumen_pendiente`), que devuelve las organizaciones con productos
  -- en alerta. Eso rompía el pgTAP de MSF-394 en el CI y, además, disparaba avisos de reposición
  -- para datos inventados.
  --
  -- El stock va por el depósito por defecto y el total se deja como la suma por depósito (la
  -- invariante que comprueban los pgTAP de Stock: `dominio.existencias.cantidad` =
  -- `sum(dominio.existencias_deposito.cantidad)`). Con stock, el producto queda «disponible» y el
  -- barrido de MSF-394 no ve a la organización de ejemplo.
  select d.id into v_deposito
    from dominio.depositos d
   where d.organizacion_id = v_org and d.por_defecto
   order by d.creado_en
   limit 1;

  if v_deposito is not null then
    insert into dominio.existencias_deposito (producto_id, deposito_id, organizacion_id, cantidad)
    values (v_producto, v_deposito, v_org, 10)
    on conflict (producto_id, deposito_id) do update
      set cantidad = excluded.cantidad, updated_at = now();

    update dominio.existencias e
       set cantidad = x.total
      from (
        select coalesce(sum(d.cantidad), 0)::int as total
          from dominio.existencias_deposito d
         where d.producto_id = v_producto
      ) x
     where e.producto_id = v_producto
       and e.organizacion_id = v_org
       and e.cantidad <> x.total;
  end if;

  select a.id into v_alicuota
    from dominio.alicuotas_iva a
   where a.organizacion_id = v_org and a.porcentaje = 21
   limit 1;

  -- ── 4. La sesión de la persona de ejemplo ─────────────────────────────────────
  -- A partir de acá, las funciones internas toman la organización y el actor de la sesión.
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_usuario::text, 'role', 'authenticated')::text,
    true);

  -- ── 5. Las facturas de ejemplo y sus cobros ───────────────────────────────────
  -- Idempotente: si ya hay facturas del cliente de DEV, no se vuelven a crear.
  if not exists (
    select 1 from dominio.comprobantes_venta c
     where c.organizacion_id = v_org and c.cliente_id = v_cliente
  ) then
    for v_dato in
      select * from (values
        (v_empresa_1, 'Transferencia bancaria', 100000.00::numeric, 40000.00::numeric, v_cuenta_1::uuid, false, null::text),
        (v_empresa_1, 'Transferencia bancaria',  50000.00::numeric, 50000.00::numeric, v_cuenta_1::uuid, true,  null::text),
        (v_empresa_1, 'Transferencia bancaria',  80000.00::numeric, 30000.00::numeric, v_cuenta_2::uuid, false, null::text),
        (v_empresa_1, 'Efectivo',                45000.00::numeric, 45000.00::numeric, null::uuid,     false, null::text),
        (v_empresa_2, 'Transferencia bancaria',  60000.00::numeric, 20000.00::numeric, v_cuenta_1::uuid, false, null::text),
        (v_empresa_1, 'Transferencia bancaria',  70000.00::numeric, null::numeric,     null::uuid,     false, 'GUIA-DEV-0001')
      ) as d(empresa_id, forma_nombre, total, importe, cuenta_id, conciliar, guia)
    loop
      select f.id into v_forma
        from dominio.formas_pago f
       where f.empresa_id = v_dato.empresa_id and lower(f.nombre) = lower(v_dato.forma_nombre);

      -- Sin forma de pago no hay cobro: se saltea la factura en vez de dejarla a medias.
      if v_forma is null then
        continue;
      end if;

      v_numero := private.siguiente_numero_comprobante(v_dato.empresa_id, 'factura');

      insert into dominio.comprobantes_venta (
        organizacion_id, empresa_id, cliente_id, tipo, numero, numero_entero, fecha, estado,
        total_sin_iva, total_con_iva, forma_pago_id, canal, confirmado_en, confirmado_por
      ) values (
        v_org, v_dato.empresa_id, v_cliente, 'factura', lpad(v_numero::text, 8, '0'), v_numero,
        current_date - 5, 'confirmada', round(v_dato.total / 1.21, 2), v_dato.total, v_forma,
        'mostrador', now(), v_usuario
      )
      returning id into v_comprobante;

      -- La línea del comprobante (el detalle se ve como una factura de verdad). Sin depósito
      -- por defecto la factura queda sin ítems: mejor eso que un seed que corta.
      if v_deposito is not null then
        insert into dominio.comprobantes_venta_lineas (
          organizacion_id, comprobante_id, orden, producto_id, descripcion, codigo, cantidad,
          precio_unitario, escala, alicuota_id, alicuota_porcentaje, deposito_id,
          subtotal_sin_iva, iva
        ) values (
          v_org, v_comprobante, 1, v_producto, 'Herramienta de ejemplo (DEV)', 'DEV-0001',
          1, round(v_dato.total / 1.21, 2), 'x1', v_alicuota, 21, v_deposito,
          round(v_dato.total / 1.21, 2), round(v_dato.total - v_dato.total / 1.21, 2)
        );
      end if;

      -- El cobro del libro (F-VTA-12). `private.registrar_cobro_interno` es el único camino a
      -- Cobrado/Deuda: llama a `private.marcar_estado_cobro_comprobante` (MSF-177), que todavía
      -- no está mergeada. Un cobro PARCIAL no la llama (el estado no cambia) y va por la vía
      -- normal; un cobro TOTAL sí la llama, así que sin MSF-177 se guarda por la vía directa y
      -- la factura queda con saldo 0 (el estado «Cobrado» lo aplica MSF-177 cuando entre).
      if v_dato.importe is not null then
        v_hay_msf177 := exists (
          select 1 from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'private' and p.proname = 'marcar_estado_cobro_comprobante');

        if v_hay_msf177 or v_dato.importe < v_dato.total then
          v_cobro := private.registrar_cobro_interno(
            v_comprobante, v_dato.importe, v_forma, v_dato.cuenta_id, 'manual', v_usuario);
        else
          insert into dominio.cobros_comprobante (
            organizacion_id, empresa_id, comprobante_id, importe, forma_pago_id, cuenta_cobro_id,
            origen, registrado_por, registrado_por_nombre
          ) values (
            v_org, v_dato.empresa_id, v_comprobante, v_dato.importe, v_forma, v_dato.cuenta_id,
            'manual', v_usuario, 'Ventas Demo'
          )
          returning id into v_cobro;

          perform private.insertar_actividad(
            v_org, v_usuario, 'comprobante.cobro_registrado',
            format('Cobro de %s por %s en la factura %s (DEV)',
              v_dato.importe, v_dato.forma_nombre, lpad(v_numero::text, 8, '0')),
            v_dato.empresa_id);
        end if;

        -- Un pago conciliado (F-VTA-13): así la pantalla Pagos muestra las dos tarjetas.
        if v_dato.conciliar then
          select b.actualizado_en into v_actualizado
            from dominio.cobros_comprobante b
           where b.id = v_cobro;

          perform public.conciliar_pago(v_cobro, v_actualizado);
        end if;
      end if;

      -- El contrarreembolso pendiente (F-VTA-14): la simulación de la guía de despacho.
      if v_dato.guia is not null then
        perform private.abrir_contrarreembolso(v_comprobante, v_transporte_cobra, v_dato.guia);
      end if;
    end loop;
  end if;
end;
$$;
