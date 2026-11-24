# Bug Verification: precio final al centavo, margen sin comisión y dólar con 4 decimales

- **Slug**: msf-720
- **Tested**: 2026-11-24
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

Los tres puntos del ticket tienen cobertura que **falla si la regla cambia**:

1. El precio final con IVA al centavo lo fija `private.aplicar_iva` en la base (migración
   `20270507180200_aplicar_iva_al_centavo.sql`, ya en `dokploy`) y lo espeja `calcularFinal`
   (`apps/web/src/lib/iva.ts`); lo cubren el pgTAP `lote32_iva_al_centavo.test.sql` y `apps/web/src/lib/iva.test.ts`.
2. El texto del margen que aclara que **no** descuenta la comisión del canal lo vigilan
   `apps/web/src/lib/precios.test.ts` y `apps/web/src/components/precios/PrecioCostoBloque.test.tsx`.
3. El dólar con sus 4 decimales lo vigilan `apps/web/src/lib/cotizacion.test.ts`,
   `apps/web/src/lib/formatoImporte.test.ts`, `apps/web/src/components/precios/PrecioCostoBloque.test.tsx`,
   `apps/web/src/pages/empresas/precios.test.tsx` y `apps/web/src/pages/historial/CotizacionesTab.test.tsx`.

No se toca lo ya emitido: los comprobantes guardan sus importes.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproducción 1 (precio final al centavo, lado front) | `vitest run src/lib/iva.test.ts` | pass | `calcularFinal` al centavo (29.186 → 35.315,06) y tabla de 18 casos comparada contra `private.aplicar_iva` de un Postgres real. |
| Reproducción 1 (lado base) | pgTAP `supabase/tests/database/lote32_iva_al_centavo.test.sql` | not-run | Requiere `pnpm dev:supabase`; la migración `20270507180200` ya está en `dokploy` y la corre el CI de base. |
| Reproducción 2 y 3 (dólar y texto del margen) | tests de `lib/cotizacion.ts`, `lib/formatoImporte.ts`, `lib/precios.ts` y de los componentes | pass | El dólar se ve con 4 decimales y el texto aclara que no incluye la comisión. |
| Tests del área (precios, cotización, IVA, empresa, historial) | `pnpm --filter @platform/web exec vitest run src/lib/formatoImporte.test.ts src/lib/cotizacion.test.ts src/lib/precios.test.ts src/lib/iva.test.ts src/components/precios src/pages/empresas/precios.test.tsx src/pages/historial/CotizacionesTab.test.tsx` | pass | 12 archivos, 205 tests. |
| Build | `pnpm build` | pass | `✓ built in 2.12s`. |
| Lint | `pnpm lint` | pass | 0 errores; warnings previos ajenos al cambio. |
| Documentación | `pnpm docs:check` | pass | Documentación OK (4385 archivos), migraciones OK (798 archivos, **0 nuevas** contra `origin/dokploy`), trampas OK. |
| Prototipo | `pnpm prototipo:check` | pass | 120 pantallas al día (los 4 `.dc.html` con la nota del margen no cambian el inventario). |
| Matriz | `pnpm matriz:check` | pass | 0 specs nuevas revisadas. |
| Calidad | `pnpm calidad` | pass | oxlint, knip, jscpd, dependency-cruiser y syncpack OK; gitleaks no pudo correr (Docker no disponible). |
| DER | `pnpm der:check` | fail (ajeno) | Falla en `20261012-140000-empresas` y `20261013-120000-usuarios-y-roles`: specs que este PR no toca (deuda de la base). La spec de esta historia (`20261022-120000-precios-e-iva`) está bien. |
| Reglas vigiladas | Se cambió la regla a propósito y se comprobó que algún test falla | pass | Ver «Los tests vigilan la regla». |
| IVA al centavo (base) | pgTAP `supabase/tests/database/lote32_iva_al_centavo.test.sql` | not-run | Requiere `pnpm dev:supabase`; ya está en `dokploy` y lo corre el CI de base. |
| E2E del recorrido | `apps/web/e2e/precios-visibles.e2e.ts` | not-run | Requiere el stack local (Supabase + web servida); este entorno no tiene Docker. |

## Output Excerpts

```
 Test Files  12 passed (12)
      Tests  205 passed (205)
```

```
✓ built in 2.12s
```

```
Documentación de cambios: OK (4385 archivos comparados contra 54ea7b1bad793d5968ffe2d1f629128c40f3bee3).
Migraciones OK: 798 archivo(s), 0 nuevo(s) contra origin/dokploy.
Trampas conocidas: OK (0 migración(es), 0 prueba(s) pgTAP y 1 E2E revisados contra origin/dokploy).
```

```
Inventario del prototipo: OK (120 pantallas al día).
Matriz pantalla↔criterios: OK (0 specs nuevas revisadas, 0 exentas).
```

## Los tests vigilan la regla (FEAT-236)

Se cambió la regla a propósito, se corrieron los tests y se revirtió el cambio:

| Regla cambiada a propósito | Test que falla |
|---------------------------|----------------|
| `formatearCotizacion` con 2 decimales en vez de 4 | `lib/cotizacion.test.ts`, `components/precios/PrecioCostoBloque.test.tsx`, `pages/empresas/precios.test.tsx`, `pages/historial/CotizacionesTab.test.tsx` → **4 tests fallan** |
| `NOTA_MARGEN` con el texto viejo («Precio − Costo − Comisión del canal») | `lib/precios.test.ts`, `components/precios/PrecioCostoBloque.test.tsx` → **2 tests fallan** |

```
 Test Files  4 failed (4)
      Tests  4 failed | 77 passed (81)
```

```
 Test Files  2 failed (2)
      Tests  2 failed | 35 passed (37)
```

Con el código restaurado: `Test Files 3 passed (3) · Tests 77 passed (77)`.

## Residual Risks

- No se pudo correr pgTAP ni el E2E localmente (este entorno no tiene Docker ni stack de Supabase): la regla
  del IVA al centavo ya está en `dokploy` y la cubre el CI de base; el E2E corre en el job de e2e.
- El rótulo `[MSF-720:BUG]` del E2E no resuelve contra una spec de épica (MSF-720 es un bug, sin `tasks.md`),
  así que el manifiesto de cobertura lo lista como huérfano: es lo esperado para una historia de bug y no
  rompe el job.
- La nota del margen no cambia el cálculo: el margen sigue siendo `(Precio − Costo) / Precio`; lo que cambia
  es lo que el texto promete.

## Recommendation

Cerrar el bug: los tres síntomas tienen cobertura que falla si la regla cambia, la base ya redondea al centavo
y no se crea ninguna migración en este PR.
