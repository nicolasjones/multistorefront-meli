-- MSF-920 (lote 101): índices redundantes retirados + detector + telemetría de uso acumulado.
begin;

select plan(13);

-- 1. Lista independiente de la migración: ninguno de los 31 índices retirados existe.
select is(
  (select count(*)::int from pg_indexes where schemaname || '.' || indexname in ('public.avisos_pendientes_user_id_idx','dominio.categorias_tienda_categoria_idx','dominio.clientes_organizacion_id_idx','dominio.comprobantes_venta_lineas_deposito_idx','dominio.comprobantes_venta_lineas_producto_idx','public.conexiones_oauth_organizacion_id_idx','dominio.contrarreembolsos_transporte_idx','dominio.existencias_deposito_deposito_idx','dominio.existencias_deposito_organizacion_idx','dominio.existencias_variante_deposito_idx','dominio.faltantes_avisos_cliente_idx','dominio.faltantes_avisos_empresa_idx','dominio.faltantes_avisos_organizacion_idx','dominio.historial_cobros_org_comprobante_idx','dominio.ingresos_mercaderia_lineas_ingreso_idx','dominio.intereses_whatsapp_producto_id_idx','dominio.movimientos_stock_deposito_idx','dominio.ordenes_compra_items_orden_idx','dominio.producto_precios_escala_organizacion_idx','dominio.productos_tienda_producto_idx','public.proveedor_capacidad_organizacion_organizacion_id_idx','dominio.reparaciones_cliente_idx','dominio.reparaciones_modelo_idx','dominio.reparaciones_org_empresa_idx','dominio.reservas_stock_deposito_idx','dominio.rma_comprobante_idx','dominio.rma_empresa_idx','dominio.rma_items_linea_idx','dominio.rma_items_producto_idx','dominio.rma_items_rma_idx','dominio.transiciones_estado_comprobante_org_idx')),
  0, 'los 31 índices redundantes retirados ya no existen');

-- 2. Con el esquema real no queda ningún índice cubierto por otro (guarda contra reintroducirlos).
select is((select count(*)::int from private.indices_redundantes()), 0,
  'ningún índice btree no único de public/dominio es prefijo de otro');

-- 3. El detector detecta (tabla temporal real en public, dentro de la transacción).
create table public.zz_idx_prueba (a int not null, b int not null, c int, d int);
create index zz_a_idx on public.zz_idx_prueba (a);
create index zz_ab_idx on public.zz_idx_prueba (a, b);
create unique index zz_c_uq on public.zz_idx_prueba (c);
create index zz_c_parcial on public.zz_idx_prueba (c) where c > 0;
create index zz_d_desc on public.zz_idx_prueba (d desc);
create index zz_d_asc on public.zz_idx_prueba (d);
create index zz_expr on public.zz_idx_prueba ((a + 1));
create index zz_expr_dup on public.zz_idx_prueba ((a + 1), b);
create index zz_gin_a on public.zz_idx_prueba using hash (a);

select results_eq(
  $q$ select indice, cubierto_por from private.indices_redundantes() where tabla = 'zz_idx_prueba' order by 1 $q$,
  $q$ values ('zz_a_idx'::text, 'zz_ab_idx'::text) $q$,
  'solo el índice (a) cubierto por (a, b) se reporta; único, parcial vs total, orden distinto, expresión y hash no');

-- Dos índices idénticos: se reporta exactamente uno (el de oid mayor), no ambos.
create index zz_b1 on public.zz_idx_prueba (b);
create index zz_b2 on public.zz_idx_prueba (b);
select is((select count(*)::int from private.indices_redundantes() where tabla = 'zz_idx_prueba' and indice in ('zz_b1', 'zz_b2')), 1,
  'dos índices idénticos: se reporta uno solo');

-- Un índice de constraint única no se reporta aunque otro lo cubra.
alter table public.zz_idx_prueba add constraint zz_b_unica unique (d, c);
select is((select count(*)::int from private.indices_redundantes() where indice = 'zz_b_unica'), 0,
  'un índice que respalda una constraint no se reporta');

-- 4. Telemetría acumulada.
select is(private.registrar_uso_indices() > 100, true, 'registra los índices de public y dominio');
select is((select count(*)::int from private.uso_indices_acumulado where esquema not in ('public', 'dominio')), 0,
  'solo registra public y dominio');

-- Incremento normal: el contador actual (X) es mayor o igual que el último leído (0): acumulado = 7 + X.
update private.uso_indices_acumulado set escaneos_acumulados = 7, ultimo_contador = 0
 where esquema = 'dominio' and indice = 'clientes_pkey';
select private.registrar_uso_indices();
select is(
  (select escaneos_acumulados from private.uso_indices_acumulado where esquema = 'dominio' and indice = 'clientes_pkey'),
  7 + (select idx_scan from pg_stat_user_indexes where schemaname = 'dominio' and indexrelname = 'clientes_pkey'),
  'el acumulado suma el incremento del contador');

-- Reset de contadores: el último leído (1e12) es mayor que el actual: se toma el actual completo, no un delta negativo.
update private.uso_indices_acumulado set escaneos_acumulados = 10, ultimo_contador = 1000000000000
 where esquema = 'dominio' and indice = 'clientes_pkey';
select private.registrar_uso_indices();
select is(
  (select escaneos_acumulados from private.uso_indices_acumulado where esquema = 'dominio' and indice = 'clientes_pkey'),
  10 + (select idx_scan from pg_stat_user_indexes where schemaname = 'dominio' and indexrelname = 'clientes_pkey'),
  'tras un reset de contadores suma el valor actual completo');

-- Frontera: contador igual al último leído suma 0 (n = ultimo).
update private.uso_indices_acumulado u set escaneos_acumulados = 50,
       ultimo_contador = (select idx_scan from pg_stat_user_indexes s where s.schemaname = 'dominio' and s.indexrelname = 'clientes_pkey')
 where esquema = 'dominio' and indice = 'clientes_pkey';
select private.registrar_uso_indices();
select is((select escaneos_acumulados from private.uso_indices_acumulado where esquema = 'dominio' and indice = 'clientes_pkey'), 50::bigint,
  'contador sin cambios: el acumulado no se mueve');

-- 5. Privilegios: ni anon ni authenticated pueden ejecutar ni leer.
set local role authenticated;
select throws_ok($$select private.registrar_uso_indices()$$, '42501', 'permission denied for function registrar_uso_indices',
  'authenticated no ejecuta registrar_uso_indices');
reset role;
set local role anon;
select throws_ok($$select * from private.indices_redundantes()$$, '42501', 'permission denied for schema private',
  'anon no ejecuta indices_redundantes');
reset role;
select is((select relrowsecurity from pg_class where oid = 'private.uso_indices_acumulado'::regclass), true,
  'la tabla de uso acumulado tiene RLS activado');

select * from finish();
rollback;
