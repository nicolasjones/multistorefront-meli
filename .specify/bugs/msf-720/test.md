# Bug Verification: precio final al centavo, margen sin comisión y dólar con 4 decimales

- **Slug**: msf-720
- **Tested**: 2026-11-24
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

La reproducción de los puntos que quedaban abiertos (cotización truncada a 2 decimales y texto del
margen que prometía descontar la comisión) falló antes del arreglo y pasa después. La parte del IVA al
centavo ya estaba cubierta por `lote32_iva_al_centavo.test.sql` y `iva.test.ts` en `dokploy`; no se tocó
lo emitido.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproducción previa (cotización) | `vitest run src/lib/cotizacion.test.ts` antes del cambio | fail | `1465,1234` daba `$ 1.465,12` en vez de `$ 1.465,1234`. |
| Reproducción previa (margen) | `vitest run src/lib/precios.test.ts` antes del cambio | fail | `NOTA_MARGEN` decía «Precio − Costo − Comisión del canal». |
| Reproducción previa (dólar en las pantallas) | `vitest run` de `PrecioCostoBloque` y `pages/empresas/precios` antes del cambio | fail | «Con dólar $ 1.465,12» y «Dólar vigente $ 1.465,12». |
| Tests nuevos/actualizados | `vitest run` de cotización, precios, formato, bloque de precio y pestaña de empresa | pass | 592 tests, 35 archivos. |
| Build | `pnpm build` | pass | `tsc -b && vite build` OK. |
| Lint | `pnpm lint` | pass | Solo warnings previos ajenos al cambio. |
| Documentación | `pnpm docs:check` | pass | Documentación, migraciones (0 nuevas) y trampas OK. |
| Prototipo | `pnpm prototipo:check` | pass | 120 pantallas al día. |
| Matriz | `pnpm matriz:check` | pass | Sin specs nuevas. |
| Calidad | `pnpm calidad` | pass | oxlint, knip, jscpd, dependency-cruiser y syncpack OK; gitleaks no pudo correr (Docker). |
| Reglas vigiladas | Se cambió la regla a propósito y se comprobó que algún test falla | pass | Ver «Los tests vigilan la regla». |
| IVA al centavo (base) | pgTAP `supabase/tests/database/lote32_iva_al_centavo.test.sql` | not-run | Requiere `pnpm dev:supabase`; ya está en `dokploy` y lo corre el CI de base. |
| E2E del recorrido | `apps/web/e2e/msf-720-precios-visibles.e2e.ts` | not-run | Requiere el stack local (Supabase + web servida); este entorno no tiene Docker. |

## Output Excerpts

```
 Test Files  35 passed (35)
      Tests  592 passed (592)
```

```
✓ built in 1.81s
```

```
Documentación de cambios: OK (4330 archivos comparados contra 54ea7b1bad793d5968ffe2d1f629128c40f3bee3).
Migraciones OK: 784 archivo(s), 0 nuevo(s) contra origin/dokploy.
Trampas conocidas: OK (0 migración(es), 0 prueba(s) pgTAP y 0 E2E revisados contra origin/dokploy).
```

## Los tests vigilan la regla (FEAT-236)

| Regla cambiada a propósito | Test que falla |
|---------------------------|----------------|
| `formatearCotizacion` con 2 decimales en vez de 4 | `lib/cotizacion.test.ts`, `components/precios/PrecioCostoBloque.test.tsx`, `pages/empresas/precios.test.tsx` |
| `NOTA_MARGEN` con el texto viejo («Precio − Costo − Comisión del canal») | `lib/precios.test.ts`, `components/precios/PrecioCostoBloque.test.tsx` |

Los cambios de prueba se revirtieron.

## Residual Risks

- No se pudo correr pgTAP ni el E2E localmente (este entorno no tiene Docker ni stack de Supabase): la regla
  del IVA al centavo ya está en `dokploy` y la cubre el CI de base; el E2E nuevo corre en el job de e2e.
- El cambio de presentación de la cotización afecta las pantallas de Cotización, de Inicio, el formulario de
  producto y la pestaña «Precios y moneda»; sus tests de componentes y de página pasaron.

## Recommendation

Cerrar el bug: los tres síntomas tienen cobertura que falla si la regla cambia.
