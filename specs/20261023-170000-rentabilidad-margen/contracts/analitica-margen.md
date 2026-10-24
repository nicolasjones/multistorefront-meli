# Contrato: `analitica` (rentabilidad) y RPC de umbral

Épica MSF-120 · spec `rentabilidad-margen`. Todo es **nuevo y aditivo**; no cambia la firma de nada existente. `public.resolver_organizacion_reporte` mantiene su firma y suma una regla (no es BREAKING).

## Vistas (esquema `analitica`, solo lectura para el rol de Superset)

```sql
analitica.margen_producto_canal(
  organizacion_id uuid, empresa_id uuid, empresa_nombre text,
  producto_id uuid, producto_nombre text, sku text,
  precio_neto numeric, costo numeric, comision numeric,
  margen numeric, margen_pct numeric, estado text  -- 'ok' | 'bajo' | 'negativo'
)
analitica.rentabilidad_resumen_empresa(organizacion_id, empresa_id, empresa_nombre, productos, margen_promedio_pct, margen_por_unidad, con_margen_bajo, con_margen_negativo)
analitica.rentabilidad_consolidado(organizacion_id, productos_con_margen, margen_promedio_ponderado_pct, con_margen_bajo, con_margen_negativo, umbral_margen_bajo)
```

Reglas: `margen = precio_neto − costo − comision`; `margen_pct = margen / precio_neto`; `comision = 0` (tiendas); sin costo / sin neto positivo / sin cotización → **sin fila**. Cada vista expone `organizacion_id` (filtro `rls` del guest token). Consumidores previstos: Superset, MSF-156 (alerta de margen negativo), MSF-127, MSF-128, MSF-192, MSF-265.

## RPC (esquema `public`)

```ts
leer_umbral_margen_bajo(): numeric
guardar_umbral_margen_bajo(p_umbral: numeric, p_updated_at: timestamptz): timestamptz
rentabilidad_conteo_margen(): { con_margen_bajo: int, con_margen_negativo: int }
```

`security invoker`, `revoke … from public, anon`, `grant execute … to authenticated`. `guardar_umbral_margen_bajo` exige `edicion` en `rentabilidad`, valida `0 < umbral ≤ 1`, bloqueo optimista por `updated_at` y deja el evento `rentabilidad.umbral_actualizado`.

## Edge Function

`emitir-acceso-reporte`: para reportes con `reportes.seccion` no nula exige `private.nivel_seccion(seccion) in ('lectura','edicion')`; si no, 403 sin emitir token. La cláusula `rls` sigue siendo `organizacion_id = '<org>'`.

Permisos del rol `superset_analitica`: `usage` en `analitica`, `select` sobre las vistas y `execute` sobre `analitica.a_pesos` / `analitica.neto_empresa` (Postgres evalúa las funciones de una vista con los permisos de quien consulta; el alcance es el mismo que da la vista). `anon` y `authenticated` no ejecutan nada de `analitica`. El reset del CI descarta el rol (objeto de clúster) para que la migración lo cree `nologin`.
