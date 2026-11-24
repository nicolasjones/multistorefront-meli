# Bug Verification: Rendimiento móvil del catálogo y la ficha medido y registrado (MSF-552 · T071/SC-010 de MSF-167)

- **Slug**: msf-552
- **Tested**: 2026-11-24
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial (medición verificada; SC-010 NO se cumple: LCP medido 10,5–10,9 s contra 3 s)

## Summary

La guía tiene las cuatro rutas medidas (la medición está verificada; el objetivo de LCP no se cumple) con su entorno y su fuente, y el costo de la RPC con 500 productos.

## Checks

| Check | Resultado |
|---|---|
| Medición real en CI antes del cambio de front | run `45474509678`: LCP 15.584–16.021 ms |
| Medición real en CI con el panel diferido | run `45476405495`: LCP 10.500–10.903 ms |
| Cada cifra de la guía contra `resumen.md` y `rpc-catalogo.txt` del artifact `medir-tienda` | coincide |
| `node scripts/verificar-medicion-tienda.mjs` | pasa |
| Tests de los scripts de medición y de `main.guard.test.ts` | pasan |

El objetivo de LCP (3 s) no se cumple: queda como seguimiento, no se esconde.
