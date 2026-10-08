# Bug Verification: una conexión en credencial_invalida o error queda trabada para siempre

- **Slug**: conexion-invalida-trabada
- **Tested**: 2026-09-26
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

La reproducción del assessment ya no se da: en el Kestra y el Supabase del
template, una conexión en `error` vuelve a correr por el genérico y queda
`activa`; una en `credencial_invalida` no la recorre el programado, pero el
disparo manual del administrador y la actualización de la credencial la
destraban, y la ejecución exitosa la deja `activa` (FR-013). Sin
regresiones en pgTAP.

## Checks Performed

Stack de desarrollo del template (Kestra `:8082`, Supabase `:5434`), en
ventanas sin CI viejo del producto.

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproducción antes del arreglo | `pnpm test:kestra:conexion-trabada:e2e` sin la migración | fail (esperado) | `Error: el genérico no la despachó (SUCCESS, 0 despachos)` (ejecución `2ZXBxuJu6tg6RYUxp0RRWQ`). |
| pgTAP antes | `conexion_invalida_trabada.test.sql`, `ciclo_ejecuciones_workers.test.sql` | fail (esperado) | `not ok 1–5, 7`; ciclo `not ok 18` (esperaba `CONEXION_CREDENCIAL_INVALIDA`). |
| Reproducción después | `pnpm test:kestra:conexion-trabada:e2e` | pass | 5 escenarios; detalle abajo. |
| pgTAP nuevo | `conexion_invalida_trabada.test.sql` | pass | 16/16. |
| pgTAP del ciclo | `ciclo_ejecuciones_workers.test.sql` | pass | 62/62. |
| pgTAP completo | `pnpm test:db` sobre la base restaurada con las migraciones de esta rama | pass | 13 archivos, 422 pruebas. |
| Compose / catálogo / docs | `pnpm infra:config:kestra`, `template:capabilities:check --base origin/main`, `template:adoption:check`, `test:template:adoption`, `docs:check` | pass | |
| Lint / build web | `pnpm lint`, `pnpm build` | skipped | No se tocó código de `apps/web`. |

Escenarios del E2E:

| Escenario | Resultado |
|-----------|-----------|
| Conexión en `error`, genérico | La despacha (1 `despacho_ssh`), SUCCESS, conexión `activa`. |
| Conexión en `credencial_invalida`, genérico | No la despacha (0), estado sin cambios. |
| Disparo manual del administrador (RPC) + dedicado | `iniciar_ejecucion_worker` aceptado; despacho SUCCESS; conexión `activa`. |
| Programado sobre `credencial_invalida` | Rechazado con `CONEXION_CREDENCIAL_INVALIDA`. |
| Actualizar la credencial | Conexión `activa`; el genérico la vuelve a despachar y queda `activa`. |

## Output Excerpts

```
Genérico con la conexión en error...        generico-error: ejecución 5TUIINo541YPD8bnJR9FrS
Genérico con la conexión en credencial_invalida...  T8fD5DcjPrNq3WOZ5LuZp
Disparo manual del administrador...          dedicado-manual: ejecución 3EmyerUI1aeFeTZDwCxcVn
Programado sobre credencial_invalida (sin cambios)...
Actualización de la credencial...            generico-credencial-actualizada: ejecución 3tNGCg1HYlQyN9yutu7KtB
OK: FR-013 validado en ejecuciones reales sin apariciones del centinela.
Files=13, Tests=422 ... Result: PASS
```

## Incidencias durante la verificación

- Kestra 1.3.35 agotó el heap al publicar el genérico en corridas que no
  eran la primera tras un reinicio (mismo fenómeno documentado en
  `reintentos-credencial-invalida/fix.md`). La corrida válida se hizo tras
  reiniciar Kestra.
- La base 5434 se restauró con backup previo y el procedimiento de
  `scripts/reset-db-ci.mjs` antes de la suite completa, para que tuviera
  exactamente las migraciones de esta rama.

## Residual Risks

- El E2E usa los flows de `main`, sin el corte de reintentos de #60: el
  escenario de credencial rechazada en un intento manual solo queda acotado
  a un login cuando #60 esté mergeado. Por eso el orden de merge es #60 y
  después este.
- Refine todavía no ofrece el disparo manual ni un mensaje propio para
  `CONEXION_CREDENCIAL_INVALIDA` (follow-up en fix.md).
- En el template nada escribe `error`; el cambio protege a productos que lo
  usen.

## Recommendation

Cerrar el bug: verificado de punta a punta. Mergear después de #60 e
integrar `main` antes del merge (conflicto esperado solo en la versión y
rutas de `worker-execution-cycle`, que queda 1.3.0).

## Integración con main tras el merge de #60 (2026-09-26)

Conflictos solo en el catálogo, `template-adoption.json`, `package.json` y
la guía de adopción (ver commit 3d5bfe2): `worker-execution-cycle` queda en
1.3.0 con las rutas de ambas migraciones; la guía conserva la §3.3 de #60 y
suma la §3.4. Estáticos de reintentos y evidencia 11/11,
`test:template:adoption` 11/11, `template:*:check`, `docs:check`,
`test:kestra:deploy-flow` 4/4 y `pnpm test:db` sobre la base restaurada con
las migraciones integradas: 14 archivos, 443 pruebas, PASS.
