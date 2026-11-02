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
