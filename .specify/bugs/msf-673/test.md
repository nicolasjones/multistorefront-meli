# Bug Verification: la tienda pública manda al visitante a `/login` (404) y le cierra la sesión tras 12 h

- **Slug**: msf-673
- **Tested**: 2026-11-01
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

El síntoma ya no se reproduce: en un host de tienda, el primer clic de un visitante que vuelve
pasadas 13 h no navega a `/login`, no muestra la 404 de la tienda y no pide el cierre de sesión a
Auth. El panel sigue venciendo la sesión por inactividad como antes (12 h → cierre → `/login`).

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix) | `WEB_PORT=4397 pnpm --filter @platform/web exec playwright test e2e/tienda-sesion-vencimiento.e2e.ts` (build con `VITE_PANEL_HOSTS=localhost,127.0.0.1`, servido con `vite preview`) | pass | El clic tras 13 h no redirige; sin el arreglo el mismo test falla. |
| Reproduction (con el defecto) | Se reintrodujo `seguirActividad` en `main.tsx` y se volvió a correr el E2E | fail (esperado) | `redirigio` = `true`: el clic navega a `/login` — confirma que el test detecta el defecto. |
| New / updated tests | `pnpm --filter @platform/web exec vitest run src/lib/arranque.test.ts src/lib/vencimientoSesion.test.ts src/lib/tienda.test.ts` | pass | 32 tests OK (3 archivos). |
| Regression suite | `pnpm --filter @platform/web build` (`tsc -b && vite build`) | pass | Sin errores de tipos ni de bundling. |
| Lint / type-check | `pnpm lint` (oxlint) | pass | 0 errores; los avisos de `set-state-in-effect` son preexistentes en archivos ajenos al cambio. |
| Documentación | `pnpm docs:check` | pass | Documentación de cambios OK; migraciones sin novedades contra `origin/dokploy`. |
| Cierre único (concurrencia) | `pnpm --filter @platform/web exec vitest run src/lib/arranque.test.ts` | pass | Varios clics tras el vencimiento → un solo `signOut` y una sola navegación a `/login`. |

## Output Excerpts

```
 Test Files  3 passed (3)
      Tests  32 passed (32)
```

```
 ✓  1 [chromium] › e2e/tienda-sesion-vencimiento.e2e.ts:19:1 › [MSF-673:MSF-673] en la tienda, tras más de 12 h sin actividad el primer clic no manda a /login ni cierra la sesión (9.7s)
  1 passed (14.8s)
```

Con el defecto reintroducido (control instalado en todos los hosts):

```
 Error: expect(received).toBe(expected) // Object.is equality
    Expected: false
    Received: true
      > 49 |   expect(redirigio).toBe(false)
  1 failed
```

## Residual Risks

- **No se reprodujo contra un Supabase vivo**: el E2E no necesita la base (el defecto es de
  arranque del navegador) y el entorno no tiene Docker. La resolución de la tienda por dominio
  (`publico.tienda_por_dominio`) no se ejercita: con la base caída la tienda muestra «No pudimos
  cargar la tienda», pero el control de vencimiento tampoco se instala (es una decisión de host,
  anterior a cualquier consulta). El resto de los recorridos de tienda (`e2e/tienda-*.e2e.ts`)
  siguen requiriendo `pnpm dev:supabase` y no corren en el CI público.
- **Build sin `VITE_PANEL_HOSTS`**: en ese caso (y solo en ese caso) la app sirve el panel para
  cualquier host, así que el E2E se omite con ese motivo en vez de fallar. En producción la variable
  se pasa como build arg (`apps/web/Dockerfile`) y la tienda no se enruta sin ella (falla seguro).
- **Sesión de la cuenta web en la tienda**: con este arreglo la sesión del cliente de la tienda ya
  no la cierra la regla de inactividad del panel; queda vigente hasta su salida o el tope de 30 días
  del servidor. Está documentado (`docs/acceso-ingreso.md`) y con seguimiento propio
  (Tarea `seguimiento` MSF-740 en It's a Plan, dueño: épica MSF-237 / F-CLI-06).
- El cierre de sesión del panel no se cambió: sigue yendo a `/login` (ruta que en el panel existe).

## Recommendation

Cerrar el bug — verificado de punta a punta en el navegador (E2E que falla con el defecto y pasa
con el arreglo) y con tests de unidad que fijan la política y el cableado por host.
