-- F-MIG-04 (MSF-343, épica MSF-142): ENSAYO COMPLETO de la migración inicial con datos inventados.
-- Cubre FR-041 (procedimiento repetible, conciliado, que deja evidencia), FR-042 / SC-004 (dos
-- corridas dan el mismo resultado sin duplicados), SC-001…SC-003 (clientes, proveedores y vínculos,
-- archivo de ingresos sin tocar el stock) y SC-006 (aislamiento por organización).
--
-- Sigue el orden del plan de corte (docs/migracion-inicial-de-datos.md):
--   clientes → proveedores → vínculos proveedor↔producto → archivo de ingresos,
-- y por cada entidad: iniciar carga → aplicar lote → cerrar → informe de conciliación.
-- La evidencia del ensayo es el informe de cada carga; el test lo imprime como diagnóstico (# ...).
-- Solo datos sintéticos: ningún dato real en git (FR-012).
begin;

select plan(17);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001', 'admin-uno-migens@example.com'),
  ('e2000000-0000-0000-0000-000000000001', 'admin-dos-migens@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

-- Catálogo previo (lo migra Catálogo; el ensayo solo vincula).
insert into dominio.productos (organizacion_id, nombre, sku, precio_lista) values
  ('11111111-1111-1111-1111-111111111111', 'Producto A Sintético', 'SKU-A', 10),
  ('11111111-1111-1111-1111-111111111111', 'Producto B Sintético', 'SKU-B', 10);

create temporary table t_res (k text primary key, v jsonb);
grant all on t_res to authenticated, anon;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Archivos de origen inventados: cada uno trae una fila inválida a propósito.
insert into t_res values
  ('clientes', '[{"fila":2,"id_externo":"ENS-CLI-1","nombre":"Cliente Ensayo Uno"},
                 {"fila":3,"id_externo":"ENS-CLI-2","nombre":"Cliente Ensayo Dos","tipo":"mayorista"},
                 {"fila":4,"id_externo":"ENS-CLI-3","nombre":""}]'::jsonb),
  ('proveedores', '[{"fila":2,"id_externo":"ENS-PRV-1","razon_social":"Proveedor Ensayo Uno SRL","cuit":"30-90000011-8"},
                    {"fila":3,"id_externo":"ENS-PRV-2","razon_social":"Proveedor Ensayo Dos SRL","cuit":"30900000126"},
                    {"fila":4,"id_externo":"ENS-PRV-3","razon_social":"CUIT malo","cuit":"30900000119"}]'::jsonb),
  ('vinculos', '[{"fila":2,"sku":"SKU-A","proveedor_id_externo":"ENS-PRV-1","codigo_proveedor":"COD-A"},
                 {"fila":3,"sku":"SKU-B","proveedor_id_externo":"ENS-PRV-2"},
                 {"fila":4,"sku":"SKU-INEXISTENTE","proveedor_id_externo":"ENS-PRV-1"}]'::jsonb),
  ('ingresos', '[{"fila":2,"id_externo":"ENS-ING-1","fecha":"2026-03-15","producto":"Producto A Sintético","cantidad":"5","proveedor":"Proveedor Ensayo Uno SRL","operador":"Operador Uno"},
                 {"fila":3,"id_externo":"ENS-ING-2","fecha":"16/03/2026","producto":"Producto B Sintético","cantidad":"2"},
                 {"fila":4,"id_externo":"ENS-ING-3","fecha":"2026-03-17","producto":"Producto B Sintético","cantidad":"0"}]'::jsonb);

-- Estado del stock vivo antes del ensayo (el archivo no lo toca, FR-032).
insert into t_res
select 'stock_antes', jsonb_build_object(
  'existencias', (select count(*) from dominio.existencias),
  'movimientos', (select count(*) from dominio.movimientos_stock),
  'ingresos', (select count(*) from dominio.ingresos_mercaderia)
);

-- Una corrida completa del procedimiento: devuelve los 4 informes (sin ids ni fechas, que cambian
-- entre corridas) y los deja en t_res como evidencia.
create function pg_temp.corrida(p_tag text) returns jsonb language plpgsql as $$
declare
  v_entidad text;
  v_lote text;
  v_rpc text;
  v_carga uuid;
  v_informe jsonb;
  v_resultado jsonb := '{}'::jsonb;
begin
  perform pg_temp.como('e1000000-0000-0000-0000-000000000001');
  for v_entidad, v_lote, v_rpc in
    select * from (values
      ('clientes', 'clientes', 'aplicar_lote_clientes'),
      ('proveedores', 'proveedores', 'aplicar_lote_proveedores'),
      ('vinculos_proveedor_producto', 'vinculos', 'aplicar_lote_vinculos_proveedor_producto'),
      ('ingresos_archivo', 'ingresos', 'aplicar_lote_archivo_ingresos')
    ) as t (entidad, lote, rpc)
  loop
    v_carga := public.iniciar_carga_migracion(
      v_entidad, 'ensayo-' || v_lote || '.csv', jsonb_array_length((select v from t_res where k = v_lote))
    );
    case v_rpc
      when 'aplicar_lote_clientes' then
        perform public.aplicar_lote_clientes(v_carga, 1, (select v from t_res where k = v_lote));
      when 'aplicar_lote_proveedores' then
        perform public.aplicar_lote_proveedores(v_carga, 1, (select v from t_res where k = v_lote));
      when 'aplicar_lote_vinculos_proveedor_producto' then
        perform public.aplicar_lote_vinculos_proveedor_producto(v_carga, 1, (select v from t_res where k = v_lote));
      else
        perform public.aplicar_lote_archivo_ingresos(v_carga, 1, (select v from t_res where k = v_lote));
    end case;
    perform public.cerrar_carga_migracion(v_carga);
    v_informe := public.informe_conciliacion_migracion(v_carga) - 'carga' - 'creada_en' - 'cerrada_en';
    v_resultado := v_resultado || jsonb_build_object(v_entidad, v_informe);
  end loop;
  reset role;
  insert into t_res values (p_tag, v_resultado);
  return v_resultado;
end $$;

-- ============================================================================
-- Corrida 1 (la primera carga)
-- ============================================================================

select lives_ok($$select pg_temp.corrida('corrida1')$$, 'corrida 1: el procedimiento completo termina sin error');

select is(
  (select jsonb_build_array(
      v -> 'clientes' -> 'cargado', v -> 'clientes' -> 'conciliado',
      v -> 'proveedores' -> 'cargado', v -> 'proveedores' -> 'conciliado')
     from t_res where k = 'corrida1'),
  '[{"nuevos": 2, "actualizados": 0, "con_error": 1, "omitidos": 0}, true,
    {"nuevos": 2, "actualizados": 0, "con_error": 1, "omitidos": 0}, true]'::jsonb,
  'corrida 1: clientes y proveedores cargan 2 + 1 con error y concilian (SC-001, SC-002)'
);
select is(
  (select jsonb_build_array(
      v -> 'vinculos_proveedor_producto' -> 'cargado', v -> 'vinculos_proveedor_producto' -> 'conciliado',
      v -> 'ingresos_archivo' -> 'cargado', v -> 'ingresos_archivo' -> 'conciliado')
     from t_res where k = 'corrida1'),
  '[{"nuevos": 2, "actualizados": 0, "con_error": 1, "omitidos": 0}, true,
    {"nuevos": 2, "actualizados": 0, "con_error": 1, "omitidos": 0}, true]'::jsonb,
  'corrida 1: vínculos e ingresos cargan 2 + 1 con error y concilian (SC-002, SC-003)'
);
select is(
  (select jsonb_agg(e.x -> 'diferencia') from t_res r, jsonb_each(r.v) as e (k, x) where r.k = 'corrida1'),
  '[0, 0, 0, 0]'::jsonb,
  'corrida 1: la diferencia calculada por el sistema es 0 en las 4 entidades'
);

-- Evidencia del ensayo para el PR (FR-041): el informe de cada entidad.
select diag('EVIDENCIA corrida 1: ' || jsonb_pretty((select v from t_res where k = 'corrida1')));

-- ============================================================================
-- Estado final tras la corrida 1
-- ============================================================================

select is(
  (select count(*) from public.clientes where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  2::bigint, 'quedan 2 clientes'
);
select is(
  (select count(*) from dominio.proveedores where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  2::bigint, 'quedan 2 proveedores'
);
select is(
  (select array_agg(p.sku || ':' || pr.id_externo || ':' || coalesce(p.codigo_proveedor, '-') order by p.sku)
     from dominio.productos p join dominio.proveedores pr on pr.id = p.proveedor_id
    where p.organizacion_id = '11111111-1111-1111-1111-111111111111'),
  array['SKU-A:ENS-PRV-1:COD-A', 'SKU-B:ENS-PRV-2:-'],
  'los productos quedan vinculados a su proveedor'
);
select is(
  (select count(*) from dominio.archivo_ingresos_mercaderia where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  2::bigint, 'el archivo de ingresos tiene 2 líneas'
);

-- ============================================================================
-- Corrida 2 (SC-004): el mismo procedimiento sobre los mismos archivos no duplica nada
-- ============================================================================

select lives_ok($$select pg_temp.corrida('corrida2')$$, 'corrida 2: el procedimiento completo termina sin error');

select is(
  (select jsonb_agg(e.x -> 'cargado' order by e.k) from t_res r, jsonb_each(r.v) as e (k, x) where r.k = 'corrida2'),
  '[{"nuevos": 0, "actualizados": 2, "con_error": 1, "omitidos": 0},
    {"nuevos": 0, "actualizados": 2, "con_error": 1, "omitidos": 0},
    {"nuevos": 0, "actualizados": 2, "con_error": 1, "omitidos": 0},
    {"nuevos": 0, "actualizados": 2, "con_error": 1, "omitidos": 0}]'::jsonb,
  'corrida 2: todo lo válido se actualiza, nada se crea de nuevo y los errores son los mismos'
);
select is(
  (select jsonb_agg(e.x -> 'conciliado') from t_res r, jsonb_each(r.v) as e (k, x) where r.k = 'corrida2'),
  '[true, true, true, true]'::jsonb,
  'corrida 2: las 4 entidades concilian sin diferencias'
);
select is(
  (select jsonb_agg(e.x -> 'errores' order by e.k) from t_res r, jsonb_each(r.v) as e (k, x) where r.k = 'corrida2'),
  (select jsonb_agg(e.x -> 'errores' order by e.k) from t_res r, jsonb_each(r.v) as e (k, x) where r.k = 'corrida1'),
  'corrida 2: los errores por fila son idénticos a los de la corrida 1'
);
select diag('EVIDENCIA corrida 2: ' || jsonb_pretty((select v from t_res where k = 'corrida2')));

select is(
  (select jsonb_build_array(
      (select count(*) from public.clientes where organizacion_id = '11111111-1111-1111-1111-111111111111'),
      (select count(*) from dominio.proveedores where organizacion_id = '11111111-1111-1111-1111-111111111111'),
      (select count(*) from dominio.archivo_ingresos_mercaderia where organizacion_id = '11111111-1111-1111-1111-111111111111'))),
  '[2, 2, 2]'::jsonb,
  'tras dos corridas no hay duplicados: 2 clientes, 2 proveedores, 2 líneas de archivo'
);
select is(
  (select count(*) from public.clientes_identificadores_externos v
     join public.clientes c on c.id = v.cliente_id
    where c.organizacion_id = '11111111-1111-1111-1111-111111111111' and v.sistema = 'panel_actual'),
  2::bigint,
  'tras dos corridas cada cliente tiene un solo vínculo con el panel actual'
);

-- ============================================================================
-- Stock intacto, registro de cargas y aislamiento
-- ============================================================================

select is(
  (select jsonb_build_object(
     'existencias', (select count(*) from dominio.existencias),
     'movimientos', (select count(*) from dominio.movimientos_stock),
     'ingresos', (select count(*) from dominio.ingresos_mercaderia))),
  (select v from t_res where k = 'stock_antes'),
  'el ensayo no modificó existencias, movimientos ni ingresos vivos (SC-003)'
);

select is(
  (select count(*) from public.migracion_cargas where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  8::bigint,
  'cada corrida deja su registro de carga: 4 entidades × 2 corridas'
);

select pg_temp.como('e2000000-0000-0000-0000-000000000001');
select is(
  (select jsonb_build_array(
      (select count(*) from public.clientes),
      (select count(*) from dominio.proveedores),
      (select count(*) from dominio.archivo_ingresos_mercaderia),
      (select count(*) from public.migracion_cargas))),
  '[0, 0, 0, 0]'::jsonb,
  'otra organización no ve clientes, proveedores, archivo ni cargas del ensayo (SC-006)'
);
reset role;

select * from finish();
rollback;
