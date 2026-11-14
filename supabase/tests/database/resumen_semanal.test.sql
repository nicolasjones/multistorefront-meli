-- F-REP-08 (MSF-265, spec 20261114-100000-analitica-avanzada-y-resumen-por-correo): resumen semanal por correo.
--   RF-REP-08-1 ventana (lunes 08:00 Buenos Aires) y semana cubierta · RF-REP-08-2 destinatarios (administradores
--   activos, con correo y preferencia encendida) · RF-REP-08-3 contenido por secciones (las ausentes se omiten) ·
--   RF-REP-08-4 idempotencia por organización y semana · RF-REP-08-5 reintento sin duplicar, error útil y tope ·
--   RF-REP-08-6 pausa por organización solo para administradores, con evento en Actividad · RF-REP-08-7 aislamiento
--   entre organizaciones y sin datos de clientes · RF-REP-08-9 privilegios exactos (anon nada; barrido solo service_role).
-- El fixture corre como postgres (RLS no aplica); las verificaciones de acceso, como «authenticated», «anon» o
-- «service_role», igual que PostgREST. Las fechas del barrido son fijas (lunes 2027-03-22, hora de Buenos Aires).
begin;

select plan(81);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos'),
  ('33333333-3333-3333-3333-333333333333', 'Organización Tres');

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'Admin-Uno@example.com'),
  ('f1000000-0000-0000-0000-000000000002', 'consulta-uno@example.com'),
  ('f1000000-0000-0000-0000-000000000003', 'suspendido-uno@example.com'),
  ('f1000000-0000-0000-0000-000000000004', 'admin-uno-baja@example.com'),
  ('f2000000-0000-0000-0000-000000000001', 'admin-dos@example.com'),
  ('f3000000-0000-0000-0000-000000000001', 'admin-tres@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('f1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'administrador', 'suspendido'),
  ('f1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('f2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo'),
  ('f3000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'administrador', 'activo');

-- La persona 4 se dio de baja del resumen desde /cuenta/avisos.
insert into public.preferencias_aviso (user_id, tipo_aviso, activo) values
  ('f1000000-0000-0000-0000-000000000004', 'resumen_semanal', false);

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Tienda A'),
  ('e1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Tienda B'),
  ('e2000000-0000-0000-0000-00000000000d', '22222222-2222-2222-2222-222222222222', 'Tienda D');

insert into public.clientes (id, organizacion_id, nombre, tipo) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Cliente Secreto Uno', 'minorista'),
  ('c6000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Cliente Secreto Dos', 'minorista');

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Zapato', 'P-1', 100),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Suelto', 'P-2', 100),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Producto Dos', 'P-9', 100);

delete from dominio.depositos
 where por_defecto
   and organizacion_id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');
insert into dominio.depositos (id, organizacion_id, nombre, por_defecto) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Central', true),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Depósito Dos', true);

-- Semana cubierta por el barrido del lunes 2027-03-22: lunes 2027-03-15 a domingo 2027-03-21.
insert into dominio.comprobantes_venta
  (id, organizacion_id, empresa_id, cliente_id, tipo, numero, numero_entero, fecha, estado, total_sin_iva, total_con_iva)
values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-00000000000a', 'c5000000-0000-0000-0000-000000000001', 'factura', '00000001', 1, date '2027-03-16', 'confirmada', 1000, 1210),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-00000000000b', 'c5000000-0000-0000-0000-000000000001', 'factura', '00000001', 1, date '2027-03-17', 'confirmada', 2000, 2420),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-00000000000a', 'c5000000-0000-0000-0000-000000000001', 'factura', '00000002', 2, date '2027-03-09', 'confirmada', 500, 605),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-00000000000d', 'c6000000-0000-0000-0000-000000000001', 'factura', '00000001', 1, date '2027-03-16', 'confirmada', 6000, 7260);

insert into dominio.comprobantes_venta_lineas
  (organizacion_id, comprobante_id, orden, producto_id, descripcion, codigo, cantidad, precio_unitario, escala, deposito_id, subtotal_sin_iva, iva, costo_unitario)
values
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 1, 'b1000000-0000-0000-0000-000000000001', 'Zapato', 'COD', 1, 1000, 'x1', 'd1000000-0000-0000-0000-000000000001', 1000, 210, 400),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000002', 1, 'b1000000-0000-0000-0000-000000000002', 'Suelto', 'COD', 2, 1000, 'x1', 'd1000000-0000-0000-0000-000000000001', 2000, 420, 1200),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000003', 1, 'b1000000-0000-0000-0000-000000000001', 'Zapato', 'COD', 1, 500, 'x1', 'd1000000-0000-0000-0000-000000000001', 500, 105, 400),
  ('22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-000000000001', 1, 'b2000000-0000-0000-0000-000000000001', 'Producto Dos', 'COD', 1, 6000, 'x1', 'd2000000-0000-0000-0000-000000000001', 6000, 1260, 1000);

-- Stock: Zapato sin stock, Suelto bajo el mínimo (Uno); Producto Dos normal.
update dominio.existencias set cantidad = 0, minimo = 5 where producto_id = 'b1000000-0000-0000-0000-000000000001';
update dominio.existencias set cantidad = 2, minimo = 5 where producto_id = 'b1000000-0000-0000-0000-000000000002';
update dominio.existencias set cantidad = 10, minimo = 5 where producto_id = 'b2000000-0000-0000-0000-000000000001';

-- Faltante abierto en Uno (hace 3 días).
insert into dominio.faltantes_venta
  (organizacion_id, empresa_id, comprobante_id, linea_orden, producto_id, deposito_id, cantidad_faltante, creado_en)
values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-00000000000b', 'a1000000-0000-0000-0000-000000000002', 1,
   'b1000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000001', 2, now() - interval '3 days');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Esquema (Principio VII) y privilegios (RF-REP-08-9)
-- ============================================================================

select ok(
  (select count(*) = 2 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('resumen_semanal_config', 'resumen_semanal_envios') and c.relrowsecurity),
  'las dos tablas viven en «public» (plataforma) y tienen RLS activada'
);
select is(
  (select count(*)::int from unnest(array['public.resumen_semanal_config', 'public.resumen_semanal_envios']) t
    where has_table_privilege('anon', t, 'select') or has_table_privilege('anon', t, 'insert')
       or has_table_privilege('anon', t, 'update') or has_table_privilege('anon', t, 'delete')),
  0, 'anon no tiene ningún privilegio sobre las tablas'
);
select is(
  (select count(*)::int from unnest(array['public.resumen_semanal_config', 'public.resumen_semanal_envios']) t
    where has_table_privilege('authenticated', t, 'select') or has_table_privilege('authenticated', t, 'insert')
       or has_table_privilege('authenticated', t, 'update') or has_table_privilege('authenticated', t, 'delete')),
  0, 'authenticated tampoco lee ni escribe las tablas directo (solo por las RPC)'
);
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename in ('resumen_semanal_config', 'resumen_semanal_envios')),
  0, 'sin políticas: nadie llega a las filas fuera del código security definer'
);
select is(
  (select count(*)::int from unnest(array[
    'public.organizaciones_con_resumen_semanal_pendiente()',
    'public.generar_resumen_semanal(uuid, integer)',
    'public.cerrar_resumen_semanal(uuid, boolean, text)',
    'public.configurar_resumen_semanal(boolean)',
    'public.estado_resumen_semanal()',
    'private.armar_resumen_semanal(uuid, date, date)',
    'private.generar_resumen_semanal_en(uuid, integer, timestamptz)',
    'private.destinatarios_resumen_semanal(uuid)'
  ]) f where has_function_privilege('anon', f, 'execute')),
  0, 'anon no ejecuta ninguna función del resumen'
);
select is(
  (select count(*)::int from unnest(array[
    'public.organizaciones_con_resumen_semanal_pendiente()',
    'public.generar_resumen_semanal(uuid, integer)',
    'public.cerrar_resumen_semanal(uuid, boolean, text)',
    'private.armar_resumen_semanal(uuid, date, date)',
    'private.generar_resumen_semanal_en(uuid, integer, timestamptz)',
    'private.destinatarios_resumen_semanal(uuid)'
  ]) f where has_function_privilege('authenticated', f, 'execute')),
  0, 'authenticated no ejecuta el barrido ni las funciones internas'
);
select is(
  (select count(*)::int from unnest(array[
    'public.organizaciones_con_resumen_semanal_pendiente()',
    'public.generar_resumen_semanal(uuid, integer)',
    'public.cerrar_resumen_semanal(uuid, boolean, text)'
  ]) f where has_function_privilege('service_role', f, 'execute')),
  3, 'service_role ejecuta las tres RPC del barrido'
);
select is(
  (select count(*)::int from unnest(array['public.configurar_resumen_semanal(boolean)', 'public.estado_resumen_semanal()']) f
    where has_function_privilege('authenticated', f, 'execute')),
  2, 'authenticated ejecuta configurar y estado (que exigen ser administrador)'
);
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where ((n.nspname = 'public' and p.proname in ('organizaciones_con_resumen_semanal_pendiente', 'generar_resumen_semanal', 'cerrar_resumen_semanal', 'configurar_resumen_semanal', 'estado_resumen_semanal'))
        or (n.nspname = 'private' and p.proname in ('armar_resumen_semanal', 'generar_resumen_semanal_en', 'destinatarios_resumen_semanal', 'organizaciones_con_resumen_semanal_pendiente_en')))
      and (not p.prosecdef or p.proconfig is null or not ('search_path=""' = any (p.proconfig)))),
  0, 'todas las funciones son security definer con search_path vacío'
);
select ok(exists (select 1 from public.tipos_aviso where clave = 'resumen_semanal'), 'el tipo de aviso resumen_semanal está en el catálogo (baja personal)');

-- ============================================================================
-- Contenido (RF-REP-08-3, RF-REP-08-7)
-- ============================================================================

create temp table contenido (org text primary key, c jsonb);
grant select on contenido to public;
insert into contenido
  select '1', private.armar_resumen_semanal('11111111-1111-1111-1111-111111111111', date '2027-03-15', date '2027-03-21')
  union all
  select '2', private.armar_resumen_semanal('22222222-2222-2222-2222-222222222222', date '2027-03-15', date '2027-03-21')
  union all
  select '3', private.armar_resumen_semanal('33333333-3333-3333-3333-333333333333', date '2027-03-15', date '2027-03-21');

select is((select (c #>> '{ventas,facturado}')::numeric from contenido where org = '1'), 3630.00::numeric, 'ventas: facturado de la semana (Tienda A 1210 + Tienda B 2420), sin la semana anterior');
select is((select (c #>> '{ventas,facturado_anterior}')::numeric from contenido where org = '1'), 605.00::numeric, 'ventas: facturado de la semana anterior para comparar');
select is((select (c #>> '{ventas,comprobantes}')::int from contenido where org = '1'), 2, 'ventas: comprobantes de la semana');
select is((select (c #>> '{ventas,unidades}')::int from contenido where org = '1'), 3, 'ventas: unidades de la semana');
select is((select c #>> '{ventas,tiendas,0,nombre}' from contenido where org = '1'), 'Tienda B', 'ventas: la tienda con más facturado va primero');
select is((select (c #>> '{rentabilidad,vendido}')::numeric from contenido where org = '1'), 3000.00::numeric, 'rentabilidad: vendido neto de la semana');
select is((select (c #>> '{rentabilidad,margen}')::numeric from contenido where org = '1'), 200.00::numeric, 'rentabilidad: margen real de la semana (600 de Zapato menos 400 de Suelto)');
select is((select (c #>> '{rentabilidad,margen_pct}')::numeric from contenido where org = '1'), 6.7::numeric, 'rentabilidad: margen en porcentaje');
select ok((select c #> '{rentabilidad,productos_en_riesgo}' is not null from contenido where org = '1'), 'rentabilidad: informa los productos con margen bajo o negativo');
select is((select (c #>> '{stock,sin_stock}')::int from contenido where org = '1'), 1, 'stock en alerta: un producto sin stock');
select is((select (c #>> '{stock,stock_bajo}')::int from contenido where org = '1'), 1, 'stock en alerta: un producto bajo el mínimo');
select is((select c #>> '{stock,productos,0,nombre}' from contenido where org = '1'), 'Zapato', 'stock en alerta: «sin stock» va primero');
select is((select (c #>> '{faltantes,pendientes}')::int from contenido where org = '1'), 1, 'faltantes pendientes: uno abierto');
select is((select (c #>> '{faltantes,dias_mas_antiguo}')::int from contenido where org = '1'), 3, 'faltantes pendientes: días del más antiguo');
select is(
  (select array(select jsonb_array_elements_text(c -> 'fuentes') order by 1) from contenido where org = '1'),
  array['faltantes', 'rentabilidad', 'stock', 'ventas'], 'las fuentes existentes quedan declaradas'
);
select is(
  (select (c #>> '{ventas,facturado}')::numeric from contenido where org = '2'), 7260.00::numeric,
  'aislamiento: la organización Dos ve solo lo suyo'
);
select ok(
  (select not (c::text ilike '%Secreto%' or c::text ilike '%@%' or c::text like '%Producto Dos%') from contenido where org = '1'),
  'sin datos de clientes ni correos (y nada de la otra organización) en el resumen de Uno'
);
select ok(
  (select (not (c ? 'stock')) and (not (c ? 'faltantes')) and (c ? 'ventas') from contenido where org = '3'),
  'sin alertas ni faltantes pendientes, esas secciones se omiten (ventas queda con ceros)'
);
select is((select (c #>> '{ventas,facturado}')::numeric from contenido where org = '3'), 0::numeric, 'sin ventas la sección muestra ceros');

-- Fuente inexistente: sin la vista de ventas la sección se omite y no hay error (RF-REP-08-3).
drop view analitica.ventas_periodo_canal;
select is(
  (select (private.armar_resumen_semanal('11111111-1111-1111-1111-111111111111', date '2027-03-15', date '2027-03-21') ? 'ventas')),
  false, 'sin la vista de ventas la sección de ventas se omite sin error'
);
select ok(
  (select not ((private.armar_resumen_semanal('11111111-1111-1111-1111-111111111111', date '2027-03-15', date '2027-03-21') -> 'fuentes') ? 'ventas')),
  'y la fuente ausente no figura en las fuentes'
);
select ok(
  (select private.armar_resumen_semanal('11111111-1111-1111-1111-111111111111', date '2027-03-15', date '2027-03-21') ? 'stock'),
  'las demás secciones siguen saliendo'
);

-- ============================================================================
-- Ventana y generación (RF-REP-08-1, RF-REP-08-2)
-- ============================================================================

select is(
  (select count(*)::int from private.generar_resumen_semanal_en('11111111-1111-1111-1111-111111111111', 5, timestamptz '2027-03-21 12:00:00-03')),
  0, 'el domingo no se genera ningún resumen'
);
select is(
  (select count(*)::int from private.generar_resumen_semanal_en('11111111-1111-1111-1111-111111111111', 5, timestamptz '2027-03-22 07:59:00-03')),
  0, 'el lunes antes de las 08:00 (Buenos Aires) tampoco'
);
select is((select count(*)::int from public.resumen_semanal_envios), 0, 'fuera de la ventana no queda ningún registro');
select is(
  private.organizaciones_con_resumen_semanal_pendiente_en(timestamptz '2027-03-22 07:59:00-03', 5),
  '{}'::uuid[], 'fuera de la ventana el barrido no tiene organizaciones para procesar'
);
select is(
  private.organizaciones_con_resumen_semanal_pendiente_en(timestamptz '2027-03-22 08:00:00-03', 5) @> array[
    '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222']::uuid[],
  true, 'el lunes a las 08:00 el barrido incluye a las organizaciones activas'
);

create temp table gen1 as
  select * from private.generar_resumen_semanal_en('11111111-1111-1111-1111-111111111111', 5, timestamptz '2027-03-22 08:00:00-03');
grant select on gen1 to public;
select is((select count(*)::int from gen1), 1, 'el lunes 08:00 se genera el resumen de la organización');
select is((select semana_desde from gen1), date '2027-03-15', 'cubre la semana que terminó: desde el lunes anterior');
select is((select semana_hasta from gen1), date '2027-03-21', 'hasta el domingo');
select is(
  (select destinatarios from gen1), array['admin-uno@example.com']::text[],
  'destinatarios: solo el administrador activo (sin la baja personal, el suspendido ni el rol que no es administrador)'
);
select is((select estado from public.resumen_semanal_envios where id = (select resumen_id from gen1)), 'pendiente', 'queda pendiente y reservado');
select is((select intentos from public.resumen_semanal_envios where id = (select resumen_id from gen1)), 1, 'primer intento');
select is(
  (select count(*)::int from private.generar_resumen_semanal_en('11111111-1111-1111-1111-111111111111', 5, timestamptz '2027-03-22 08:00:30-03')),
  0, 'un segundo barrido simultáneo no lo toma (reserva de 2 minutos): no se duplica'
);

-- Cierre exitoso: enviado; no se reenvía ni se pisa.
select is(public.cerrar_resumen_semanal((select resumen_id from gen1), true), 'enviado', 'cierra como enviado');
select is(public.cerrar_resumen_semanal((select resumen_id from gen1), false, 'otro intento'), null, 'un cierre repetido no pisa un resumen enviado');
select is(
  (select count(*)::int from private.generar_resumen_semanal_en('11111111-1111-1111-1111-111111111111', 5, timestamptz '2027-03-23 10:00:00-03')),
  0, 'el martes no se vuelve a generar el de la semana ya enviada (idempotente por semana)'
);
select is((select count(*)::int from public.resumen_semanal_envios where organizacion_id = '11111111-1111-1111-1111-111111111111'), 1, 'un único registro por organización y semana');

-- ============================================================================
-- Fallo y reintento (RF-REP-08-5)
-- ============================================================================

create temp table gen2 as
  select * from private.generar_resumen_semanal_en('22222222-2222-2222-2222-222222222222', 3, timestamptz '2027-03-22 08:00:00-03');
grant select on gen2 to public;
select is(public.cerrar_resumen_semanal((select resumen_id from gen2), false, E'fallo con  ana@example.com\n en 10.0.0.1'), 'fallido', 'un envío fallido se registra como fallido');
select ok(
  (select ultimo_error is not null and length(ultimo_error) <= 500 and ultimo_error !~ E'\n' from public.resumen_semanal_envios where id = (select resumen_id from gen2)),
  'el error útil queda en una línea y acotado'
);
-- El reintento (otro barrido del lunes) reutiliza el MISMO registro y el mismo contenido: no crea otro resumen.
create temp table gen2b as
  select * from private.generar_resumen_semanal_en('22222222-2222-2222-2222-222222222222', 3, timestamptz '2027-03-22 08:15:00-03');
grant select on gen2b to public;
select is((select resumen_id from gen2b), (select resumen_id from gen2), 'el reintento reutiliza el mismo resumen');
select is((select contenido from gen2b), (select contenido from gen2), 'con el mismo contenido congelado');
select is((select intentos from public.resumen_semanal_envios where id = (select resumen_id from gen2)), 2, 'suma un intento');
select is((select count(*)::int from public.resumen_semanal_envios where organizacion_id = '22222222-2222-2222-2222-222222222222'), 1, 'sigue habiendo un solo registro de la semana');
-- Tope de 3 intentos: después de agotarlos no se retoma.
select public.cerrar_resumen_semanal((select resumen_id from gen2), false, 'otra vez');
select is((select count(*)::int from private.generar_resumen_semanal_en('22222222-2222-2222-2222-222222222222', 3, timestamptz '2027-03-22 08:30:00-03')), 1, 'el tercer intento todavía sale');
select public.cerrar_resumen_semanal((select resumen_id from gen2), false, 'agotado');
select is((select count(*)::int from private.generar_resumen_semanal_en('22222222-2222-2222-2222-222222222222', 3, timestamptz '2027-03-22 08:45:00-03')), 0, 'agotado el tope no se reintenta más');
select is((select estado from public.resumen_semanal_envios where id = (select resumen_id from gen2)), 'fallido', 'queda fallido con su error');

-- ============================================================================
-- Sin destinatarios y pausa (RF-REP-08-6)
-- ============================================================================

update public.usuarios_organizacion set estado = 'suspendido' where user_id = 'f3000000-0000-0000-0000-000000000001';
create temp table gen3 as
  select * from private.generar_resumen_semanal_en('33333333-3333-3333-3333-333333333333', 5, timestamptz '2027-03-22 08:00:00-03');
grant select on gen3 to public;
select is((select destinatarios from gen3), '{}'::text[], 'sin administradores activos: nada para enviar');
select is((select estado from public.resumen_semanal_envios where organizacion_id = '33333333-3333-3333-3333-333333333333'), 'sin_destinatario', 'queda registrado como sin destinatario');
update public.usuarios_organizacion set estado = 'activo' where user_id = 'f3000000-0000-0000-0000-000000000001';
select is(
  (select destinatarios from private.generar_resumen_semanal_en('33333333-3333-3333-3333-333333333333', 5, timestamptz '2027-03-22 09:00:00-03')),
  array['admin-tres@example.com']::text[], 'si aparece un administrador dentro de la ventana, el mismo registro se reevalúa y sale'
);

-- Pausa: lo pendiente deja de salir y no nace un resumen nuevo.
insert into public.resumen_semanal_config (organizacion_id, activo) values ('33333333-3333-3333-3333-333333333333', false);
select is((select count(*)::int from private.generar_resumen_semanal_en('33333333-3333-3333-3333-333333333333', 5, timestamptz '2027-03-22 09:30:00-03')), 0, 'pausado: no sale');
select is((select estado from public.resumen_semanal_envios where organizacion_id = '33333333-3333-3333-3333-333333333333'), 'pausado', 'y lo que estaba pendiente queda pausado');

-- ============================================================================
-- Configuración por administradores, con evento en Actividad (RF-REP-08-6)
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select is(public.configurar_resumen_semanal(false), false, 'el administrador pausa el resumen de su organización');
select is((select activo from public.estado_resumen_semanal()), false, 'estado: pausado');
reset role;
select is(
  (select count(*)::int from public.registro_actividad where tipo = 'resumen_semanal.pausado' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  1, 'el cambio queda en Actividad'
);
select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select is(public.configurar_resumen_semanal(false), false, 'repetir el mismo valor es idempotente');
reset role;
select is(
  (select count(*)::int from public.registro_actividad where tipo = 'resumen_semanal.pausado' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  1, 'y no suma otro evento');
select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select is(public.configurar_resumen_semanal(true), true, 'el administrador lo reanuda');
reset role;
select is(
  (select count(*)::int from public.registro_actividad where tipo = 'resumen_semanal.reanudado' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  1, 'la reanudación también queda en Actividad');
select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select is((select destinatarios from public.estado_resumen_semanal()), 1, 'estado: un destinatario (el administrador activo que no se dio de baja)');
select ok(
  (select extract(isodow from proximo_envio at time zone 'America/Argentina/Buenos_Aires') = 1
      and extract(hour from proximo_envio at time zone 'America/Argentina/Buenos_Aires') = 8
      and proximo_envio > now() from public.estado_resumen_semanal()),
  'el próximo envío es un lunes 08:00 de Buenos Aires, en el futuro'
);
select throws_ok($$select public.configurar_resumen_semanal(null)$$, '22023', null, 'sin valor, error claro');
reset role;

select is((select activo from public.resumen_semanal_config where organizacion_id = '11111111-1111-1111-1111-111111111111'), true, 'la configuración de Uno quedó activa');
select is((select activo from public.resumen_semanal_config where organizacion_id = '22222222-2222-2222-2222-222222222222'), null, 'el administrador de Uno no tocó la configuración de Dos (sigue sin fila = activo)');

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select throws_ok($$select public.configurar_resumen_semanal(false)$$, '42501', null, 'un rol que no es administrador no puede pausarlo');
select throws_ok($$select * from public.estado_resumen_semanal()$$, '42501', null, 'ni ver su estado');
reset role;

-- ============================================================================
-- Baja personal desde «Avisos por correo» (RF-REP-08-6): el tipo se ofrece solo a quien tiene la sección
-- `usuarios_permisos` (el administrador) y la preferencia apagada saca a esa persona de los destinatarios.
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select ok(
  exists (select 1 from public.listar_preferencias_aviso() where tipo = 'resumen_semanal' and activo),
  'el administrador ve «Resumen semanal» en sus avisos, encendido por defecto'
);
select is((select tipo from public.guardar_preferencia_aviso('resumen_semanal', false)), 'resumen_semanal', 'se da de baja con la RPC de preferencias existente');
reset role;
select is(private.destinatarios_resumen_semanal('11111111-1111-1111-1111-111111111111'), '{}'::text[], 'sin esa persona (y la otra ya de baja) la organización queda sin destinatarios');
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select ok(
  not exists (select 1 from public.listar_preferencias_aviso() where tipo = 'resumen_semanal'),
  'quien no es administrador no ve el tipo entre sus avisos'
);
select throws_ok($$select * from public.guardar_preferencia_aviso('resumen_semanal', false)$$, '42501', null, 'ni puede cambiarlo');
reset role;

select * from finish();
rollback;
