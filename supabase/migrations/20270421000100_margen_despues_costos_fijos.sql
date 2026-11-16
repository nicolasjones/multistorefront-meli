-- F-GAS-03 (MSF-469), tarea T018: medida NUEVA «margen después de costos fijos» (D6, D7, D14).
--
-- Esquema (Principio VII): solo vistas del esquema `analitica` (sin tablas). Se construye SOBRE `analitica.margen_real_categoria`
-- y las dos vistas de la migración anterior; NINGUNA vista, función, tablero ni correo existente se redefine ni cambia de
-- resultado (RF-GAS-13; pgTAP de paridad `margen_costos_fijos_paridad.test.sql`).
--
-- `analitica.margen_despues_costos_fijos` (una fila por empresa × producto × fecha, como el margen real):
--   las columnas de `analitica.margen_real_categoria` (sin tocarlas) más
--   · `mes`, `mes_en_curso`: mes calendario de la fecha de la fila (hora de Buenos Aires para «en curso»).
--   · `tasa_fija`  = costos_fijos(empresa, mes) ÷ ventas_netas(empresa, mes); null si ventas_netas ≤ 0 (sin divisiones por cero).
--   · `cargo_costos_fijos` = vendido × tasa_fija (0 si no hay tasa o no hay gastos fijos; la nota de crédito resta porque el
--     `vendido` ya lleva el signo).
--   · `margen_despues_fijos` = margen − cargo; `margen_despues_fijos_pct` = ÷ vendido (null si vendido ≤ 0).
--   Redondeo: NINGUNO en la base. Todo se calcula en `numeric` sin redondear y el tablero muestra a 2 decimales; así la suma
--   de los cargos más «Sin atribuir» da EXACTAMENTE el costo fijo del mes (SC-002) y los cortes por producto, categoría y
--   tienda suman lo mismo (CA-GAS-24).
--   Con la bandera `margen_costos_fijos` APAGADA no devuelve filas (D15).
--
-- `analitica.margen_costos_fijos_empresa_mes` (DESVÍO declarado: 4.ª vista, no estaba en la lista de la spec): una fila por
--   organización × empresa × mes con lo que las tarjetas por tienda y consolidado necesitan y que no se puede sumar desde la
--   vista por producto sin multiplicar el costo fijo por la cantidad de filas: ventas netas, costos fijos, tasa, margen
--   vigente y cargo atribuidos, margen después de fijos y «Sin atribuir» = costos_fijos − Σ cargo (D7, CA-GAS-18, CA-GAS-19).
--   Un mes con costos fijos pero sin ventas tiene fila (sin_ventas = true, «Sin ventas para repartir los costos fijos»).
--   Se arma desde las vistas anteriores; con la bandera apagada tampoco devuelve filas.
--
-- El umbral de «margen bajo» NO se aplica a la medida nueva (I4): no hay columna `estado` ni `umbral`.
--
-- Privilegios: sin acceso para `public`, `anon` ni `authenticated`; `select` solo a `superset_analitica` (RF-GAS-15). La
-- separación por organización y empresa la fuerza la cláusula `rls` del guest token (columnas `organizacion_id` y `empresa_id`).
--
-- Migración aditiva e idempotente. Reversión (migración posterior; las vistas no guardan datos):
--   drop view if exists analitica.margen_costos_fijos_empresa_mes;
--   drop view if exists analitica.margen_despues_costos_fijos;

create or replace view analitica.margen_despues_costos_fijos as
select
  m.organizacion_id,
  m.empresa_id,
  m.empresa_nombre,
  m.categoria,
  m.producto_id,
  m.producto_nombre,
  m.sku,
  m.fecha,
  date_trunc('month', m.fecha)::date as mes,
  (date_trunc('month', m.fecha)::date = date_trunc('month', (now() at time zone 'America/Argentina/Buenos_Aires'))::date) as mes_en_curso,
  m.unidades,
  m.vendido,
  m.costo,
  m.costos_adicionales,
  m.margen,
  m.margen_pct,
  tf.tasa_fija,
  m.vendido * coalesce(tf.tasa_fija, 0) as cargo_costos_fijos,
  m.margen - m.vendido * coalesce(tf.tasa_fija, 0) as margen_despues_fijos,
  case when m.vendido > 0 then (m.margen - m.vendido * coalesce(tf.tasa_fija, 0)) / m.vendido end as margen_despues_fijos_pct
from analitica.margen_real_categoria m
left join (
  select
    vn.organizacion_id,
    vn.empresa_id,
    vn.mes,
    case when vn.ventas_netas > 0 then coalesce(cf.costos_fijos, 0) / vn.ventas_netas end as tasa_fija
  from analitica.ventas_netas_empresa_mes vn
  left join analitica.costos_fijos_empresa_mes cf
    on cf.organizacion_id = vn.organizacion_id and cf.empresa_id = vn.empresa_id and cf.mes = vn.mes
) tf
  on tf.organizacion_id = m.organizacion_id
 and tf.empresa_id = m.empresa_id
 and tf.mes = date_trunc('month', m.fecha)::date
where analitica.bandera_activa('margen_costos_fijos');

comment on view analitica.margen_despues_costos_fijos is
  'F-GAS-03: margen real (analitica.margen_real_categoria, sin tocarla) menos el cargo de costos fijos prorrateado por ventas netas sin IVA del mes de la empresa. Sin filas con la bandera margen_costos_fijos apagada. Sin redondeo en la base.';

create or replace view analitica.margen_costos_fijos_empresa_mes as
with llaves as (
  select organizacion_id, empresa_id, empresa_nombre, mes, mes_en_curso from analitica.costos_fijos_empresa_mes
  union
  select organizacion_id, empresa_id, empresa_nombre, mes, mes_en_curso from analitica.ventas_netas_empresa_mes
),
producto as (
  select
    d.organizacion_id,
    d.empresa_id,
    d.mes,
    sum(d.vendido)::numeric as vendido_con_costo,
    sum(d.margen)::numeric as margen,
    sum(d.cargo_costos_fijos)::numeric as cargo_atribuido
  from analitica.margen_despues_costos_fijos d
  group by d.organizacion_id, d.empresa_id, d.mes
)
select
  k.organizacion_id,
  k.empresa_id,
  k.empresa_nombre,
  k.mes,
  k.mes_en_curso,
  coalesce(vn.ventas_netas, 0)::numeric as ventas_netas,
  coalesce(cf.costos_fijos, 0)::numeric as costos_fijos,
  case when vn.ventas_netas > 0 then coalesce(cf.costos_fijos, 0) / vn.ventas_netas end as tasa_fija,
  (coalesce(vn.ventas_netas, 0) <= 0) as sin_ventas,
  coalesce(p.vendido_con_costo, 0)::numeric as vendido_con_costo,
  coalesce(p.margen, 0)::numeric as margen,
  coalesce(p.cargo_atribuido, 0)::numeric as cargo_atribuido,
  (coalesce(p.margen, 0) - coalesce(p.cargo_atribuido, 0))::numeric as margen_despues_fijos,
  (coalesce(cf.costos_fijos, 0) - coalesce(p.cargo_atribuido, 0))::numeric as sin_atribuir
from llaves k
left join analitica.ventas_netas_empresa_mes vn
  on vn.organizacion_id = k.organizacion_id and vn.empresa_id = k.empresa_id and vn.mes = k.mes
left join analitica.costos_fijos_empresa_mes cf
  on cf.organizacion_id = k.organizacion_id and cf.empresa_id = k.empresa_id and cf.mes = k.mes
left join producto p
  on p.organizacion_id = k.organizacion_id and p.empresa_id = k.empresa_id and p.mes = k.mes;

comment on view analitica.margen_costos_fijos_empresa_mes is
  'F-GAS-03: por empresa y mes, ventas netas, costos fijos, tasa, margen vigente, cargo atribuido, margen después de fijos y «Sin atribuir» (costos fijos menos el cargo atribuido). Sin filas con la bandera margen_costos_fijos apagada.';

revoke all on analitica.margen_despues_costos_fijos from public, anon, authenticated;
revoke all on analitica.margen_costos_fijos_empresa_mes from public, anon, authenticated;
grant select on analitica.margen_despues_costos_fijos to superset_analitica;
grant select on analitica.margen_costos_fijos_empresa_mes to superset_analitica;
