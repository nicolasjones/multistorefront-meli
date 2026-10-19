# Bug Fix: Código de barras (EAN-13) del producto

- **Slug**: msf-529
- **Fixed**: 2026-10-19
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

Se agrega `dominio.productos.codigo_barras` (opcional, 13 dígitos, único por organización), las RPC `crear_producto`/`actualizar_producto` lo reciben, y el alta/edición muestran el campo «Código de barras (EAN-13)».

## Changes

| File | Change | Notes |
|------|--------|-------|
| `supabase/migrations/20261019120000_productos_codigo_barras.sql` | added | columna + check + índice único parcial; reemplaza las 2 RPC (grants/revoke conservados); triggers cuentan la columna; reversión documentada |
| `supabase/tests/database/catalogo_codigo_barras.test.sql` | added | pgTAP |
| `apps/web/src/lib/productos.ts` | modified | formulario, validación 13 dígitos, parámetros, mensaje de repetido |
| `apps/web/src/components/productos/FormularioProducto.tsx` | modified | campo + error de repetido en el campo |
| `apps/web/src/pages/productos/edit.tsx` | modified | `COLUMNAS` incluye `codigo_barras` |
| `apps/web/src/**/*.test.ts(x)` | modified | lib, alta y edición |
| `docs/catalogo.md` | modified | sección MSF-529 |

## Local Verification

- `vitest run src/lib/productos.test.ts src/pages/productos` → 75 passed
- `pnpm lint` → solo warnings preexistentes; `pnpm build` → OK; `pnpm docs:check` → OK; `pnpm prototipo:check` → OK
- pgTAP: NO corrido localmente (sin acceso al daemon Docker); queda al CI.

## Deviations from Assessment

- **Sin columna en el listado**: `Productos.inventory.json` no la tiene (en el prototipo «Código de barras» solo es una columna exportable); el prototipo manda la UI.
- Decisiones de las preguntas abiertas: único por organización; solo 13 dígitos (sin dígito verificador); solo por producto.
- Sin spec Spec Kit nueva: se trabajó en modo bug sobre la tarea de seguimiento.

## Follow-ups

- Variantes con código de barras y exportación de la columna: otras épicas de Catálogo.
