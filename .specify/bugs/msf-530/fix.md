# Bug Fix: Varios proveedores por producto (seguimiento MSF-205)

- **Slug**: msf-530
- **Fixed**: 2026-10-19
- **Assessment**: ./assessment.md
- **Status**: applied (lote 93)

## Resolución (lote 93)

Se implementó con la opción más simple y compatible con los vínculos proveedor-producto ya existentes (`productos.proveedor_id` y
`codigo_proveedor`). Las tres preguntas abiertas del assessment quedaron resueltas así:

| `[NEEDS CLARIFICATION]` | Decisión |
|---|---|
| ¿Proveedor principal obligatorio o solo uno marcado? | **Solo uno marcado (opcional)**: a lo sumo un principal por producto (índice único parcial). Quitar el principal no promueve a otro; el producto puede quedar sin principal. Un producto sin proveedores sigue siendo válido, como hoy. |
| ¿Atributos por relación (costo, código, plazo) o solo el código? | **Código y costo por vínculo.** El plazo de pago no va por producto: es una condición del proveedor y se resolvió en MSF-523. El costo efectivo del producto sigue saliendo del principal (el costo del vínculo principal se copia a `producto_costos` y viceversa). |
| ¿El prototipo se rediseña o se declara fuera de la matriz? | **Sin rediseño.** El selector «Proveedor» y el código de `ProductoAlta`/`ProductoEditar` siguen siendo el proveedor principal; los demás proveedores se administran en una sección propia de la edición del producto, que se declara fuera de la matriz del prototipo (el prototipo dibuja uno solo). |

Compatibilidad: `productos.proveedor_id` y `codigo_proveedor` pasan a ser el **espejo del principal**; las firmas de `crear_producto` y
`actualizar_producto`, la exportación, los reportes y `productos_de_proveedor` no cambian de contrato. El camino viejo conserva su
semántica: elegir otro proveedor reemplaza al principal anterior; para conservarlo como secundario se usa «Marcar como principal». Detalle,
RPC y reversión en `docs/proveedores.md` y en `supabase/migrations/20270511000100_productos_proveedores.sql`.

## Summary

Aplicado en el lote 93 (ver «Resolución» arriba). MSF-530 era el seguimiento trazado (FR-020 / T029) de una limitación de alcance, no un defecto: MSF-205 entrega un proveedor por producto (`productos.proveedor_id`) y modelar N proveedores se difirió por decisión de negocio (Jira). El assessment exige una spec nueva (tabla `dominio.productos_proveedores`, RPC, UI y cambio de prototipo) y deja tres `[NEEDS CLARIFICATION]` sin resolver; el CLAUDE.md prohíbe inventar requisitos de negocio y exige spec antes de implementar.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `supabase/migrations/20270511000100_productos_proveedores.sql` | tabla `dominio.productos_proveedores`, disparadores, relleno y RPC | Aditiva; las columnas viejas se conservan |
| `apps/web/src/components/productos/ProveedoresDelProducto.tsx`, `apps/web/src/lib/productosProveedores.ts` | sección «Proveedores del producto» | Montada en la edición del producto |
| `supabase/tests/database/lote93_productos_proveedores.test.sql` y Vitest de la sección y la librería | pruebas | Incluye axe a 320, 768 y 1440 px |

## Tests Added or Updated

- pgTAP `lote93_productos_proveedores` (unicidad, un solo principal, espejo, costo efectivo, permisos, aislamiento, `anon`) y Vitest.

## Local Verification

- Ver el PR del lote 93 (guards, `tsc -b`, oxlint, Vitest y pgTAP).

## Deviations from Assessment

- La devolución del Revisor no trajo hallazgos legibles (el prompt remite a una lista de Jira que no llegó) y no existía PR previo con comentarios; no hay nada accionable que corregir.

## Follow-ups

- Ninguno abierto: las tres preguntas quedaron resueltas (ver «Resolución (lote 93)») y la spec nueva no se abrió; la decisión y el diseño viven en `docs/proveedores.md` y en la migración `20270511000100_productos_proveedores.sql`.
- Costo del vínculo y costo efectivo: la sincronía entre `producto_costos` y el principal es simétrica (alta, cambio y borrado) y exige edición en Rentabilidad para cambiar el costo efectivo.
