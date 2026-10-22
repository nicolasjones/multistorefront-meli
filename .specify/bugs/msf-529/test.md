# Bug Test: Código de barras del producto

- **Slug**: msf-529
- **Fix**: ./fix.md
- **Result**: pass (web) / pendiente CI (pgTAP)

| Criterio | Evidencia |
|----------|-----------|
| Alta guarda el código | `catalogo_codigo_barras.test.sql`; `create.test.tsx` |
| Edición lo muestra, reenvía y permite vaciarlo | `edit.test.tsx` |
| Rechaza ≠ 13 dígitos | pgTAP; `productos.test.ts`; `edit.test.tsx` |
| Único por organización; otra org puede repetir | pgTAP; mensaje «Ese código de barras ya existe» en `create.test.tsx` |
| `anon` no ejecuta; sin sobrecargas | pgTAP |

Vitest: 75 passed. pgTAP no corrió localmente (sin Docker).
