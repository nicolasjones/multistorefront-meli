# Bug Verification: la tienda pública no define su propia regla de inactividad de sesión

- **Slug**: msf-740
- **Tested**: 2026-11-14
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

## Summary

**No hay nada que validar**: el `fix.md` quedó con `Status: not-applied` porque MSF-740 espera una decisión de
producto (el CTO la dejó bloqueada) y no se cambió código. No se ejecutó ninguna reproducción contra un arreglo —no
hay arreglo— ni se agregó ni modificó un solo test. Se registra como `partial` y no como `verified` porque no hubo
reproducción ni arreglo que comprobar, y no como `failed` porque no hay arreglo que haya fallado.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix) | — | not-run | No hay fix: la historia quedó bloqueada antes de tocar código (no se inventa comportamiento de sesión). |
| New / updated tests | — | not-run | No se agregó ni modificó ningún test: no hay cambio de comportamiento que fijar. |
| Regression suite | — | skipped | No hay código cambiado (el diff solo toca `.specify/bugs/msf-740/`); la suite completa la corre el CI sobre el PR. |
| Lint | `pnpm lint` | pass | Exit 0: 286 warnings y 0 errores, todos preexistentes (el diff solo toca `.specify/bugs/msf-740/`). |
| Build | `pnpm build` | pass | Exit 0: `tsc -b && vite build` → `✓ built in 5.73s`. |
| Documentación | `pnpm docs:check` | pass | `.specify/bugs/` cuenta como documentación del cambio; sin migraciones nuevas. |

## Output Excerpts

```
$ pnpm lint
> @platform/web lint
> oxlint src
… 286 warnings, 0 errors (EXIT=0; ninguno en archivos de este diff)

$ pnpm build
> @platform/web build
> tsc -b && vite build
✓ built in 5.73s
EXIT=0

$ pnpm docs:check
> node scripts/verificar-documentacion-cambios.mjs && node scripts/verificar-migraciones.mjs
Documentación de cambios: OK (3348 archivos comparados contra 54ea7b1bad793d5968ffe2d1f629128c40f3bee3).
Migraciones OK: 675 archivo(s), 4 nuevo(s) contra origin/dokploy.
```

## Residual Risks

- El comportamiento vigente sigue siendo el de MSF-700 (12 h, cierre local, vuelta a `/`), sin cambios: la tienda
  hereda la ventana del panel, el visitante anónimo ve una navegación dura a `/` al volver tras 12 h y el cliente con
  sesión abierta pierde su sesión local sin aviso.
- La nota de aprendizaje «una sesión de cliente de la tienda no vence por inactividad» sigue desactualizada respecto
  del código; se corrige en el tracker cuando se registre la decisión.
- Sin cambio en el panel: FR-009 / S4 (12 h + `/login`) queda intacto en las tres opciones.

## Recommendation

**Hold** — la historia queda `Blocked` hasta que Nicolás responda las dos preguntas de `fix.md` («La decisión que
falta»). Con la respuesta se implementa el cambio acotado que corresponda y este reporte se completa con la
reproducción ejecutada y los tests agregados.
