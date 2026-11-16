# Contratos: Inicio y alertas

Todos nuevos (sin `BREAKING`).

## F-INI-02

```ts
recalcular_alertas_inicio(p_organizacion uuid): jsonb   // { alertas: number, calculada_en: string }
```
`public`, `security definer`, `search_path = ''`. `revoke … from public, anon, authenticated`; `grant … to service_role`. Idempotente: reemplaza las filas de la organización en una transacción con `pg_advisory_xact_lock`.

```ts
alertas_inicio_visibles: { id, empresa_id, tipo, seccion, cantidad, referencia_id, enlace, calculada_en }
```
Vista `public`, `security_invoker`. `tipo` ∈ `sin_stock | stock_bajo | consultas_sin_atender | dolar_sin_cargar | margen_negativo`. `enlace` sale de una lista cerrada de rutas.

Edge Function `recalcular-alertas-inicio`: `POST {"barrer": true}` con `x-aviso-token`.

## F-INI-03

```ts
buscar_productos_global(p_q text, p_limite int default 8): { producto_id, nombre, sku }[]
```
`public`, `security invoker`. Error `22023` si `p_q` tiene menos de 2 caracteres; `42501` sin `productos`≥`lectura`. `grant execute … to authenticated`, `revoke … from public, anon`.

## F-INI-01

Sin RPC nuevas: consume `stock_estados`, `consultas_bandeja`, `estado_cotizacion()`, `cotizacion_del_dia()`, `contexto_panel_actual()`.

## Épica MSF-824 · Inicio, tablero completo (F-INI-04 a F-INI-07)

Spec: `specs/20270305-100000-inicio-tablero-completo/`. Todas son funciones nuevas de `public` (sin `BREAKING`, sin tablas),
`security definer`, `set search_path = ''`, `revoke execute … from public, anon` y `grant execute … to authenticated`. La
organización sale de la sesión; los argumentos de tienda y depósito solo **acotan**, nunca amplían el alcance.

### F-INI-04 · `resumen_inicio_periodo` (migración `20270305105000`)

```ts
resumen_inicio_periodo(p_desde: date, p_hasta: date, p_empresa?: uuid, p_deposito?: uuid): {
  desde: date, hasta: date, anterior_desde: date, anterior_hasta: date,
  ventas: null | { monto, comprobantes, unidades, devoluciones_monto, devoluciones_unidades,
                   anterior_monto, anterior_comprobantes, ticket_promedio: number | null },
  stock:  null | { unidades, reservado, disponible, sin_stock, stock_bajo, ajustes, entradas_unidades },
  serie:  { dia: date, unidades: number | null, stock: number | null }[]   // un punto por día del período
}
```
`ventas` es `null` sin `ventas` ≥ lectura en ninguna tienda accesible; `stock` es `null` sin `stock` ≥ lectura; en `serie`, `unidades`
y `stock` son `null` cuando su bloque lo es. Un depósito que no es de la organización devuelve ambos bloques `null` y `serie` vacía. Errores: `42501`
(sin organización), `22023` (fechas nulas, `p_desde > p_hasta` o más de 366 días). Incluye el índice
`dominio.movimientos_stock_org_fecha_dia_idx`. Reversión: `drop function public.resumen_inicio_periodo(date,date,uuid,uuid); drop index dominio.movimientos_stock_org_fecha_dia_idx;`.

### F-INI-05 · `resumen_inicio_bloques` (`20270305110000`)

```ts
resumen_inicio_bloques(p_desde: date, p_hasta: date, p_empresa?: uuid, p_deposito?: uuid): {
  por_tienda: null | { empresa_id: uuid, nombre: string, unidades: number,
                       ingresos: number | null,       // null sin `rentabilidad` ≥ lectura
                       margen_pct: number | null }[],  // null sin `rentabilidad`, o sin líneas con costo guardado
  salidas_por_deposito: null | { deposito_id: uuid, nombre: string, salidas: number, stock_actual: number }[]  // null sin `stock`
}
```
Una fila por tienda **activa y accesible** con `ventas` ≥ lectura. Mismos errores que la anterior. Reversión: `drop function public.resumen_inicio_bloques(date,date,uuid,uuid);`.
«Actividad reciente» no tiene RPC propia: `public.listar_actividad` (`security invoker`, rige la RLS de `actividad`).

### F-INI-06 · `movimientos_por_producto` (`20270305120000`)

```ts
movimientos_por_producto(p_desde: date, p_hasta: date, p_empresa?: uuid, p_deposito?: uuid, p_busqueda?: text,
  p_categoria?: uuid, p_vista = 'todos' /* todos | alerta | quieto */, p_orden = 'nombre', p_direccion = 'asc',
  p_pagina = 1, p_tamano = 25): {
  producto_id, nombre, sku, categoria, stock_inicial, entradas, salidas, ajustes, stock_actual, minimo,
  ventas: number | null,   // null sin `ventas` ≥ lectura en ninguna tienda
  ultimo_movimiento: date | null, estado: 'alerta' | 'quieto' | 'normal', total: number   // total del filtro, en cada fila
}[]
```
`p_orden` ∈ `nombre | sku | categoria | stock_inicial | entradas | salidas | ajustes | stock_actual | minimo | ventas | ultimo_movimiento | estado`
(lista blanca; otro valor da `22023`); `p_direccion` ∈ `asc | desc`. Se acota `p_tamano` a 1–100, `p_pagina` a 1–100000 y `p_busqueda` a 100
caracteres (los comodines `%`, `_` y `\` se escapan). Exige `stock` ≥ lectura (`42501`). No expone costo ni margen. Con `p_empresa` lista
solo los productos asignados a esa tienda. Reversión: `drop function public.movimientos_por_producto(date,date,uuid,uuid,text,uuid,text,text,text,integer,integer);`.

### F-INI-07 · `previsualizar_impacto_dolar` y `aplicar_cotizacion` (`20270305130000`, `20270305140000`)

```ts
previsualizar_impacto_dolar(p_valor: numeric, p_empresa?: uuid): {
  variacion_pct: number | null, recalcula: boolean,
  empresas: { empresa_id, nombre, precios }[],
  muestra: { producto, sku, usd, por_empresa: { empresa_id, usd, hoy, nuevo }[] }[],   // hasta 6 productos
  umbral_pct, confirmacion_pct, redondeo_pesos
}
aplicar_cotizacion(p_valor: numeric, p_empresa?: uuid, p_variacion_vista?: numeric): { id, recalculo_aplicado: boolean, precios_recalculados: number }
```
`previsualizar_impacto_dolar` es de **solo lectura** (no deja cotización pendiente) y exige edición de `cotizacion_dolar` (`42501`); valor nulo, ≤ 0,
NaN, infinito, con más de 4 decimales o ≥ 1e10 da `22023`. `aplicar_cotizacion` delega en `cargar_cotizacion` y `confirmar_cotizacion` dentro de **una**
transacción: sus permisos, validaciones y errores (`42501`, `23514`, `22023` con `variacion_inusual` / `variacion_cambio`) son los de ellas, y si
la confirmación falla no queda ninguna cotización pendiente. Reversión: `drop function public.previsualizar_impacto_dolar(numeric,uuid); drop function public.aplicar_cotizacion(numeric,uuid,numeric);`.
