# Bug Verification: MSF-782 — espera determinista en el test de la cuenta web del cliente

- **Slug**: msf-782
- **Tested**: 2026-11-17
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

El síntoma era una carrera de tiempo contra el 1 s por defecto de `findByText`: reproducido de forma determinista (mock con 1,5 s
de retraso) con el error exacto del CI. Con el presupuesto de espera explícito, el mismo escenario pasa y el archivo queda
5/5 en verde; el resto del área de clientes no cambió.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (pre-fix) | `vitest run src/pages/clientes/zz-flake-repro.test.tsx` (copia con el mock de la cuenta web delayed 1,5 s) | fail | `TestingLibraryElementError: Unable to find an element with the text: Cliente creado · no se pudo crear la cuenta web en 2 tiendas` (mismo error del CI) |
| Reproduction (post-fix) | la misma copia con el mock delayed 4 s | pass | 5/5 OK: el mensaje aparece dentro del presupuesto de 5 s |
| New / updated tests | `pnpm --filter @platform/web exec vitest run src/pages/clientes/formulario-cuenta-web.test.tsx` | pass | 5/5 OK |
| Regression suite | `pnpm --filter @platform/web exec vitest run src/pages/clientes src/components/clientes` | pass | 34 archivos, 372 tests OK |
| Lint / type-check | `pnpm --filter @platform/web lint` | pass | sin errores (solo warnings preexistentes) |
| Build | `pnpm --filter @platform/web build` | pass | `tsc -b` + `vite build` OK |
| CI | job `web` del workflow `Validate` sobre el commit del cambio | pending | se confirma con el PR |

## Output Excerpts

```
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

```
 Test Files  34 passed (34)
      Tests  372 passed (372)
```

## Residual Risks

- La verificación definitiva es el job `web` del CI: el flake aparece bajo carga del runner y no se puede reproducir de forma
  natural en local. El cambio acota el problema (espera de 5 s en vez de 1 s) pero no lo elimina si el runner se saturara
  más de 5 s; en ese caso el rojo seguiría siendo de tiempo, no de lógica.
- El tope por test (`testTimeout: 15000`) sigue acotando un cuelgue real: el archivo tiene como máximo dos esperas por test
  (2 × 5 s) y queda por debajo de ese tope.
- Alcance: sin esquema, RLS, migraciones ni datos.

## Recommendation

Cerrar el bug — el error del CI se reprodujo, la causa quedó confirmada (espera por defecto de Testing Library) y el cambio la
elimina sin tocar el producto. Confirmar con el job `web` en verde de forma repetida sobre el commit del cambio.
