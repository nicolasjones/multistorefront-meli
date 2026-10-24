-- F-VTA-09 (MSF-346, épica MSF-177, SC-001): listado y exportación de comprobantes.
-- Cubre `listar_comprobantes` / `operadores_de_comprobantes` (security invoker; organización y empresas de la
-- sesión), búsqueda sin mayúsculas/tildes/espacios y con comodines escapados, cada filtro, paginación y orden
-- estable, aislamiento por organización/empresa/sección, `exportar_comprobantes` (tope 10.000 y permiso
-- `exportar`) y la exportación diferida (`solicitar_exportacion_comprobantes`, bucket privado, YA_EN_CURSO e
-- idempotencia). La tabla `rls_en_toda_tabla` recorre public+dominio en su propia prueba: acá no hay tablas
-- nuevas. `nota_credito` se agrega al CHECK de `tipo` en F-VTA-11; el listado ya la incluye y el signo negativo
-- está cubierto en `comprobante_nota_credito.test.sql` de esa historia.
-- El fixture corre como postgres (RLS no aplica); las verificaciones usan el rol/sesión que corresponda.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('e1000000-0000-0000-0000-000000000002', 'operador-uno@example.com'),
  ('e1000000-0000-0000-0000-000000000003', 'consulta-uno@example.com'),
  ('e2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into perfiles_usuario (user_id, nombre, apellido) values
  ('e1000000-0000-0000-0000-000000000001', 'Ana', 'Paz'),
  ('e1000000-0000-0000-0000-000000000002', 'Emilse', 'Gómez'),
  ('e1000000-0000-0000-0000-000000000003', 'Carla', 'Ruiz'),
  ('e2000000-0000-0000-0000-000000000001', 'Bruno', 'Díaz');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-0000000000e2', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('a2000000-0000-0000-0000-0000000000e1', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

-- Operador y consulta solo ven San Javucho; el administrador ve las dos de su organización.
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('e1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('e1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-111111111111', 'consulta');

insert into public.clientes (id, organizacion_id, nombre, tipo) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Distribuidora Ñandú', 'mayorista'),
  ('c5000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Cliente Número', 'minorista'),
  ('c6000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Cliente de la Dos', 'minorista');

insert into dominio.formas_pago (id, organizacion_id, empresa_id, nombre, tipo) values
  ('f1000000-0000-0000-0000-0000000000p1', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'Efectivo', 'efectivo'),
  ('f1000000-0000-0000-0000-0000000000p2', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e2', 'Tarjeta', 'tarjeta');

insert into dominio.formas_envio (id, organizacion_id, empresa_id, nombre, tipo) values
  ('f2000000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'Retiro en local', 'retiro_local'),
  ('f2000000-0000-0000-0000-0000000000e2', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e2', 'Correo', 'correo');

insert into dominio.comprobantes_venta
  (organizacion_id, empresa_id, cliente_id, tipo, numero, numero_entero, fecha, estado, total_sin_iva, total_con_iva, operador_id, forma_pago_id, envio_id)
values
  -- factura 1: la más vieja; estado guardado `confirmada`, que el panel muestra «Pendiente».
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'c5000000-0000-0000-0000-000000000001', 'factura', '00000001', 1, '2026-10-01', 'confirmada', 1000, 1210, 'e1000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-0000000000p1', 'f2000000-0000-0000-0000-0000000000e1'),
  -- factura 2 y 4: misma fecha; el orden desempata por número descendente.
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'c5000000-0000-0000-0000-000000000002', 'factura', '00000002', 2, '2026-10-03', 'aceptado', 2000, 2420, 'e1000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-0000000000p1', null),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'c5000000-0000-0000-0000-000000000002', 'factura', '00000004', 4, '2026-10-03', 'aceptado', 2000, 2420, 'e1000000-0000-0000-0000-000000000002', null, null),
  -- factura 3: de la otra tienda, emitida por el administrador.
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e2', 'c5000000-0000-0000-0000-000000000001', 'factura', '00000001', 1, '2026-10-02', 'confirmada', 3000, 3630, 'e1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-0000000000p2', 'f2000000-0000-0000-0000-0000000000e2'),
  -- presupuesto vencido: no entra al listado de Comprobantes (tiene su pestaña), sí a la exportación de presupuestos.
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'c5000000-0000-0000-0000-000000000001', 'presupuesto', '00000001', 1, '2000-01-01', 'pendiente', 82.64, 100, 'e1000000-0000-0000-0000-000000000002', null, null),
  -- otra organización.
  ('22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-0000000000e1', 'c6000000-0000-0000-0000-000000000001', 'factura', '00000001', 1, '2026-10-05', 'pendiente', 500, 605, 'e2000000-0000-0000-0000-000000000001', null, null);

update dominio.comprobantes_venta set valido_hasta = '2000-01-31'
 where tipo = 'presupuesto' and organizacion_id = '11111111-1111-1111-1111-111111111111';

-- Conexión `historial-ventas` de la organización Uno (la exportación diferida corre ahí). La Dos no la tiene.
insert into sistemas_externos (id, descripcion)
values ('historial-ventas', 'Prueba de la exportación diferida')
on conflict (id) do nothing;
insert into conexiones (id, organizacion_id, sistema_externo, credencial_vault_id)
values ('c1000000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111', 'historial-ventas', gen_random_uuid());

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Contrato, seguridad y privilegios (FR-001, FR-006)
-- ============================================================================

select is(
  (select count(*)::int from unnest(array[
    'public.listar_comprobantes(text,text,uuid,uuid,uuid,uuid,integer,integer)',
    'public.operadores_de_comprobantes(uuid)',
    'public.exportar_comprobantes(text,text,text,uuid,uuid,uuid,uuid)',
    'public.solicitar_exportacion_comprobantes(text,jsonb)',
    'public.archivo_exportacion_comprobantes(uuid)'
  ]) as f where has_function_privilege('anon', f::regprocedure, 'execute')),
  0, 'anon no ejecuta ninguna RPC de listado ni exportación'
);
select is(
  (select count(*)::int from unnest(array[
    'public.listar_comprobantes(text,text,uuid,uuid,uuid,uuid,integer,integer)',
    'public.operadores_de_comprobantes(uuid)',
    'public.exportar_comprobantes(text,text,text,uuid,uuid,uuid,uuid)',
    'public.solicitar_exportacion_comprobantes(text,jsonb)',
    'public.archivo_exportacion_comprobantes(uuid)'
  ]) as f where has_function_privilege('authenticated', f::regprocedure, 'execute')),
  5, 'authenticated ejecuta las cinco RPC de la historia'
);
select is(
  (select prosecdef from pg_proc where oid = 'public.listar_comprobantes(text,text,uuid,uuid,uuid,uuid,integer,integer)'::regprocedure),
  false, 'listar_comprobantes es security invoker'
);
select is(
  (select prosecdef from pg_proc where oid = 'public.operadores_de_comprobantes(uuid)'::regprocedure),
  false, 'operadores_de_comprobantes es security invoker'
);
select is(
  (select prosecdef from pg_proc where oid = 'public.exportar_comprobantes(text,text,text,uuid,uuid,uuid,uuid)'::regprocedure),
  false, 'exportar_comprobantes es security invoker'
);
select is(
  has_function_privilege('authenticated', 'private.comprobantes_consulta(uuid,uuid[],text[],text,text,uuid,uuid,uuid,uuid,integer,integer)', 'execute'),
  false, 'authenticated no ejecuta la consulta interna que recibe organización y empresas'
);
select is(
  has_function_privilege('authenticated', 'private.comprobantes_consulta_sesion(text[],text,text,uuid,uuid,uuid,uuid,integer,integer)', 'execute'),
  true, 'el puente que deriva organización y empresas de la sesión sí es ejecutable'
);
select is(
  has_function_privilege('authenticated', 'private.iniciar_exportacion_comprobantes(uuid,text,uuid,jsonb)', 'execute'),
  false, 'authenticated no inicia la ejecución diferida por fuera de la RPC'
);
select is(
  has_function_privilege('authenticated', 'private.datos_exportacion_comprobantes(uuid)', 'execute')
    or has_function_privilege('authenticated', 'private.filas_exportacion_comprobantes(uuid,integer,integer)', 'execute'),
  false, 'authenticated no lee las funciones del worker'
);
select is(
  (select public from storage.buckets where id = 'exportaciones-ventas'),
  false, 'el bucket de la exportación es privado'
);
select ok(
  exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'exportaciones_ventas_select'),
  'el bucket tiene su política de lectura por organización y usuario'
);

-- ============================================================================
-- Listado: búsqueda, filtros, orden y paginación (FR-001, FR-002, FR-003)
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000001');

select is(
  (select count(*)::int from public.listar_comprobantes()),
  4, 'el administrador ve las cuatro facturas de su organización (el presupuesto va en su pestaña)'
);
select is(
  (select max(filas) from public.listar_comprobantes()),
  4::bigint, 'filas trae el total del filtro, no el de la página'
);
select is(
  (select string_agg(numero, ',' order by fecha desc, numero_entero desc) from public.listar_comprobantes(p_pagina => 1, p_tamano => 2)),
  '00000004,00000002', 'primera página: fecha descendente y, a igual fecha, número descendente'
);
select is(
  (select string_agg(numero, ',' order by fecha desc, numero_entero desc) from public.listar_comprobantes(p_pagina => 2, p_tamano => 2)),
  '00000001,00000001', 'segunda página: completo y sin repetir entre páginas'
);
select is(
  (select max(filas) from public.listar_comprobantes(p_pagina => 2, p_tamano => 2)),
  4::bigint, 'la segunda página conserva el total del filtro'
);
select is(
  (select estado from public.listar_comprobantes() where numero = '00000001' and empresa = 'San Javucho'),
  'confirmada', 'el estado guardado se devuelve tal cual; la etiqueta se resuelve en el catálogo'
);
select is(
  (select count(*)::int from public.listar_comprobantes(p_busqueda => '  ÑANDÚ  ')),
  2, 'búsqueda sin mayúsculas, con tilde y con espacios sobrantes'
);
select is(
  (select count(*)::int from public.listar_comprobantes(p_busqueda => 'numero')),
  2, 'búsqueda sin tildes (Número → numero)'
);
select is(
  (select numero from public.listar_comprobantes(p_busqueda => '00000004')),
  '00000004', 'búsqueda por número'
);
select is(
  (select count(*)::int from public.listar_comprobantes(p_busqueda => '%')),
  0, 'los comodines se escapan: % no trae todo'
);
select is(
  (select count(*)::int from public.listar_comprobantes(p_estado => 'pendiente')),
  2, 'estado pendiente incluye las facturas guardadas como confirmada'
);
select is(
  (select count(*)::int from public.listar_comprobantes(p_estado => 'confirmada')),
  2, 'estado confirmada es un alias de pendiente'
);
select is(
  (select count(*)::int from public.listar_comprobantes(p_pago_id => 'f1000000-0000-0000-0000-0000000000p1')),
  2, 'filtro Pago'
);
select is(
  (select count(*)::int from public.listar_comprobantes(p_envio_id => 'f2000000-0000-0000-0000-0000000000e1')),
  1, 'filtro Envío'
);
select is(
  (select count(*)::int from public.listar_comprobantes(p_operador_id => 'e1000000-0000-0000-0000-000000000001')),
  1, 'filtro Operador'
);
select is(
  (select count(*)::int from public.listar_comprobantes(p_empresa_id => 'a1000000-0000-0000-0000-0000000000e2')),
  1, 'filtro Tienda'
);
select is(
  (select count(*)::int from public.listar_comprobantes(p_estado => 'convertido')),
  0, 'un estado válido sin filas devuelve cero, no error'
);
select throws_ok(
  $$select * from public.listar_comprobantes(p_estado => 'inventado')$$,
  '22023', null, 'un estado desconocido se rechaza'
);
select is(
  (select count(*)::int from public.listar_comprobantes(p_pagina => 99, p_tamano => 2)),
  0, 'una página fuera de rango no devuelve filas'
);

-- Operadores: opciones del filtro Operador.
select is(
  (select array_agg(nombre order by nombre) from public.operadores_de_comprobantes()),
  array['Ana Paz', 'Emilse Gómez'],
  'las opciones de Operador salen de los comprobantes visibles, sin repetir'
);
select is(
  (select array_agg(nombre order by nombre) from public.operadores_de_comprobantes('a1000000-0000-0000-0000-0000000000e1')),
  array['Emilse Gómez'], 'Operador se acota a la tienda pedida'
);

-- ============================================================================
-- Aislamiento por empresa, sección y organización (FR-001, SC-001)
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select is(
  (select count(*)::int from public.listar_comprobantes()),
  3, 'el operador asignado a San Javucho no ve la factura de Mundo JC'
);
select is(
  (select count(*)::int from public.listar_comprobantes(p_empresa_id => 'a1000000-0000-0000-0000-0000000000e2')),
  0, 'pedir una empresa no accesible devuelve cero filas'
);
select is(
  (select array_agg(nombre order by nombre) from public.operadores_de_comprobantes()),
  array['Emilse Gómez'], 'las opciones de Operador respetan las empresas accesibles'
);
select is(
  (select count(*)::int from public.exportar_comprobantes('comprobantes')),
  3, 'la exportación también se acota a las empresas accesibles'
);

select pg_temp.como('e1000000-0000-0000-0000-000000000003');
select throws_ok(
  $$select * from public.exportar_comprobantes('comprobantes')$$,
  '42501', null, 'con ventas en lectura y sin acción exportar no se exporta'
);

select pg_temp.como('e2000000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.listar_comprobantes()),
  1, 'otra organización solo ve sus propios comprobantes'
);
select is(
  (select empresa from public.listar_comprobantes()),
  'Empresa Dos', 'la fila visible es de su empresa'
);
select is(
  (select count(*)::int from public.exportar_comprobantes('comprobantes')),
  1, 'la exportación no cruza organizaciones'
);

-- ============================================================================
-- Exportación inmediata (FR-006)
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.exportar_comprobantes('comprobantes')),
  4, 'exporta TODAS las filas del filtro, no solo la página'
);
select is(
  (select max(filas) from public.exportar_comprobantes('comprobantes')),
  4::bigint, 'filas informa el total del filtro'
);
select is(
  (select estado from public.exportar_comprobantes('presupuestos', p_estado => 'vencido')),
  'vencido', 'los presupuestos se exportan y conservan el vencido derivado'
);
select is(
  (select count(*)::int from public.exportar_comprobantes('presupuestos', p_estado => 'pendiente')),
  0, 'un presupuesto vencido no aparece como pendiente'
);
select throws_ok(
  $$select * from public.exportar_comprobantes('otro')$$,
  '22023', null, 'el tipo de exportación se valida'
);
select throws_ok(
  $$select public.solicitar_exportacion_comprobantes('otro', '{}'::jsonb)$$,
  '22023', null, 'la exportación diferida también valida el tipo'
);
select throws_ok(
  $$select public.solicitar_exportacion_comprobantes('comprobantes', '[]'::jsonb)$$,
  '22023', null, 'los filtros deben ser un objeto'
);
select throws_ok(
  $$select public.solicitar_exportacion_comprobantes('comprobantes', '{"pago_id":"no-es-uuid"}'::jsonb)$$,
  '22023', null, 'un id de filtro inválido se rechaza'
);

-- ============================================================================
-- Exportación diferida (FR-007, FR-008) y bucket
-- ============================================================================

-- La organización Dos no tiene la conexión `historial-ventas`.
select pg_temp.como('e2000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.solicitar_exportacion_comprobantes('comprobantes', '{}'::jsonb)$$,
  'P0001', null, 'sin conexión de exportaciones la solicitud se rechaza (SIN_CONEXION_EXPORTACION)'
);

select pg_temp.como('e1000000-0000-0000-0000-000000000003');
select throws_ok(
  $$select public.solicitar_exportacion_comprobantes('comprobantes', '{}'::jsonb)$$,
  '42501', null, 'sin la acción exportar no se pide la exportación diferida'
);

select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select isnt(
  public.solicitar_exportacion_comprobantes('comprobantes', '{"estado":"pendiente"}'::jsonb),
  null,
  'el operador con exportar pide la exportación grande y recibe el id de la ejecución'
);
select is(
  public.solicitar_exportacion_comprobantes('comprobantes', '{"estado":"pendiente"}'::jsonb),
  (select id from ejecuciones_worker where organizacion_id = '11111111-1111-1111-1111-111111111111' and detalle->>'tipo' = 'comprobantes'),
  'repetir la misma solicitud devuelve la ejecución en curso (idempotente)'
);
select throws_ok(
  $$select public.solicitar_exportacion_comprobantes('comprobantes', '{"estado":"aceptado"}'::jsonb)$$,
  'P0001', null, 'otra exportación distinta mientras hay una en curso se bloquea (YA_EN_CURSO)'
);
select is(
  (select count(*)::int from despachos_ejecucion d
    join ejecuciones_worker e on e.id = d.ejecucion_id
   where e.organizacion_id = '11111111-1111-1111-1111-111111111111' and e.detalle->>'tipo' = 'comprobantes'),
  1, 'la solicitud deja una orden de despacho en el outbox para Kestra'
);
select is(
  (select detalle->'empresas' from ejecuciones_worker
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and detalle->>'tipo' = 'comprobantes' limit 1),
  '["a1000000-0000-0000-0000-0000000000e1"]'::jsonb,
  'el worker recibe solo las empresas visibles resueltas al solicitar'
);

-- El worker lee los datos guardados. En el CI postgres no es superusuario y no puede simular el login del worker:
-- las funciones aceptan al dueño y `autorizar_llamante_ciclo` acepta a un administrador por JWT.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub', 'e1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);

select is(
  (select tipo from private.datos_exportacion_comprobantes(
    (select id from ejecuciones_worker where organizacion_id = '11111111-1111-1111-1111-111111111111' and detalle->>'tipo' = 'comprobantes' limit 1))),
  'comprobantes', 'el worker obtiene el tipo de su ejecución'
);
select ok(
  (select archivo like '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000002/%.csv'
     from private.datos_exportacion_comprobantes(
       (select id from ejecuciones_worker where organizacion_id = '11111111-1111-1111-1111-111111111111' and detalle->>'tipo' = 'comprobantes' limit 1))),
  'el CSV va al prefijo de la organización y de quien lo pidió'
);
select is(
  (select count(*)::int from private.filas_exportacion_comprobantes(
    (select id from ejecuciones_worker where organizacion_id = '11111111-1111-1111-1111-111111111111' and detalle->>'tipo' = 'comprobantes' limit 1), 0, 100)),
  1, 'el worker recibe las filas con los filtros guardados (pendiente: una)'
);
select is(
  (select max(filas) from private.filas_exportacion_comprobantes(
    (select id from ejecuciones_worker where organizacion_id = '11111111-1111-1111-1111-111111111111' and detalle->>'tipo' = 'comprobantes' limit 1), 0, 100)),
  1::bigint, 'filas conserva el total del filtro guardado'
);
select throws_ok(
  format($f$select * from private.filas_exportacion_comprobantes(%L, 0, 5001)$f$,
    (select id from ejecuciones_worker where organizacion_id = '11111111-1111-1111-1111-111111111111' and detalle->>'tipo' = 'comprobantes' limit 1)),
  '22023', null, 'el lote del worker tiene un tope'
);

-- Descarga por quien la pidió (FR-010): estado propio, ruta solo si terminó, nada de ejecuciones ajenas.
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select is(
  (select estado from public.archivo_exportacion_comprobantes((select id from ejecuciones_worker where organizacion_id = '11111111-1111-1111-1111-111111111111' and detalle->>'tipo' = 'comprobantes' limit 1))),
  'en_curso', 'el solicitante ve el estado de su exportación'
);
select is(
  (select archivo from public.archivo_exportacion_comprobantes((select id from ejecuciones_worker where organizacion_id = '11111111-1111-1111-1111-111111111111' and detalle->>'tipo' = 'comprobantes' limit 1))),
  null, 'mientras está en curso no hay ruta de archivo'
);
select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select throws_ok(
  format($f$select * from public.archivo_exportacion_comprobantes(%L)$f$, (select id from ejecuciones_worker where organizacion_id = '11111111-1111-1111-1111-111111111111' and detalle->>'tipo' = 'comprobantes' limit 1)),
  'P0002', null, 'otra persona de la organización (aunque administre) no obtiene la exportación ajena'
);
select pg_temp.como('e1000000-0000-0000-0000-000000000003');
select throws_ok(
  format($f$select * from public.archivo_exportacion_comprobantes(%L)$f$, (select id from ejecuciones_worker where organizacion_id = '11111111-1111-1111-1111-111111111111' and detalle->>'tipo' = 'comprobantes' limit 1)),
  '42501', null, 'sin la acción exportar no se consulta ninguna exportación'
);
select pg_temp.como('e2000000-0000-0000-0000-000000000001');
select throws_ok(
  format($f$select * from public.archivo_exportacion_comprobantes(%L)$f$, (select id from ejecuciones_worker where organizacion_id = '11111111-1111-1111-1111-111111111111' and detalle->>'tipo' = 'comprobantes' limit 1)),
  'P0002', null, 'otra organización no ve la exportación'
);

-- ============================================================================
-- Tope de 10.000 filas (FR-006)
-- ============================================================================

insert into dominio.comprobantes_venta
  (organizacion_id, empresa_id, cliente_id, tipo, numero, numero_entero, fecha, estado, total_sin_iva, total_con_iva, operador_id)
select '22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-0000000000e1',
       'c6000000-0000-0000-0000-000000000001', 'factura', lpad(g::text, 8, '0'), g,
       '2026-01-01', 'pendiente', 1, 1, 'e2000000-0000-0000-0000-000000000001'
  from generate_series(100000, 110000) g;

select pg_temp.como('e2000000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.exportar_comprobantes('comprobantes')),
  10000, 'la exportación inmediata se corta en 10.000 filas'
);
select is(
  (select max(filas) from public.exportar_comprobantes('comprobantes')),
  10002::bigint, 'filas sigue informando el total real del filtro (la pantalla elige la vía diferida)'
);
select is(
  (select count(*)::int from public.listar_comprobantes(p_tamano => 500)),
  200, 'la página se acota a 200 filas'
);

select * from finish();
rollback;
