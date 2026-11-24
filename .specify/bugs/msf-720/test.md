# Bug Verification: precio final al centavo, margen sin comisión y dólar con 4 decimales

- **Slug**: msf-720
- **Tested**: 2026-11-24
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

La reproducción de los dos puntos que quedaban abiertos (cotización truncada a 2 decimales y texto del
margen que prometía descontar la comisión) falló antes del arreglo y pasa después. La parte del IVA al
centavo ya estaba cubierta por `lote32_iva_al_centavo.test.sql` y `iva.test.ts` en `dokploy`; no se tocó
lo emitido.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproducción previa (cotización) | `vitest run src/lib/cotizacion.test.ts` antes del cambio | fail | `1465,1234` daba `$ 1.465,12` en vez de `$ 1.465,1234`. |
| Reproducción previa (margen) | `vitest run src/lib/precios.test.ts` antes del cambio | fail | `NOTA_MARGEN` decía «Precio − Costo − Comisión del canal». |
| Tests nuevos/actualizados | `vitest run` de cotización, precios, formato y bloque de precio | pass | 86 tests. |
| Regresión del área | `vitest run src/components/cotizacion src/components/precios src/pages/cotizacion` + libs de precios/IVA/cotización | pass | 326 tests, 21 archivos. |
| Build | `pnpm build` | pass | `tsc -b && vite build` OK. |
| Lint | `pnpm lint` | pass | Solo warnings previos ajenos al cambio. |
| Documentación | `pnpm docs:check` | pass | Documentación, migraciones (0 nuevas) y trampas OK. |
| Prototipo | `pnpm prototipo:check` | pass | 120 pantallas al día. |
| IVA al centavo (base) | pgTAP `supabase/tests/database/lote32_iva_al_centavo.test.sql` | not-run | Requiere `pnpm dev:supabase`; ya está en `dokploy` y lo corre el CI de base. |

## Output Excerpts

```
Test Files  4 passed (4)
     Tests  86 passed (86)
```

```
Test Files  21 passed (21)
     Tests  326 passed (326)
```

```
✓ built in 3.12s
```

## Residual Risks

- No se pudo correr pgTAP localmente (necesita el Supabase local); la regla del IVA al centavo ya está en
  `dokploy` y la cubre el CI de base.
- El cambio de presentación de la cotización afecta también las pantallas de Inicio y los diálogos del
  dólar; sus tests de componentes y página pasaron.

## Recommendation

Cerrar el bug: los tres síntomas tienen cobertura que falla si la regla cambia.
