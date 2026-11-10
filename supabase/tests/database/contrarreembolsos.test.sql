-- F-VTA-14 (MSF-410, épica MSF-195, spec 20261024-150000-ventas-cobros-y-conciliacion,
-- FR-040, FR-041, FR-042, FR-043, FR-044, FR-045): contrarreembolsos por transporte.
--
-- Cubre: la tabla en `dominio` con RLS y sin escritura directa; la apertura del contrarreembolso
-- (solo con un transporte que cobra, idempotente por (comprobante, guía), importe = saldo y
-- evento `contrarreembolso.abierto`); el «Marcar cobrado» (permiso por rol, idempotencia, bloqueo
-- optimista, cobro asociado con origen `contrarreembolso`, comprobante anulado y evento
-- `contrarreembolso.cobrado`); y la lectura (listado con filtro de tienda y de estado, paginación,
-- totales y aislamiento entre organizaciones).
--
-- `rls_en_toda_tabla` (archivo aparte) recorre `public` y `dominio` y cubre la tabla nueva sin
-- tocarla; acá se afirma además que la tabla de contrarreembolsos tiene RLS y ninguna política de
-- escritura.
--
-- El paso a Cobrado de la factura lo hace `private.marcar_estado_cobro_comprobante`, que llega con
-- la épica MSF-177 (PR #343) y todavía NO está en esta rama. Mientras no esté, el archivo crea un
-- DOBLE DE PRUEBA de esa función (dentro de la transacción de la prueba, que se revierte al final)
-- solo si la real no existe, para poder ejercitar el camino feliz. Cuando MSF-177 esté mergeada,
-- el doble no se crea y corre la función real, con la misma matriz de transiciones que siembra el
-- trigger de organizaciones.
--
-- El fixture corre como postgres (RLS no aplica) y las verificaciones como «authenticated» vía
-- request.jwt.claims, igual que PostgREST.
begin;

select no_plan();

-- ============================================================================
-- Fixture
-- ============================================================================

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'administracion-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'mostrador-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000005', 'consulta-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'administracion', 'activo'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'mostrador', 'activo'),
  ('d1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('a2000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

-- Administración y Mostrador trabajan en San Javucho; Consulta, en Mundo JC. El Administrador de
-- la organización llega a todas sus empresas por el rol.
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'administracion'),
  ('d1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'mostrador'),
  ('d1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'consulta');

insert into clientes (id, organizacion_id, numero, nombre, tipo) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Cliente Uno', 'minorista'),
  ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 20, 'Cliente Dos', 'minorista');

-- Formas de pago: efectivo, transferencia y «Contrarreembolso» (la forma con la que el
-- transporte cobra al entregar).
insert into dominio.formas_pago (id, organizacion_id, empresa_id, nombre, tipo, exige_cuenta_cobro, genera_deuda, activo) values
  ('b1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'Efectivo', 'efectivo', false, false, true),
  ('b1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'Transferencia', 'transferencia', true, false, true),
  ('b1000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'Contrarreembolso', 'contrarreembolso', false, false, true),
  ('b2000000-0000-0000-0000-00000000000e', '22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-00000000000c', 'Efectivo', 'efectivo', false, false, true);

-- Transportes: uno cobra contrarreembolso y otro no; el tercero es de la otra organización.
-- Los id de este archivo usan prefijos HEXADECIMALES (a empresas, b formas de pago, c clientes,
-- d usuarios, e transportes, f comprobantes): Postgres rechaza como uuid inválido cualquier
-- prefijo con letras fuera del 0-9a-f (por eso los transportes no usan «t»).
insert into dominio.transportes (id, organizacion_id, nombre, tipo, cobra_contrarreembolso) values
  ('e1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Expreso Uno', 'expreso', true),
  ('e1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Correo Dos', 'correo', false),
  ('e2000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222', 'Expreso Tres', 'expreso', true);

-- Comprobantes: F1 y F2 son facturas de San Javucho (F1 con forma «Contrarreembolso», F2 sin
-- forma: el cobro usa la forma «Contrarreembolso» de la tienda); F3 se anula después de abrir su
-- contrarreembolso (el borde de la spec); F4 es de la otra organización.
insert into dominio.comprobantes_venta
  (id, organizacion_id, empresa_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva, confirmado_en, forma_pago_id) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000001', '2026-12-01', 'confirmada', 1000, 1000, now(), 'b1000000-0000-0000-0000-00000000000c'),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000002', '2026-12-01', 'confirmada', 500, 500, now(), null),
  ('f1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000003', '2026-12-01', 'confirmada', 1000, 1000, now(), 'b1000000-0000-0000-0000-00000000000c'),
  ('f2000000-0000-0000-0000-000000000007', '22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-00000000000c', 'c2000000-0000-0000-0000-000000000001', 'factura', '0001-00000007', '2026-12-01', 'confirmada', 700, 700, now(), 'b2000000-0000-0000-0000-00000000000e');

-- Verifica como «authenticated» (RLS y permisos), igual que PostgREST.
create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Verifica como «authenticated» SIN cambiar de rol: las funciones internas de `private` no las
-- ejecuta `authenticated`, pero el actor (`auth.uid()`) sí tiene que ser la persona de la sesión.
create function pg_temp.como_sistema(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;

-- ¿Está mergeada la función de MSF-177 que pasa la factura a Cobrado?
create function pg_temp.hay_estado_cobro() returns boolean language sql as $$
  select exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private' and p.proname = 'marcar_estado_cobro_comprobante'
  )
$$;

-- Doble de prueba de MSF-177 (solo si la real no existe; la transacción de la prueba se
-- revierte al final, así que no deja nada). Permite ejercitar el camino feliz del «Marcar
-- cobrado» mientras MSF-177 no esté mergeada en esta rama.
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private' and p.proname = 'marcar_estado_cobro_comprobante'
  ) then
    execute $ddl$
      create function private.marcar_estado_cobro_comprobante(p_id uuid, p_estado text)
      returns void
      language plpgsql
      security definer
      set search_path = ''
      as $fn$
      begin
        update dominio.comprobantes_venta
           set estado = p_estado, updated_at = clock_timestamp()
         where id = p_id;
      end
      $fn$;
    $ddl$;
  end if;
end $$;

-- ============================================================================
-- Esquema y RLS (FR-040)
-- ============================================================================

select ok(
  exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'dominio' and c.relname = 'contrarreembolsos' and c.relrowsecurity),
  'contrarreembolsos vive en «dominio» y tiene RLS activada'
);
select ok(
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and c.relname = 'contrarreembolsos'),
  'no existe una copia en «public»'
);
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'dominio' and tablename = 'contrarreembolsos' and cmd <> 'SELECT'),
  0, 'la tabla no tiene políticas de escritura (solo lectura)'
);

-- Sin escritura directa ni borrado: el libro de dinero se escribe por las funciones.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$insert into dominio.contrarreembolsos
      (organizacion_id, empresa_id, comprobante_id, transporte_id, guia, importe)
    values ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a',
            'f1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', 'G-0001', 1000)$$,
  '42501', null, 'nadie inserta contrarreembolsos por escrito: solo la función interna'
);
select throws_ok(
  $$update dominio.contrarreembolsos set importe = 1
     where comprobante_id = 'f1000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'nadie edita un contrarreembolso por escrito'
);
select throws_ok(
  $$delete from dominio.contrarreembolsos$$,
  '42501', null, 'no existe el borrado de un contrarreembolso'
);
reset role;

select ok(
  not has_table_privilege('anon', 'dominio.contrarreembolsos', 'select')
  and not has_table_privilege('anon', 'dominio.contrarreembolsos', 'insert')
  and not has_table_privilege('authenticated', 'dominio.contrarreembolsos', 'insert')
  and not has_table_privilege('authenticated', 'dominio.contrarreembolsos', 'update')
  and not has_table_privilege('authenticated', 'dominio.contrarreembolsos', 'delete'),
  'anon sin privilegios y authenticated solo lectura'
);

-- Las funciones internas no las ejecuta nadie desde la API.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'abrir_contrarreembolso'
      and (has_function_privilege('anon', p.oid, 'execute')
        or has_function_privilege('authenticated', p.oid, 'execute')
        or has_function_privilege('service_role', p.oid, 'execute'))),
  0, 'la función interna de contrarreembolsos no la ejecuta ni anon ni authenticated ni service_role'
);
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'puede_cobrar_contrarreembolso_en_empresa'
      and (has_function_privilege('anon', p.oid, 'execute')
        or has_function_privilege('authenticated', p.oid, 'execute')
        or has_function_privilege('service_role', p.oid, 'execute'))),
  0, 'el permiso interno de contrarreembolsos no lo ejecuta ni anon ni authenticated ni service_role'
);

-- Y en la práctica, tampoco se pueden ejecutar: la función interna no está al alcance de la API.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select private.abrir_contrarreembolso(
      'f1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', 'G-PRIV')$$,
  '42501', null, 'authenticated no puede abrir contrarreembolsos: la función es interna'
);
reset role;

select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;
select throws_ok(
  $$select private.abrir_contrarreembolso(
      'f1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', 'G-PRIV')$$,
  '42501', null, 'anon no puede abrir contrarreembolsos: la función es interna'
);
reset role;

-- `anon` no ejecuta las RPC de contrarreembolsos; `authenticated` sí.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('listar_contrarreembolsos', 'resumen_contrarreembolsos',
                        'marcar_contrarreembolso_cobrado', 'puede_cobrar_contrarreembolso')
      and has_function_privilege('anon', p.oid, 'execute')),
  0, 'anon no ejecuta las RPC de contrarreembolsos'
);
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('listar_contrarreembolsos', 'resumen_contrarreembolsos',
                        'marcar_contrarreembolso_cobrado', 'puede_cobrar_contrarreembolso')
      and has_function_privilege('authenticated', p.oid, 'execute')),
  4, 'authenticated ejecuta las RPC de contrarreembolsos'
);

-- ============================================================================
-- La acción `cobrar_contrarreembolso` (FR-041)
-- ============================================================================

select is(
  (select coalesce(array_agg(rol_id order by rol_id), array[]::text[])
     from public.permisos_rol_accion
    where organizacion_id = '11111111-1111-1111-1111-111111111111'
      and seccion = 'ventas' and accion = 'cobrar_contrarreembolso' and permitido),
  array['administracion', 'administrador']::text[],
  'la acción cobrar_contrarreembolso está sembrada solo para Administración y Administrador'
);
select is(
  (select count(*)::int from public.permisos_rol_accion
    where organizacion_id = '11111111-1111-1111-1111-111111111111'
      and seccion = 'ventas' and accion = 'cobrar_contrarreembolso'),
  8, 'la acción existe para los ocho roles de la sección ventas (con permiso o sin permiso)'
);

-- ============================================================================
-- Apertura del contrarreembolso (FR-040)
-- ============================================================================

-- Un transporte que NO cobra contrarreembolso no genera nada.
select pg_temp.como_sistema('d1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select private.abrir_contrarreembolso(
      'f1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000b', 'G-0001')$$,
  '22023', null, 'un transporte que no cobra contrarreembolso no abre nada'
);

-- Un transporte de otra organización tampoco.
select throws_ok(
  $$select private.abrir_contrarreembolso(
      'f1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-00000000000c', 'G-0001')$$,
  'P0002', null, 'un transporte de otra organización no abre nada'
);

-- Un comprobante que no existe tampoco.
select throws_ok(
  $$select private.abrir_contrarreembolso(
      'f1000000-0000-0000-0000-000000000099', 'e1000000-0000-0000-0000-00000000000a', 'G-0001')$$,
  'P0002', null, 'un comprobante inexistente no abre nada'
);

-- La guía es obligatoria.
select throws_ok(
  $$select private.abrir_contrarreembolso(
      'f1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', '  ')$$,
  '22023', null, 'una guía vacía se rechaza'
);

-- El alta normal: el importe es el saldo del comprobante (FR-040).
select lives_ok(
  $$select private.abrir_contrarreembolso(
      'f1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', 'G-0001')$$,
  'el contrarreembolso de una guía con transporte que cobra se abre'
);
reset role;

select is(
  (select count(*)::int from dominio.contrarreembolsos
    where comprobante_id = 'f1000000-0000-0000-0000-000000000001'),
  1, 'la apertura deja un solo contrarreembolso'
);
select is(
  (select importe from dominio.contrarreembolsos
    where comprobante_id = 'f1000000-0000-0000-0000-000000000001'),
  1000.00::numeric, 'el importe del contrarreembolso es el saldo del comprobante'
);
select is(
  (select estado from dominio.contrarreembolsos
    where comprobante_id = 'f1000000-0000-0000-0000-000000000001'),
  'pendiente', 'el contrarreembolso arranca en Pendiente'
);
select is(
  (select guia from dominio.contrarreembolsos
    where comprobante_id = 'f1000000-0000-0000-0000-000000000001'),
  'G-0001', 'el contrarreembolso guarda la guía'
);
select is(
  (select empresa_id from dominio.contrarreembolsos
    where comprobante_id = 'f1000000-0000-0000-0000-000000000001'),
  'a1000000-0000-0000-0000-00000000000a'::uuid, 'el contrarreembolso es de la tienda del comprobante'
);

-- Idempotencia por (comprobante, guía): la misma guía no abre dos contrarreembolsos.
select pg_temp.como_sistema('d1000000-0000-0000-0000-000000000001');
select is(
  (select private.abrir_contrarreembolso(
      'f1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', 'G-0001')
     = (select id from dominio.contrarreembolsos
         where comprobante_id = 'f1000000-0000-0000-0000-000000000001')),
  true, 'abrir dos veces la misma guía devuelve el mismo contrarreembolso'
);
reset role;

select is(
  (select count(*)::int from dominio.contrarreembolsos
    where comprobante_id = 'f1000000-0000-0000-0000-000000000001'),
  1, 'la misma guía no duplica el contrarreembolso'
);
select is(
  (select count(*)::int from public.registro_actividad
    where tipo = 'contrarreembolso.abierto'
      and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  1, 'la segunda apertura no deja un evento nuevo'
);

-- El evento de apertura (FR-040): actor, tienda y guía.
select is(
  (select actor_id from public.registro_actividad
    where tipo = 'contrarreembolso.abierto'
      and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  'd1000000-0000-0000-0000-000000000001'::uuid, 'el evento guarda quién abrió el contrarreembolso'
);
select is(
  (select empresa_id from public.registro_actividad
    where tipo = 'contrarreembolso.abierto'
      and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  'a1000000-0000-0000-0000-00000000000a'::uuid, 'el evento guarda la tienda del contrarreembolso'
);
select ok(
  (select detalle like '%G-0001%' and detalle like '%Expreso Uno%'
     from public.registro_actividad
    where tipo = 'contrarreembolso.abierto'
      and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  'el evento nombra la guía y el transporte'
);

-- Aislamiento: otra organización no abre un contrarreembolso de una factura ajena.
select pg_temp.como_sistema('d2000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select private.abrir_contrarreembolso(
      'f1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', 'G-9999')$$,
  '42501', null, 'otra organización no abre contrarreembolsos de una factura ajena'
);
reset role;

-- Un segundo contrarreembolso (de otra factura, para el listado y el resumen).
select pg_temp.como_sistema('d1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select private.abrir_contrarreembolso(
      'f1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-00000000000a', 'G-0002')$$,
  'se abre un segundo contrarreembolso de otra factura'
);
reset role;

select is(
  (select importe from dominio.contrarreembolsos
    where comprobante_id = 'f1000000-0000-0000-0000-000000000002'),
  500.00::numeric, 'el segundo contrarreembolso toma el saldo de su comprobante'
);

-- Un tercer contrarreembolso, de una factura que después se anula (FR-044).
select pg_temp.como_sistema('d1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select private.abrir_contrarreembolso(
      'f1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-00000000000a', 'G-0004')$$,
  'se abre un contrarreembolso de una factura que después se anula'
);
reset role;

-- Un contrarreembolso de la otra organización (para el aislamiento de la lectura).
insert into dominio.contrarreembolsos
  (organizacion_id, empresa_id, comprobante_id, transporte_id, guia, importe)
values
  ('22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-00000000000c',
   'f2000000-0000-0000-0000-000000000007', 'e2000000-0000-0000-0000-00000000000c', 'G-0003', 700);

-- ============================================================================
-- Marcar el contrarreembolso como cobrado (FR-041, FR-042, FR-043, FR-044)
-- ============================================================================

-- Sin la acción, la RPC rechaza (FR-041): el Mostrador tiene Ventas en edición pero no la
-- acción `cobrar_contrarreembolso`.
select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select throws_ok(
  $$select public.marcar_contrarreembolso_cobrado(
      (select id from dominio.contrarreembolsos
        where comprobante_id = 'f1000000-0000-0000-0000-000000000001'),
      (select actualizado_en from dominio.contrarreembolsos
        where comprobante_id = 'f1000000-0000-0000-0000-000000000001'))$$,
  '42501', null, 'un rol sin la acción no puede cobrar un contrarreembolso'
);
reset role;

-- El bloqueo optimista: la versión que se leyó en pantalla tiene que ser la (FR-042).
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select public.marcar_contrarreembolso_cobrado(
      (select id from dominio.contrarreembolsos
        where comprobante_id = 'f1000000-0000-0000-0000-000000000001'),
      '2020-01-01 00:00:00+00'::timestamptz)$$,
  '40001', null, 'una versión vieja se rechaza: otra persona lo modificó'
);
reset role;

-- Un comprobante anulado no se cobra (FR-044): el contrarreembolso queda visible y pendiente.
update dominio.comprobantes_venta
   set estado = 'anulada'
 where id = 'f1000000-0000-0000-0000-000000000003';

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select public.marcar_contrarreembolso_cobrado(
      (select id from dominio.contrarreembolsos
        where comprobante_id = 'f1000000-0000-0000-0000-000000000003'),
      (select actualizado_en from dominio.contrarreembolsos
        where comprobante_id = 'f1000000-0000-0000-0000-000000000003'))$$,
  '55000', null, 'un contrarreembolso de una factura anulada no se cobra'
);
reset role;

select is(
  (select estado from dominio.contrarreembolsos
    where comprobante_id = 'f1000000-0000-0000-0000-000000000003'),
  'pendiente', 'el contrarreembolso de la factura anulada sigue pendiente'
);

-- El camino feliz (FR-042, FR-043): Administración cobra el contrarreembolso.
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select lives_ok(
  $$select public.marcar_contrarreembolso_cobrado(
      (select id from dominio.contrarreembolsos
        where comprobante_id = 'f1000000-0000-0000-0000-000000000001'),
      (select actualizado_en from dominio.contrarreembolsos
        where comprobante_id = 'f1000000-0000-0000-0000-000000000001'))$$,
  'Administración marca el contrarreembolso como cobrado'
);
reset role;

select is(
  (select estado from dominio.contrarreembolsos
    where comprobante_id = 'f1000000-0000-0000-0000-000000000001'),
  'cobrado', 'el contrarreembolso pasa a Cobrado'
);
select is(
  (select cobrado_por from dominio.contrarreembolsos
    where comprobante_id = 'f1000000-0000-0000-0000-000000000001'),
  'd1000000-0000-0000-0000-000000000002'::uuid, 'el contrarreembolso guarda quién lo cobró'
);
select is(
  (select cobrado_por_nombre from dominio.contrarreembolsos
    where comprobante_id = 'f1000000-0000-0000-0000-000000000001'),
  'administracion-uno@example.com', 'el contrarreembolso guarda el nombre de quien lo cobró'
);
select ok(
  (select cobrado_en is not null from dominio.contrarreembolsos
    where comprobante_id = 'f1000000-0000-0000-0000-000000000001'),
  'el contrarreembolso guarda cuándo se cobró'
);
select ok(
  (select cobro_id is not null from dominio.contrarreembolsos
    where comprobante_id = 'f1000000-0000-0000-0000-000000000001'),
  'el contrarreembolso queda asociado al cobro del libro'
);

-- El cobro del libro: origen `contrarreembolso` y el importe del contrarreembolso (FR-042).
select is(
  (select count(*)::int from dominio.cobros_comprobante
    where comprobante_id = 'f1000000-0000-0000-0000-000000000001'),
  1, 'el comprobante tiene un solo cobro'
);
select is(
  (select origen from dominio.cobros_comprobante
    where comprobante_id = 'f1000000-0000-0000-0000-000000000001'),
  'contrarreembolso', 'el cobro del libro tiene origen contrarreembolso'
);
select is(
  (select importe from dominio.cobros_comprobante
    where comprobante_id = 'f1000000-0000-0000-0000-000000000001'),
  1000.00::numeric, 'el cobro del libro tiene el importe del contrarreembolso'
);
select is(
  (select id from dominio.cobros_comprobante
    where comprobante_id = 'f1000000-0000-0000-0000-000000000001'),
  (select cobro_id from dominio.contrarreembolsos
    where comprobante_id = 'f1000000-0000-0000-0000-000000000001'),
  'el contrarreembolso apunta al cobro que registró'
);

-- La factura queda Cobrada por la función `private` de MSF-177 (FR-004 de F-VTA-12), nunca a mano.
select is(
  (select estado from dominio.comprobantes_venta where id = 'f1000000-0000-0000-0000-000000000001'),
  'cobrado', 'la factura pasa a Cobrado (por la función private de MSF-177, no a mano)'
);

-- Idempotencia (FR-042): un doble clic no cobra dos veces.
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select lives_ok(
  $$select public.marcar_contrarreembolso_cobrado(
      (select id from dominio.contrarreembolsos
        where comprobante_id = 'f1000000-0000-0000-0000-000000000001'),
      (select actualizado_en from dominio.contrarreembolsos
        where comprobante_id = 'f1000000-0000-0000-0000-000000000001'))$$,
  'volver a marcar el mismo contrarreembolso no falla (es idempotente)'
);
reset role;

select is(
  (select count(*)::int from dominio.cobros_comprobante
    where comprobante_id = 'f1000000-0000-0000-0000-000000000001'),
  1, 'el doble clic no deja un segundo cobro'
);
select is(
  (select count(*)::int from public.registro_actividad
    where tipo = 'contrarreembolso.cobrado'
      and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  1, 'el doble clic no deja un segundo evento'
);

-- El evento del cobro (FR-043): actor, tienda y guía.
select is(
  (select actor_id from public.registro_actividad
    where tipo = 'contrarreembolso.cobrado'
      and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  'd1000000-0000-0000-0000-000000000002'::uuid, 'el evento guarda quién cobró el contrarreembolso'
);
select is(
  (select empresa_id from public.registro_actividad
    where tipo = 'contrarreembolso.cobrado'
      and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  'a1000000-0000-0000-0000-00000000000a'::uuid, 'el evento guarda la tienda del contrarreembolso'
);
select ok(
  (select detalle like '%G-0001%'
     from public.registro_actividad
    where tipo = 'contrarreembolso.cobrado'
      and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  'el evento nombra la guía'
);
select ok(
  not exists (
    select 1 from public.registro_actividad
     where tipo in ('contrarreembolso.abierto', 'contrarreembolso.cobrado')
       and organizacion_id = '11111111-1111-1111-1111-111111111111'
       and (detalle ~ '[0-9]{11}' or detalle like '%CBU%' or detalle like '%CUIT%')
  ),
  'los eventos no llevan datos bancarios completos'
);

-- El segundo contrarreembolso, de una factura sin forma de pago: la RPC usa la forma
-- «Contrarreembolso» de la tienda.
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select lives_ok(
  $$select public.marcar_contrarreembolso_cobrado(
      (select id from dominio.contrarreembolsos
        where comprobante_id = 'f1000000-0000-0000-0000-000000000002'),
      (select actualizado_en from dominio.contrarreembolsos
        where comprobante_id = 'f1000000-0000-0000-0000-000000000002'))$$,
  'se cobra un contrarreembolso de una factura sin forma de pago'
);
-- El libro de cobros no tiene columna `estado`: el estado del comprobante lo lleva la factura.
select is(
  (select estado from dominio.comprobantes_venta
    where id = 'f1000000-0000-0000-0000-000000000002'),
  'cobrado', 'la factura del segundo contrarreembolso también queda Cobrada'
);
select is(
  (select forma_pago from public.cobros_de_comprobante('f1000000-0000-0000-0000-000000000002')),
  'Contrarreembolso', 'el cobro usa la forma «Contrarreembolso» de la tienda'
);
reset role;

-- Otra organización no cobra un contrarreembolso ajeno.
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.marcar_contrarreembolso_cobrado(
      (select id from dominio.contrarreembolsos
        where comprobante_id = 'f1000000-0000-0000-0000-000000000001'),
      (select actualizado_en from dominio.contrarreembolsos
        where comprobante_id = 'f1000000-0000-0000-0000-000000000001'))$$,
  'P0002', null, 'otra organización no cobra un contrarreembolso ajeno'
);
reset role;

-- ============================================================================
-- Lectura: listado y totales (FR-045)
-- ============================================================================

-- El listado del Administrador: los tres contrarreembolsos de su organización.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.listar_contrarreembolsos(null, null, 1, 10)),
  3, 'el listado devuelve los tres contrarreembolsos de la organización'
);
select is(
  (select filas from public.listar_contrarreembolsos(null, null, 1, 10) limit 1),
  3::bigint, '«filas» trae el total de contrarreembolsos del filtro'
);
select is(
  (select guia from public.listar_contrarreembolsos(null, null, 1, 10)
    where id = (select id from dominio.contrarreembolsos
                 where comprobante_id = 'f1000000-0000-0000-0000-000000000001')),
  'G-0001', 'el listado trae la guía'
);
select is(
  (select empresa from public.listar_contrarreembolsos(null, null, 1, 10)
    where id = (select id from dominio.contrarreembolsos
                 where comprobante_id = 'f1000000-0000-0000-0000-000000000001')),
  'San Javucho', 'el listado trae la tienda'
);
select is(
  (select numero from public.listar_contrarreembolsos(null, null, 1, 10)
    where id = (select id from dominio.contrarreembolsos
                 where comprobante_id = 'f1000000-0000-0000-0000-000000000001')),
  '0001-00000001', 'el listado trae el número de la factura'
);
select is(
  (select cliente from public.listar_contrarreembolsos(null, null, 1, 10)
    where id = (select id from dominio.contrarreembolsos
                 where comprobante_id = 'f1000000-0000-0000-0000-000000000001')),
  'Cliente Uno', 'el listado trae el cliente'
);
select is(
  (select transporte from public.listar_contrarreembolsos(null, null, 1, 10)
    where id = (select id from dominio.contrarreembolsos
                 where comprobante_id = 'f1000000-0000-0000-0000-000000000001')),
  'Expreso Uno', 'el listado trae el transporte'
);
select is(
  (select importe from public.listar_contrarreembolsos(null, null, 1, 10)
    where id = (select id from dominio.contrarreembolsos
                 where comprobante_id = 'f1000000-0000-0000-0000-000000000001')),
  1000.00::numeric, 'el listado trae el importe'
);
select is(
  (select estado from public.listar_contrarreembolsos(null, null, 1, 10)
    where id = (select id from dominio.contrarreembolsos
                 where comprobante_id = 'f1000000-0000-0000-0000-000000000001')),
  'cobrado', 'el listado trae el estado'
);
select ok(
  (select fecha is not null from public.listar_contrarreembolsos(null, null, 1, 10)
    where id = (select id from dominio.contrarreembolsos
                 where comprobante_id = 'f1000000-0000-0000-0000-000000000001')),
  'el listado trae la fecha'
);

-- Filtro por estado (FR-045).
select is(
  (select count(*)::int from public.listar_contrarreembolsos(null, 'pendiente', 1, 10)),
  1, 'el filtro por estado deja solo el pendiente'
);
select is(
  (select count(*)::int from public.listar_contrarreembolsos(null, 'cobrado', 1, 10)),
  2, 'el filtro por estado deja solo los cobrados'
);
select throws_ok(
  $$select * from public.listar_contrarreembolsos(null, 'inventado', 1, 10)$$,
  '22023', null, 'un estado que no existe se rechaza'
);

-- Paginación en servidor (FR-045).
select is(
  (select count(*)::int from public.listar_contrarreembolsos(null, null, 1, 1)),
  1, 'la primera página trae una fila'
);
select is(
  (select filas from public.listar_contrarreembolsos(null, null, 1, 1) limit 1),
  3::bigint, 'la página chica sigue informando el total'
);
select is(
  (select count(*)::int from public.listar_contrarreembolsos(null, null, 3, 1)),
  1, 'la tercera página trae la última fila'
);

-- El filtro por tienda (la empresa activa).
select is(
  (select count(*)::int from public.listar_contrarreembolsos(
      'a1000000-0000-0000-0000-00000000000a', null, 1, 10)),
  3, 'el filtro por tienda deja los contrarreembolsos de esa tienda'
);
select is(
  (select count(*)::int from public.listar_contrarreembolsos(
      'a1000000-0000-0000-0000-00000000000b', null, 1, 10)),
  0, 'una tienda sin contrarreembolsos no lista ninguno'
);

-- Los totales de las tarjetas (FR-045).
select is(
  (select pendiente_importe from public.resumen_contrarreembolsos(null)),
  1000.00::numeric, 'el pendiente suma solo lo que está pendiente'
);
select is(
  (select pendiente_cantidad from public.resumen_contrarreembolsos(null)),
  1::bigint, 'el pendiente cuenta los contrarreembolsos pendientes'
);
select is(
  (select cobrado_mes_importe from public.resumen_contrarreembolsos(null)),
  1500.00::numeric, 'los cobrados de este mes suman lo cobrado en el mes'
);
select is(
  (select pendiente_importe from public.resumen_contrarreembolsos(
      'a1000000-0000-0000-0000-00000000000a')),
  1000.00::numeric, 'el resumen también filtra por tienda'
);

-- Una tienda de otra organización: el listado no la cruza.
select is(
  (select count(*)::int from public.listar_contrarreembolsos(
      'a2000000-0000-0000-0000-00000000000c', null, 1, 10)),
  0, 'el listado no muestra contrarreembolsos de una tienda ajena'
);
reset role;

-- El Mostrador ve el listado (lectura) aunque no pueda cobrar.
select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select is(
  (select count(*)::int from public.listar_contrarreembolsos(null, null, 1, 10)),
  3, 'un rol sin la acción igual ve el listado'
);
select is(
  (select public.puede_cobrar_contrarreembolso('a1000000-0000-0000-0000-00000000000a')),
  false, 'un rol sin la acción no puede cobrar contrarreembolsos en esa tienda'
);
reset role;

-- Administración sí puede.
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is(
  (select public.puede_cobrar_contrarreembolso('a1000000-0000-0000-0000-00000000000a')),
  true, 'Administración puede cobrar contrarreembolsos en su tienda'
);
reset role;

-- Aislamiento: otra organización ve lo suyo y nada más.
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.listar_contrarreembolsos(null, null, 1, 10)),
  1, 'la otra organización solo ve su propio contrarreembolso'
);
select is(
  (select pendiente_cantidad from public.resumen_contrarreembolsos(null)),
  1::bigint, 'el resumen de la otra organización no incluye los ajenos'
);
reset role;

-- Sin Ventas no hay listado.
update permisos_rol set nivel = 'ninguno'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'consulta' and seccion = 'ventas';
select pg_temp.como('d1000000-0000-0000-0000-000000000005');
select throws_ok(
  $$select * from public.listar_contrarreembolsos(null, null, 1, 10)$$,
  '42501', null, 'sin Ventas no se listan los contrarreembolsos'
);
select throws_ok(
  $$select * from public.resumen_contrarreembolsos(null)$$,
  '42501', null, 'sin Ventas no se ven los totales'
);
reset role;

select * from finish();

rollback;
