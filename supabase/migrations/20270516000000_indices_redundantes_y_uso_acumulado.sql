-- MSF-920 (lote 101): retira los índices btree no únicos cuyas columnas son prefijo exacto de otro índice btree de la misma
-- tabla (mismas clases de operador, orden y predicado, sin expresiones) y que no respaldan ninguna constraint. Un índice así no
-- da ningún camino de acceso que el otro no dé, y encarece cada escritura. Casi todos son índices de una sola columna anteriores
-- a los `*_fk_idx` compuestos (columna, organizacion_id) del lote 33 (MSF-918), que los cubren como prefijo.
--
-- NO se tocan: únicos, PK, índices de constraint (ni los de FK: el prefijo del que los cubre sigue sirviendo a la FK), los GIN/trigram
-- (`productos_nombre_trgm_idx` y `productos_nombre_busqueda_trgm` los usan consultas distintas; ver docs/higiene-base-datos.md) y
-- los de expresión. Lo que solo se decide con el uso real de DEV (idx_scan) queda documentado, no migrado.
--
-- Además deja la telemetría de uso que pedía el ticket: los contadores de pg_stat_user_indexes se pierden cuando se recrea el
-- stack, así que `private.registrar_uso_indices()` los acumula en una tabla (que sí persiste). Detalle de operación en
-- docs/higiene-base-datos.md.
--
-- Reversión (migración posterior; recrea los índices retirados, cada uno es una sola sentencia):
--   create index if not exists avisos_pendientes_user_id_idx ON public.avisos_pendientes USING btree (user_id);
--   create index if not exists categorias_tienda_categoria_idx ON dominio.categorias_tienda USING btree (categoria_id);
--   create index if not exists clientes_organizacion_id_idx ON dominio.clientes USING btree (organizacion_id);
--   create index if not exists comprobantes_venta_lineas_deposito_idx ON dominio.comprobantes_venta_lineas USING btree (deposito_id);
--   create index if not exists comprobantes_venta_lineas_producto_idx ON dominio.comprobantes_venta_lineas USING btree (producto_id);
--   create index if not exists conexiones_oauth_organizacion_id_idx ON public.conexiones_oauth USING btree (organizacion_id);
--   create index if not exists contrarreembolsos_transporte_idx ON dominio.contrarreembolsos USING btree (transporte_id);
--   create index if not exists existencias_deposito_deposito_idx ON dominio.existencias_deposito USING btree (deposito_id);
--   create index if not exists existencias_deposito_organizacion_idx ON dominio.existencias_deposito USING btree (organizacion_id);
--   create index if not exists existencias_variante_deposito_idx ON dominio.existencias_variante USING btree (deposito_id);
--   create index if not exists faltantes_avisos_cliente_idx ON dominio.faltantes_avisos USING btree (cliente_id);
--   create index if not exists faltantes_avisos_empresa_idx ON dominio.faltantes_avisos USING btree (empresa_id);
--   create index if not exists faltantes_avisos_organizacion_idx ON dominio.faltantes_avisos USING btree (organizacion_id);
--   create index if not exists historial_cobros_org_comprobante_idx ON dominio.historial_cobros USING btree (organizacion_id, empresa_id, comprobante_numero);
--   create index if not exists ingresos_mercaderia_lineas_ingreso_idx ON dominio.ingresos_mercaderia_lineas USING btree (ingreso_id);
--   create index if not exists intereses_whatsapp_producto_id_idx ON dominio.intereses_whatsapp USING btree (producto_id);
--   create index if not exists movimientos_stock_deposito_idx ON dominio.movimientos_stock USING btree (deposito_id);
--   create index if not exists ordenes_compra_items_orden_idx ON dominio.ordenes_compra_items USING btree (orden_id);
--   create index if not exists producto_precios_escala_organizacion_idx ON dominio.producto_precios_escala USING btree (organizacion_id);
--   create index if not exists productos_tienda_producto_idx ON dominio.productos_tienda USING btree (producto_id);
--   create index if not exists proveedor_capacidad_organizacion_organizacion_id_idx ON public.proveedor_capacidad_organizacion USING btree (organizacion_id);
--   create index if not exists reparaciones_cliente_idx ON dominio.reparaciones USING btree (cliente_id);
--   create index if not exists reparaciones_modelo_idx ON dominio.reparaciones USING btree (modelo_id);
--   create index if not exists reparaciones_org_empresa_idx ON dominio.reparaciones USING btree (organizacion_id, empresa_id);
--   create index if not exists reservas_stock_deposito_idx ON dominio.reservas_stock USING btree (deposito_id);
--   create index if not exists rma_comprobante_idx ON dominio.rma USING btree (comprobante_id);
--   create index if not exists rma_empresa_idx ON dominio.rma USING btree (empresa_id);
--   create index if not exists rma_items_linea_idx ON dominio.rma_items USING btree (comprobante_linea_id);
--   create index if not exists rma_items_producto_idx ON dominio.rma_items USING btree (producto_id);
--   create index if not exists rma_items_rma_idx ON dominio.rma_items USING btree (rma_id);
--   create index if not exists transiciones_estado_comprobante_org_idx ON dominio.transiciones_estado_comprobante USING btree (organizacion_id, tipo, estado_desde);
--   y para la telemetría: drop function if exists private.registrar_uso_indices(); drop table if exists private.uso_indices_acumulado;
--   drop function if exists private.indices_redundantes();

-- Fuente única de la definición de «redundante» (la usa la prueba pgTAP: si alguien vuelve a crear un índice cubierto, falla).
create or replace function private.indices_redundantes()
returns table (esquema text, tabla text, indice text, cubierto_por text)
language sql
stable
set search_path = ''
as $$
  with ix as (
    select i.indexrelid, i.indrelid, c.relname as idx, n.nspname as sch, t.relname as tab,
           i.indisunique, i.indisprimary, i.indnatts,
           i.indkey::text as kt, i.indclass::text as ct, i.indoption::text as ot,
           coalesce(pg_catalog.pg_get_expr(i.indpred, i.indrelid), '') as pred,
           coalesce(pg_catalog.pg_get_expr(i.indexprs, i.indrelid), '') as ex,
           exists (select 1 from pg_catalog.pg_constraint k where k.conindid = i.indexrelid) as por_constraint
      from pg_catalog.pg_index i
      join pg_catalog.pg_class c on c.oid = i.indexrelid
      join pg_catalog.pg_class t on t.oid = i.indrelid
      join pg_catalog.pg_namespace n on n.oid = t.relnamespace
      join pg_catalog.pg_am am on am.oid = c.relam
     where n.nspname in ('public', 'dominio') and i.indisvalid and am.amname = 'btree'
  )
  select a.sch, a.tab, a.idx, b.idx
    from ix a
    join ix b on a.indrelid = b.indrelid and a.indexrelid <> b.indexrelid
   where not a.indisunique and not a.indisprimary and not a.por_constraint
     and a.ex = '' and b.ex = '' and a.pred = b.pred
     and (b.kt = a.kt or b.kt like a.kt || ' %')
     and (b.ct = a.ct or b.ct like a.ct || ' %')
     and (b.ot = a.ot or b.ot like a.ot || ' %')
     and (a.indnatts < b.indnatts
          or (a.indnatts = b.indnatts and (b.indisunique or b.indisprimary or a.indexrelid > b.indexrelid)))
$$;
revoke all on function private.indices_redundantes() from public, anon, authenticated;
comment on function private.indices_redundantes() is
  'MSF-920: índices btree no únicos de public/dominio cuyas columnas son prefijo de otro. Uso: select * from private.indices_redundantes().';

drop index if exists public.avisos_pendientes_user_id_idx;
drop index if exists dominio.categorias_tienda_categoria_idx;
drop index if exists dominio.clientes_organizacion_id_idx;
drop index if exists dominio.comprobantes_venta_lineas_deposito_idx;
drop index if exists dominio.comprobantes_venta_lineas_producto_idx;
drop index if exists public.conexiones_oauth_organizacion_id_idx;
drop index if exists dominio.contrarreembolsos_transporte_idx;
drop index if exists dominio.existencias_deposito_deposito_idx;
drop index if exists dominio.existencias_deposito_organizacion_idx;
drop index if exists dominio.existencias_variante_deposito_idx;
drop index if exists dominio.faltantes_avisos_cliente_idx;
drop index if exists dominio.faltantes_avisos_empresa_idx;
drop index if exists dominio.faltantes_avisos_organizacion_idx;
drop index if exists dominio.historial_cobros_org_comprobante_idx;
drop index if exists dominio.ingresos_mercaderia_lineas_ingreso_idx;
drop index if exists dominio.intereses_whatsapp_producto_id_idx;
drop index if exists dominio.movimientos_stock_deposito_idx;
drop index if exists dominio.ordenes_compra_items_orden_idx;
drop index if exists dominio.producto_precios_escala_organizacion_idx;
drop index if exists dominio.productos_tienda_producto_idx;
drop index if exists public.proveedor_capacidad_organizacion_organizacion_id_idx;
drop index if exists dominio.reparaciones_cliente_idx;
drop index if exists dominio.reparaciones_modelo_idx;
drop index if exists dominio.reparaciones_org_empresa_idx;
drop index if exists dominio.reservas_stock_deposito_idx;
drop index if exists dominio.rma_comprobante_idx;
drop index if exists dominio.rma_empresa_idx;
drop index if exists dominio.rma_items_linea_idx;
drop index if exists dominio.rma_items_producto_idx;
drop index if exists dominio.rma_items_rma_idx;
drop index if exists dominio.transiciones_estado_comprobante_org_idx;

-- Telemetría de uso de índices que sobrevive al recreate de la base (los contadores de pg_stat_user_indexes no).
create table if not exists private.uso_indices_acumulado (
  esquema text not null,
  tabla text not null,
  indice text not null,
  escaneos_acumulados bigint not null default 0 check (escaneos_acumulados >= 0),
  ultimo_contador bigint not null default 0 check (ultimo_contador >= 0),
  primera_vez timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  primary key (esquema, indice)
);
alter table private.uso_indices_acumulado enable row level security;
revoke all on private.uso_indices_acumulado from public, anon, authenticated;
-- Política que deniega todo (convención de MSF-918: toda tabla con RLS tiene una política explícita); solo la usan funciones definer.
drop policy if exists uso_indices_acumulado_denegar_todo on private.uso_indices_acumulado;
create policy uso_indices_acumulado_denegar_todo on private.uso_indices_acumulado
  for all to anon, authenticated using (false) with check (false);

-- Suma al acumulado el incremento del contador desde la última lectura; si el contador bajó (reset de estadísticas o recreate sin
-- persistir) se toma el valor actual completo como incremento. Devuelve cuántos índices registró. Es idempotente por llamada.
create or replace function private.registrar_uso_indices()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  insert into private.uso_indices_acumulado as u (esquema, tabla, indice, escaneos_acumulados, ultimo_contador)
  select s.schemaname, s.relname, s.indexrelname, s.idx_scan, s.idx_scan
    from pg_catalog.pg_stat_user_indexes s
   where s.schemaname in ('public', 'dominio')
  on conflict (esquema, indice) do update
     set escaneos_acumulados = u.escaneos_acumulados
           + case when excluded.ultimo_contador >= u.ultimo_contador
                  then excluded.ultimo_contador - u.ultimo_contador else excluded.ultimo_contador end,
         ultimo_contador = excluded.ultimo_contador,
         tabla = excluded.tabla,
         actualizado_en = now();
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function private.registrar_uso_indices() from public, anon, authenticated;
comment on function private.registrar_uso_indices() is
  'MSF-920: acumula idx_scan de public/dominio en private.uso_indices_acumulado; correr antes de cada recreate y periódicamente.';
