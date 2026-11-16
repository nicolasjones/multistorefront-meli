-- F-GAS-03 (MSF-469), tarea T017: bandera `margen_costos_fijos` y vistas de apoyo de la medida «margen después de costos fijos».
--
-- Esquema (Principio VII, re-verificado): la fila de la bandera es un dato de plataforma → `public.banderas_plataforma`
-- (existente; no se altera su estructura). `analitica` solo recibe vistas y una función de apoyo: SIN tablas nuevas, así que
-- `rls_en_toda_tabla` no cambia. Se leen `dominio.gastos`, `dominio.comprobantes_venta`, `dominio.comprobantes_venta_lineas` y
-- `dominio.empresas`; ninguna se altera.
--
-- Bandera (D15, RF-GAS-10): `margen_costos_fijos`, APAGADA por defecto (`on conflict do nothing`: encender no se pisa al
-- reaplicar). Se enciende por SQL del equipo técnico, dev → stg → prd:
--   update public.banderas_plataforma set activa = true  where clave = 'margen_costos_fijos';
--   update public.banderas_plataforma set activa = false where clave = 'margen_costos_fijos';   -- reversión inmediata, sin migrar
--
-- `analitica.bandera_activa(text)` (RF-GAS-10): true solo si la clave existe y está encendida (lo desconocido está apagado). La
-- ejecuta SOLO `superset_analitica` (y las vistas, que corren con los privilegios de su dueño); `anon` y `authenticated` no.
--
-- Vistas (RF-GAS-11), todas gateadas por la bandera: con la bandera APAGADA no devuelven filas (defensa en profundidad: ni
-- siquiera el total de fijos por empresa y mes llega a Superset hasta que se enciende). Sin la bandera, nada nuevo se ve.
--   · `analitica.costos_fijos_empresa_mes`: Σ `importe_pesos` de los gastos FIJOS vigentes (no anulados) por organización ×
--     empresa × mes calendario de la `fecha` del gasto (D5). NO expone detalle, categoría ni importes individuales (CA-GAS-22).
--     Un gasto en USD entra con su cotización congelada al guardarlo (`importe_pesos`, D8): un cambio posterior del dólar no lo mueve.
--   · `analitica.ventas_netas_empresa_mes`: Σ signo × `subtotal_sin_iva` de TODAS las líneas facturadas por organización ×
--     empresa × mes, con el predicado y el signo del margen real (`comprobante_cuenta_como_facturado`, `signo_comprobante`),
--     incluidas las líneas sin costo guardado (D7). Es el denominador del reparto.
-- Ambas llevan `mes` (primer día del mes) y `mes_en_curso` (true si es el mes calendario de hoy en Buenos Aires): el tablero
-- rotula el mes en curso porque su tasa está incompleta (los gastos y las ventas del mes todavía se están cargando).
--
-- Rendimiento: `organizacion_id` y `empresa_id` son columnas del GROUP BY, así que el filtro del guest token se empuja al
-- escaneo de `comprobantes_venta` y `gastos`.
--
-- Migración aditiva e idempotente. Reversión (migración posterior; las vistas no guardan datos):
--   drop view if exists analitica.ventas_netas_empresa_mes;
--   drop view if exists analitica.costos_fijos_empresa_mes;
--   drop function if exists analitica.bandera_activa(text);
--   -- La fila de la bandera se puede dejar (apagada es inocua) o borrar: delete from public.banderas_plataforma where clave = 'margen_costos_fijos';

insert into public.banderas_plataforma (clave, activa, descripcion) values
  ('margen_costos_fijos', false, 'Medida «margen después de costos fijos» (prorrateo de gastos fijos): vistas de analítica y pestaña de Rentabilidad. Los márgenes existentes no dependen de esta bandera.')
on conflict (clave) do nothing;

create or replace function analitica.bandera_activa(p_clave text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select b.activa from public.banderas_plataforma b where b.clave = p_clave), false);
$$;

revoke all on function analitica.bandera_activa(text) from public, anon, authenticated;
grant execute on function analitica.bandera_activa(text) to superset_analitica;

comment on function analitica.bandera_activa(text) is
  'F-GAS-03: true si la bandera de plataforma existe y está encendida; una clave desconocida cuenta como apagada. Solo la ejecuta superset_analitica.';

create or replace view analitica.costos_fijos_empresa_mes as
select
  g.organizacion_id,
  g.empresa_id,
  e.nombre as empresa_nombre,
  date_trunc('month', g.fecha)::date as mes,
  (date_trunc('month', g.fecha)::date = date_trunc('month', (now() at time zone 'America/Argentina/Buenos_Aires'))::date) as mes_en_curso,
  sum(g.importe_pesos)::numeric as costos_fijos
from dominio.gastos g
join dominio.empresas e
  on e.id = g.empresa_id and e.organizacion_id = g.organizacion_id
where g.tipo_costo = 'fijo'
  and g.anulado_en is null
  and analitica.bandera_activa('margen_costos_fijos')
group by g.organizacion_id, g.empresa_id, e.nombre, date_trunc('month', g.fecha)::date;

comment on view analitica.costos_fijos_empresa_mes is
  'F-GAS-03: costos fijos en pesos (gastos fijos vigentes, importe congelado) por empresa y mes de la fecha del gasto. Sin detalle de gastos. Sin filas con la bandera margen_costos_fijos apagada.';

create or replace view analitica.ventas_netas_empresa_mes as
select
  v.organizacion_id,
  v.empresa_id,
  e.nombre as empresa_nombre,
  date_trunc('month', v.fecha)::date as mes,
  (date_trunc('month', v.fecha)::date = date_trunc('month', (now() at time zone 'America/Argentina/Buenos_Aires'))::date) as mes_en_curso,
  sum(analitica.signo_comprobante(v.tipo) * l.subtotal_sin_iva)::numeric as ventas_netas
from dominio.comprobantes_venta v
join dominio.comprobantes_venta_lineas l
  on l.comprobante_id = v.id and l.organizacion_id = v.organizacion_id
join dominio.empresas e
  on e.id = v.empresa_id and e.organizacion_id = v.organizacion_id
where analitica.comprobante_cuenta_como_facturado(v.tipo, v.estado)
  and analitica.bandera_activa('margen_costos_fijos')
group by v.organizacion_id, v.empresa_id, e.nombre, date_trunc('month', v.fecha)::date;

comment on view analitica.ventas_netas_empresa_mes is
  'F-GAS-03: ventas netas sin IVA (la nota de crédito resta; incluye líneas sin costo guardado) por empresa y mes: denominador del reparto de costos fijos. Sin filas con la bandera margen_costos_fijos apagada.';

revoke all on analitica.costos_fijos_empresa_mes from public, anon, authenticated;
revoke all on analitica.ventas_netas_empresa_mes from public, anon, authenticated;
grant select on analitica.costos_fijos_empresa_mes to superset_analitica;
grant select on analitica.ventas_netas_empresa_mes to superset_analitica;
