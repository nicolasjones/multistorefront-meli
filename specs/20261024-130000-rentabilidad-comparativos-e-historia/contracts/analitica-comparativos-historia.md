# Contrato: `analitica` (comparativo e historia de rentabilidad)

Épica MSF-127 · spec `rentabilidad-comparativos-e-historia`. Todo es **nuevo y aditivo**; no cambia la firma de nada existente (sin `BREAKING`). No hay RPC ni endpoints nuevos: solo vistas de solo lectura para el rol de Superset de MSF-120.

## Vistas (esquema `analitica`)

```sql
analitica.margen_comparativo_producto(
  organizacion_id uuid, producto_id uuid, producto_nombre text, sku text,
  empresa_id uuid, empresa_nombre text,
  precio_neto numeric, costo numeric, margen numeric, margen_pct numeric, estado text,
  empresas_comparadas int,
  margen_pct_mejor numeric, margen_pct_peor numeric, diferencia_pp numeric,
  empresa_mejor text, empresa_peor text
)
analitica.margen_historico_producto_canal(
  organizacion_id uuid, empresa_id uuid, empresa_nombre text,
  producto_id uuid, producto_nombre text, sku text,
  fecha timestamptz, cotizacion numeric,
  precio_neto numeric, costo numeric, margen numeric, margen_pct numeric
)
```

Reglas: derivadas de `analitica.margen_producto_canal` (MSF-120) y de `dominio.cotizaciones`; `margen = precio_neto − costo − 0`; el comparativo solo incluye productos con margen en ≥ 2 empresas; la historia no tiene fila si falta costo reconstruible, neto positivo o cotización de la fecha. Cada vista expone `organizacion_id` (filtro `rls` del guest token).

## Función de apoyo (esquema `analitica`, no expuesta)

```ts
analitica.costo_en_fecha(p_producto: uuid, p_organizacion: uuid, p_fecha: timestamptz): numeric | null
```

`security definer`, `set search_path = ''`, `revoke … from public, anon, authenticated`; ejecutable solo por el rol de Superset. Su fuente depende de la decisión abierta 1 de la spec (compuerta FR-009).

## Reportes

`public.reportes`: filas «Comparativo» e «Historia» con `seccion = 'rentabilidad'`, registradas por `infra/superset/importar-dashboards.mjs` (idempotente).
