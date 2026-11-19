# Bug Verification: etiquetas de evento legibles e importes con formato de moneda

- **Slug**: msf-618
- **Tested**: 2026-11-16
- **Assessment**: el reporte del tracker (MSF-618, épica MSF-585); no hay `assessment.md` en esta historia.
- **Fix**: ./fix.md
- **Result**: verified

## Summary

El síntoma no se reproduce: en la columna **Tipo** (y en el filtro por tipo) cada tipo de evento sale con su etiqueta
legible —incluidos los que antes caían en el respaldo sin tilde— y los importes del detalle salen con su moneda y sus
separadores. El test nuevo recorre las migraciones: si una agrega un tipo y nadie lo etiqueta, el CI se pone rojo.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix) | `pnpm --filter @platform/web exec vitest run src/lib/actividad.test.ts src/lib/actividad.tipos.test.ts` | pass | 62 tests: etiquetas con tildes (incluidos `reparacion.creada`, `cotizacion.cargada`, `despacho.envio_guardado`, `campana_correo.baja`, `respuesta_rapida.creada`) e importes con moneda. |
| New / updated tests | `pnpm --filter @platform/web exec vitest run src/lib/actividad.test.ts src/lib/actividad.tipos.test.ts src/lib/exportarActividad.test.tsx src/lib/exportarActividadCsv.test.ts src/pages/actividad src/components/actividad src/higieneReferenciasInternas.test.ts` | pass | 7 archivos, 109 tests en verde. |
| Test que vigila la regla | Se revierte el orden del respaldo a texto y se corre `node --test infra/runner/restaurar-bin.test.mjs` | pass (detecta) | Con el código viejo el caso «2.10.0 vs 2.9.0» falla; con el fix, los 6 tests pasan. |
| Migration guard | `node scripts/verificar-migraciones.mjs` | pass | «Migraciones OK: 717 archivo(s), 1 nuevo(s) contra origin/dokploy». |
| Lint / type-check / build | `pnpm lint`, `pnpm build` | pass | Lint: 0 errores (solo los warnings preexistentes). Build: `✓ built in 2.75s`. |
| Documentación | `pnpm docs:check` | pass | Documentación de cambios OK, migraciones OK, trampas conocidas OK. |
| Calidad determinista | `pnpm calidad` | partial | oxlint, knip (código muerto), jscpd, dependency-cruiser y syncpack en verde. **gitleaks no se pudo correr**: este entorno no tiene el binario ni permiso de Docker (corre en el CI). |
| pgTAP | `pnpm test:db` | not-run | Este entorno no tiene Docker: el pgTAP de cobros corre en el CI. |
| E2E | — | not-applicable | El cambio es de formato: no hay criterio de pantalla nuevo (ver «E2E» más abajo). |

## Output Excerpts

```
 Test Files  7 passed (7)
      Tests  109 passed (109)

ℹ tests 6
ℹ pass 6
ℹ fail 0                       (node --test infra/runner/restaurar-bin.test.mjs)

Migraciones OK: 717 archivo(s), 1 nuevo(s) contra origin/dokploy.
Documentación de cambios: OK. Migraciones OK. Trampas conocidas: OK.
```

## Residual Risks

- **El pgTAP no se corrió localmente** (sin Docker): el cambio del detalle del cobro (`supabase/tests/database/cobros_comprobante.test.sql`)
  se verifica en el CI. Las dos aserciones que cambian («Cobro de 100%» → «Cobro de ARS 100%») y el caso nuevo de la
  cuenta en dólares son de texto exacto sobre el detalle que arma la función.
- **Filas viejas**: los eventos guardados antes de la migración no llevan moneda en el texto; se siguen mostrando como
  pesos (son cobros en pesos) y el formato de importes les aplica igual.
- **E2E**: la historia no define criterios de aceptación de pantalla (es un arreglo de formato), así que no hay E2E nuevo;
  el E2E de la pantalla de Actividad sigue vigente.
- Las filas «Cambio de empresa activa» siguen registrándose (cambio de comportamiento, no de formato): quedan
  registradas como **MSF-985**, con dueño.

## Recommendation

Cerrar el bug: el síntoma del ticket está resuelto y verificado con tests que fallan si la regla se rompe. Quedan
**MSF-985** (decidir si las filas «Cambio de empresa activa» se siguen registrando) y **MSF-604** (la descripción de la
pantalla), ambos fuera del alcance de este arreglo de formato.
