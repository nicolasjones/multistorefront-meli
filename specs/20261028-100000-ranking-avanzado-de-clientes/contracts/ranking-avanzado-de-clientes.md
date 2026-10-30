# Contratos: Ranking avanzado de clientes (MSF-171)

Tres RPC **nuevas** en `public`, todas `security definer`, `set search_path = ''`, organización de `private.organizacion_id()`, sección `clientes` en `lectura`/`edicion` (si no: `42501`), `revoke execute … from public, anon` y `grant execute … to authenticated`. Todas **reutilizan** `private.comprobante_cuenta_como_facturado(tipo, estado)` y `private.signo_comprobante(tipo)` de MSF-126/MSF-177. `public.ranking_clientes(...)` **no cambia** (sin cambios de firma, nada BREAKING).

Errores de validación (`22023`): mismos mensajes que `ranking_clientes` (fechas vacías, Hasta < Desde, rango > 5 años, tipo inválido, página fuera de 1…1.000.000, tamaño fuera de 1…1.000).

## F-CLI-14 · `ranking_clientes_comparado`

```ts
ranking_clientes_comparado(
  p_desde: date, p_hasta: date,
  p_desde_comparacion: date, p_hasta_comparacion: date,
  p_tipo?: 'minorista' | 'mayorista' | null,
  p_incluir_consumidor_final?: boolean,   // default false
  p_con_iva?: boolean,                    // default false
  p_pagina?: number,                      // default 1
  p_tamano?: number,                      // default 25, máx. 1000
  p_empresa_id?: uuid | null
): Array<{
  posicion: bigint, cliente_id: uuid, numero: integer, nombre: text, tipo: text,
  comprobantes: bigint, facturado: numeric,
  comprobantes_comparacion: bigint, facturado_comparacion: numeric,
  variacion: numeric, variacion_porcentaje: numeric | null,  // null si la base (comparación) es <= 0
  total_filas: bigint
}>
```

Orden: `facturado` desc, `facturado_comparacion` desc, `lower(nombre)`, `numero`.

## F-CLI-15 · `ranking_clientes_por_dimension`

```ts
ranking_clientes_por_dimension(
  p_desde: date, p_hasta: date,
  p_producto_id?: uuid | null,
  p_categoria_id?: uuid | null,           // raíz incluye subcategorías
  p_provincia?: text | null,              // máx. 100 caracteres; sin mayúsculas ni tildes
  p_tipo?: 'minorista' | 'mayorista' | null,
  p_incluir_consumidor_final?: boolean,
  p_con_iva?: boolean,
  p_pagina?: number, p_tamano?: number,
  p_empresa_id?: uuid | null
): Array<{
  posicion: bigint, cliente_id: uuid, numero: integer, nombre: text, tipo: text,
  comprobantes: bigint, facturado: numeric, participacion: numeric, total_filas: bigint
}>
```

Con producto o categoría, `facturado` suma **líneas** de `dominio.comprobantes_venta_lineas`; sin ellos, igual que `ranking_clientes`.

## F-CLI-16 · `clientes_inactivos`

```ts
clientes_inactivos(
  p_dias?: number,                        // default 90; 1…3650
  p_tipo?: 'minorista' | 'mayorista' | null,
  p_incluir_consumidor_final?: boolean,   // default false
  p_pagina?: number, p_tamano?: number,
  p_empresa_id?: uuid | null
): Array<{
  cliente_id: uuid, numero: integer, nombre: text, tipo: text,
  ultima_compra: date, dias_sin_comprar: integer,
  comprobantes: bigint, facturado: numeric, total_filas: bigint
}>
```

Orden: `ultima_compra` asc, `lower(nombre)`, `numero`. Excluye clientes sin compras que cuentan y archivados.

## Migraciones previstas (aditivas, una por historia, sin dependencia entre sí)

| Historia | Archivo | Reversión |
|----------|---------|-----------|
| F-CLI-14 | `supabase/migrations/20270120100000_ranking_clientes_comparado.sql` | `drop function public.ranking_clientes_comparado(date, date, date, date, text, boolean, boolean, integer, integer, uuid);` |
| F-CLI-15 | `supabase/migrations/20270114110000_ranking_clientes_por_dimension.sql` | `drop function public.ranking_clientes_por_dimension(date, date, uuid, uuid, text, text, boolean, boolean, integer, integer, uuid);` |
| F-CLI-16 | `supabase/migrations/20270114120000_clientes_inactivos.sql` | `drop function public.clientes_inactivos(integer, text, boolean, integer, integer, uuid);` |
