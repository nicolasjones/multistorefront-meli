# Contrato: `analitica` (comparativo e historia de rentabilidad)

Épica MSF-127 · spec `rentabilidad-comparativos-e-historia`. Todo es **nuevo y aditivo**; no cambia la firma de nada existente (sin `BREAKING`; el disparador sobre `dominio.producto_costos` no altera ningún RPC). No hay RPC ni endpoints nuevos: vistas de solo lectura para el rol de Superset de MSF-120 y una tabla de historia de costos.

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

Reglas: derivadas de `analitica.margen_producto_canal` (MSF-120), `dominio.producto_costos_historial` y `dominio.cotizaciones`; `margen = precio_neto − costo − 0`; el comparativo solo incluye productos con margen en ≥ 2 empresas; la historia usa como fechas los cambios de costo y las cargas de cotización, convierte con la cotización más cercana a cada fecha y no tiene fila si falta costo registrado, neto positivo o ninguna cotización. Cada vista expone `organizacion_id` (filtro `rls` del guest token).

## Tabla (esquema `dominio`, F-REN-07)

```ts
dominio.producto_costos_historial(id: uuid, organizacion_id: uuid, producto_id: uuid, costo: numeric, vigente_desde: timestamptz)
```

Append-only. `select` solo con `private.organizacion_id()` y sección `rentabilidad` (`lectura`/`edicion`); sin escritura para `authenticated`; la alimenta un disparador `security definer` sobre `dominio.producto_costos` (alta o cambio real de costo) y una siembra inicial.

## Funciones de apoyo (esquema `analitica`, no expuestas)

```ts
analitica.costo_en_fecha(p_producto: uuid, p_organizacion: uuid, p_fecha: timestamptz): numeric | null
analitica.cotizacion_cercana(p_organizacion: uuid, p_fecha: timestamptz): numeric | null
```

`security definer`, `set search_path = ''`, `revoke … from public, anon, authenticated`; ejecutables solo por el rol de Superset. `costo_en_fecha` lee `dominio.producto_costos_historial` (último `vigente_desde ≤ fecha`); `cotizacion_cercana` elige la carga de `dominio.cotizaciones` de menor distancia temporal (empate → la anterior).

## Reportes

`public.reportes`: filas «Comparativo» e «Historia» con `seccion = 'rentabilidad'`, registradas por `infra/superset/importar-dashboards.mjs` (idempotente).
