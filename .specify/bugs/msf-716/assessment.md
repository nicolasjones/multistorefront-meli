# Bug Assessment: La toma de inventario falla en categorías con ~200+ productos (URL del `in (…)` demasiado larga)

- **Slug**: msf-716
- **Created**: 2026-11-01
- **Source**: pasted text (Jira MSF-716, "It's a Plan"); sin URL
- **Verdict**: valid
- **Severity**: high

## Report (verbatim or summarized)

"[Bug] La toma de inventario falla en categorías con más de unos 200 productos porque la URL del `in (…)` se pasa del límite"

## Symptom

Al cargar las filas de la toma de inventario para una categoría con más de ~200 productos, la consulta de stock falla (HTTP 414/400, "Failed to fetch") y la pantalla no muestra los productos. Se esperaba cargar hasta 1000 productos (`MAXIMO_PRODUCTOS_TOMA`).

## Reproduction

1. Ir a Stock → Toma de inventario y elegir una categoría con >~200 productos activos.
2. `cargarFilasToma` hace la segunda consulta (stock del depósito por defecto) con todos los ids en la URL.
3. La petición GET a PostgREST excede el límite de longitud de URL y falla.

[NEEDS CLARIFICATION: umbral exacto (depende del proxy/gateway; cada uuid ocupa ~37 chars en el `in.(...)` → ~200 ids ≈ 7-8 KB).]

## Suspected Code Paths

- `apps/web/src/lib/depositos.ts:187-204` — `listarStockPorDepositoDe` hace `.in('producto_id', productoIds)` sin partir en lotes; es el origen de la URL larga.
- `apps/web/src/lib/tomaInventario.ts:86` — `cargarFilasToma` le pasa hasta 1000 ids (límite permitido por `MAXIMO_PRODUCTOS_TOMA`), muy por encima de lo que cabe en una URL.
- `apps/web/src/lib/tomaInventario.ts:72` — `.in('categoria_id', …)` también va en URL, pero con pocos ids de categoría; riesgo bajo (solo si hay muchas subcategorías).
- `apps/web/src/lib/productosListado.ts:125` — `consultarCostos` con `.in('producto_id', …)`: mismo patrón, pero acotado a una página del listado.
- `apps/web/src/pages/stock/list.tsx:160,229` — otros llamadores de `listarStockPorDepositoDe`: la página es acotada, pero `completarLoteExportacion` (l.229) depende del tamaño del lote de exportación; se beneficia del mismo arreglo.

## Root Cause Hypothesis

`listarStockPorDepositoDe` serializa todos los `producto_id` en un filtro `in.(…)` de la query string GET de PostgREST. La toma de inventario permite hasta 1000 productos, así que la URL llega a ~37 KB y supera el límite del servidor/proxy (típicamente 8 KB). Los otros llamadores pasan pocos ids (una página), por eso solo se manifiesta en la toma. Confianza: alta (lectura de código; no reproducido contra el gateway).

## Proposed Remediation

**Preferred**: partir los ids en lotes (p. ej. 100 por petición, ≈3.7 KB de URL) dentro de `listarStockPorDepositoDe`, ejecutar los lotes (en paralelo acotado o en serie) y fusionar los resultados en un único `Record`. Arreglarlo en la función compartida cubre toma, listado y exportación. Opcionalmente extraer un helper genérico de lotes (`enLotes`) reutilizable por `consultarCostos`.

**Alternatives**:
- Mover la consulta a una RPC/vista que reciba la categoría y el depósito (sin lista de ids): una sola petición, pero exige migración (RLS, `revoke ... from public, anon`, `grant ... to authenticated`) y más superficie.
- Usar POST en la consulta (no soportado de forma directa por `.in()` en supabase-js): descartado.

**Files likely to change**:
- `apps/web/src/lib/depositos.ts`
- `apps/web/src/lib/depositos.test.ts` (o el test existente de la librería)
- `apps/web/src/lib/tomaInventario.test.ts` / `apps/web/src/pages/stock/toma-inventario.test.tsx`
- `docs/` o `specs/` de F-STK-11 (regla del repo: documentación en el mismo cambio)

**Tests to add or update**:
- `listarStockPorDepositoDe` con 1000 ids hace varias peticiones, ninguna con más de N ids, y devuelve la unión.
- `cargarFilasToma` con una categoría de ~1000 productos devuelve todas las filas con su `sistema` correcto.
- Lista vacía sigue devolviendo `{}` sin peticiones.

## Risks & Considerations

- Sin cambios de base de datos ni migraciones; solo frontend.
- Un error en cualquier lote debe propagarse (no devolver stock parcial, que haría rotular diferencias falsas en la toma).
- Mantener el orden determinista y evitar duplicados al fusionar.
- Muchas peticiones en paralelo: limitar concurrencia.
- Tras modificar código correr `graphify . --code-only --update`.

## Open Questions

- [NEEDS CLARIFICATION: tamaño de lote preferido y si se desea limitar el máximo de productos de la toma].
