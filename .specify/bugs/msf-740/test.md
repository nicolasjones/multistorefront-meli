# Bug Test: la tienda pública hereda la regla de inactividad de sesión del panel

- **Slug**: msf-740
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Date**: 2026-11-16
- **Result**: verified

## Summary

El arreglo se validó con un test que **falla antes del cambio** (el visitante de la tienda era expulsado a la
portada tras 12 h) y pasa después, más la regresión del panel (12 h → cierre y `/login`), que no debe cambiar.

- **Vitest (nuevo) `apps/web/src/lib/arranqueSesion.test.ts`**: fija las dos ramas de la regla. Con el código
  anterior a MSF-740 los dos casos de la tienda fallan (el control se instalaba en el host de tienda).
- **E2E (actualizado) `apps/web/e2e/tienda-sesion-vencimiento.e2e.ts`**: el visitante que vuelve tras 13 h no
  sale de la página, no hay pedido a `/auth/v1/logout` (ni local ni global) y no aparece el 404 de `/login`.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproducción (post-fix) | `pnpm --filter @platform/web exec vitest run src/lib/arranqueSesion.test.ts` | pass | 4/4. Con la regla rota a propósito (la tienda vuelve a instalar el control) fallan los 2 casos de la tienda: el test vigila la regla. |
| Tests del área tocada | `pnpm --filter @platform/web exec vitest run src/lib/arranqueSesion.test.ts src/lib/vencimientoSesion.test.ts src/lib/tiendaCuenta.test.ts src/providers/authProvider.test.ts` | pass | 69/69 (4 archivos): la regla nueva, la del panel, la cuenta web y el `authProvider`. |
| Carga del spec E2E | `pnpm --filter @platform/web exec playwright test e2e/tienda-sesion-vencimiento.e2e.ts --list` | pass | El spec carga y lista 1 test (sintaxis e imports OK). |
| Corrida del E2E contra la app | — | not-run | El caso necesita el stack de Supabase con el seed (la tienda tiene que resolverse por `Host`): en este entorno no hay Docker. Lo corre el job `e2e-tienda` del CI (`VITE_PANEL_HOSTS` + `E2E_TIENDA_CI=1`, donde además no se omite). |
| Lint | `pnpm lint` | pass | Exit 0: 286 warnings y 0 errores, todos preexistentes (ninguno en los archivos de este diff). |
| Build | `pnpm build` | pass | Exit 0: `tsc -b && vite build` → `✓ built in 2.40s`. |
| Calidad | `pnpm calidad` | pass | oxlint / knip (código muerto) / jscpd (duplicación) / dependency-cruiser (arquitectura) / syncpack en verde. **gitleaks no pudo correr** (sin permisos del socket de Docker en este entorno). |
| Documentación | `pnpm docs:check` | pass | `Documentación de cambios: OK`; migraciones sin cambios en este diff (tras integrar la base, ver «Output Excerpts»). |

## Output Excerpts

```
$ pnpm --filter @platform/web exec vitest run src/lib/arranqueSesion.test.ts
 Test Files  1 passed (1)
      Tests  4 passed (4)

$ pnpm --filter @platform/web exec vitest run src/lib/arranqueSesion.test.ts src/lib/vencimientoSesion.test.ts src/lib/tiendaCuenta.test.ts src/providers/authProvider.test.ts
 Test Files  4 passed (4)
      Tests  69 passed (69)

$ pnpm --filter @platform/web exec playwright test e2e/tienda-sesion-vencimiento.e2e.ts --list
Listing tests:
  [chromium] › tienda-sesion-vencimiento.e2e.ts:24:1 › [MSF-740:MSF-740] en la tienda, tras más de 12 h sin actividad el primer clic no cierra la sesión ni redirige
Total: 1 test in 1 file

$ pnpm lint
> oxlint src
 … 286 warnings, 0 errors (EXIT=0; ninguno en archivos de este diff)

$ pnpm build
> tsc -b && vite build
✓ built in 2.40s
 EXIT=0

$ pnpm docs:check
> node scripts/verificar-documentacion-cambios.mjs && node scripts/verificar-migraciones.mjs
Documentación de cambios: OK (3351 archivos comparados contra 54ea7b1bad793d5968ffe2d1f629128c40f3bee3).
Migraciones OK (el diff de esta historia no toca migraciones).
```

**Prueba de que el test vigila la regla** (se revierte el cambio de prueba):

```
# con la regla rota a propósito (la tienda también instala el control)
 FAIL  src/lib/arranqueSesion.test.ts > instalarVencimientoDeSesion > en la tienda no cierra la sesión ni redirige al vencer
 FAIL  src/lib/arranqueSesion.test.ts > instalarVencimientoDeSesion > en la tienda no escribe la marca de actividad
      Tests  2 failed | 2 passed (4)
```

## Residual Risks

- El E2E no se pudo correr en este entorno (sin Docker para el stack de Supabase): lo corre el job `e2e-tienda`
  del CI. El caso carga (`--list`) y su mecánica es la del E2E de MSF-673, que ya corría en ese job.
- La rama venía atrasada respecto de su base (`epic/MSF-515-lote-1-seguridad-tienda`): el CI de documentación y
  el guard de migraciones fallaban por el contenido heredado de la base (la migración `20270323100100` ya
  aplicada en `origin/dokploy` y el inventario de docs sin regenerar), no por este diff. Se integró la base.
- Con la regla aplicada, la sesión de un cliente de la tienda sigue viva hasta que se cierra la pestaña o
  hasta el tope de 30 días del servidor (riesgo aceptado, escrito en `fix.md` y en D-11 de la spec de la épica).
- Sin cambio en el panel: FR-009 / S4 (12 h + `/login`) queda intacto y lo fijan los casos del panel del Vitest.

## Recommendation

Aprobar. Si el producto quiere una regla propia para la tienda (otra ventana, redirección a `/ingresar`,
«mantener sesión»), es funcionalidad nueva con spec de Spec Kit (queda anotado como seguimiento).
