-- F-IA-01 (MSF-411) · FR-020, FR-023, FR-024, SC-006: el registro de las cuatro fuentes del asistente es completo, de solo
-- lectura e idempotente; el servidor MCP las lee con el filtro de organización dentro del SQL y con tope de 50 filas; y
-- las vistas no exponen datos sensibles (costos, márgenes, contactos del cliente). El registro de cada consulta en
-- `ia_interacciones` y en la ejecución MCP lo hacen el gateway del chat y el servidor MCP del template (no la base).
begin;

select plan(13);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador');

-- Registro (1-6)
select is(
  (select count(*)::int from public.features where id in ('catalogo', 'stock', 'precios', 'ventas')),
  4, 'las cuatro funcionalidades están registradas'
);
select is(
  (select count(*)::int from public.fuentes_chat_ia
    where (feature_id, vista) in (('catalogo', 'ia_consulta_catalogo'), ('stock', 'ia_consulta_stock'),
                                  ('precios', 'ia_consulta_precios'), ('ventas', 'ia_consulta_ventas'))),
  4, 'el chat tiene una vista por funcionalidad'
);
select is(
  (select count(*)::int from public.fuentes_mcp
    where (feature_id, vista) in (('catalogo', 'ia_consulta_catalogo'), ('stock', 'ia_consulta_stock'),
                                  ('precios', 'ia_consulta_precios'), ('ventas', 'ia_consulta_ventas'))),
  4, 'MCP tiene una vista por funcionalidad'
);
select is(
  (select count(*)::int from (
     select feature_id from public.fuentes_mcp where feature_id in ('catalogo', 'stock', 'precios', 'ventas')
     group by feature_id having count(*) <> 1) x),
  0, 'cada funcionalidad tiene UNA sola vista en MCP (mcp_leer_fila usa limit 1)'
);
select is(
  (select count(*)::int from public.capacidades_chat_ia
    where feature_id in ('catalogo', 'stock', 'precios', 'ventas') and lectura and not ejecucion),
  4, 'chat: lectura sí, ejecución no'
);
select is(
  (select count(*)::int from public.capacidades_mcp
    where feature_id in ('catalogo', 'stock', 'precios', 'ventas') and lectura and not ejecucion),
  4, 'MCP: lectura sí, ejecución no'
);

-- Idempotencia (7-8)
create temp table antes as
  select (select count(*) from public.fuentes_mcp) as fuentes,
         (select max(actualizado_en) from public.capacidades_mcp where feature_id in ('catalogo', 'stock', 'precios', 'ventas')) as ultima;
select private.registrar_fuentes_ia_consulta();
select is(
  (select count(*) from public.fuentes_mcp), (select fuentes from antes),
  'una segunda corrida no duplica fuentes'
);
select is(
  (select max(actualizado_en) from public.capacidades_mcp where feature_id in ('catalogo', 'stock', 'precios', 'ventas')),
  (select ultima from antes), 'una segunda corrida no cambia la fecha de actualización existente'
);

-- Sin datos sensibles (9)
select is(
  (select count(*)::int from pg_attribute a
    where a.attrelid in ('public.ia_consulta_catalogo'::regclass, 'public.ia_consulta_stock'::regclass,
                         'public.ia_consulta_precios'::regclass, 'public.ia_consulta_ventas'::regclass)
      and a.attnum > 0 and not a.attisdropped
      and a.attname ~* '(costo|margen|cliente|contacto|mail|telefono|iva_|tarjeta|clave)'),
  0, 'ninguna vista expone costos, márgenes ni datos del cliente'
);

-- Lectura MCP (10-13)
insert into public.features (id, nombre) values ('mcp-servidor', 'Servidor MCP') on conflict do nothing;

select throws_ok(
  $$select private.mcp_leer_fila('11111111-1111-1111-1111-111111111111', 'catalogo')$$,
  '42501', null, 'sin la funcionalidad habilitada para la organización, MCP no lee'
);

insert into public.organizaciones_features (feature_id, organizacion_id, habilitado_por) values
  ('mcp-servidor', '11111111-1111-1111-1111-111111111111', 'd1000000-0000-0000-0000-000000000001'),
  ('catalogo', '11111111-1111-1111-1111-111111111111', 'd1000000-0000-0000-0000-000000000001')
on conflict do nothing;

insert into dominio.productos (organizacion_id, nombre, sku, moneda, precio_lista) values
  ('11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 'USD', 100),
  ('11111111-1111-1111-1111-111111111111', 'Cable', 'CAB-1', 'ARS', 10),
  ('22222222-2222-2222-2222-222222222222', 'Teclado de otra org', 'TEC-1', 'ARS', 50);

select is(
  jsonb_array_length(private.mcp_leer_fila('11111111-1111-1111-1111-111111111111', 'catalogo')),
  2, 'MCP devuelve los productos de la organización'
);
select is(
  (select bool_and((e ->> 'organizacion_id')::uuid = '11111111-1111-1111-1111-111111111111')
     from jsonb_array_elements(private.mcp_leer_fila('11111111-1111-1111-1111-111111111111', 'catalogo')) e),
  true, 'todas las filas son de la organización de la sesión'
);

insert into dominio.productos (organizacion_id, nombre, sku, moneda, precio_lista)
select '11111111-1111-1111-1111-111111111111', 'Producto ' || n, 'BULK-' || n, 'ARS', 10
  from generate_series(1, 51) n;

select is(
  jsonb_array_length(private.mcp_leer_fila('11111111-1111-1111-1111-111111111111', 'catalogo')),
  50, 'con 53 productos, la consulta devuelve como máximo 50 filas (D-8)'
);

select * from finish();
rollback;
