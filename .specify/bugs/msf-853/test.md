# Bug Verification: código sin uso de avisos de consulta (MSF-853)

- **Slug**: msf-853
- **Tested**: 2026-11-13
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

## Summary

El camino directo del aviso de consulta ya no está en el repo: la Edge Function `enviar-aviso-consulta`, su
flow de Kestra `avisos-consultas`, la tabla `dominio.consultas_avisos`, sus tres RPC y el ayudante
`private.correo_avisos_consulta` se borran con una migración reversible, y el pgTAP, el E2E y los textos al
usuario quedan sobre el camino vigente (`private.emitir_aviso` → `public.avisos_pendientes`). El resultado es
**partial** y no `verified` porque la reproducción (el E2E que exercise el camino viejo) y el pgTAP no se
pudieron ejecutar en este entorno: necesitan el stack local de Supabase y acá no hay permisos de docker.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix) | `grep -rn "enviar-aviso-consulta\|avisos-consultas\|consultas_avisos\|AVISOS_CONSULTAS" apps/ infra/ supabase/ package.json .env.example` | pass | No queda ninguna referencia viva: solo las menciones que explican el retiro (`docs/`, pgTAP, `specs/` histórico). |
| New / updated tests (web) | `pnpm --filter @platform/web exec vitest run src/pages/empresas/CorreoAvisosConsultas.test.tsx` | pass | 10/10 (`Test Files 1 passed`, `Tests 10 passed`). |
| New / updated tests (flows) | `node --test infra/kestra/validar-*.test.mjs` | pass | 73/73 tras borrar el test del flow retirado. |
| pgTAP (nuevo y actualizado) | `pnpm test:db` | not-run | Requiere el stack local (`pnpm dev:supabase`); este entorno no da permisos de docker. Lo corre el CI. |
| E2E de consultas | `pnpm --filter @platform/web test:e2e consultas-recorrido` | not-run | Misma razón (stack local). El recorrido del camino vigente ya venía de la base (PR #907) y este cambio solo ajusta dos comentarios. Se verificó que el test se collected y que el archivo type-checka. |
| Colección y tipos del E2E | `pnpm exec playwright test --list consultas-recorrido` + `tsc --ignoreConfig --noEmit --strict …` | pass | 1 test listado; 0 errores de tipos. |
| Escritura directa en los E2E (base) | `pnpm e2e:escritura:check` · `pnpm test:e2e:escritura` | pass | «ningún spec escribe directo en tablas de solo lectura para service_role»; 16/16. |
| Lint / build | `pnpm lint` · `pnpm build` | pass | Lint: 0 errores (solo warnings preexistentes de oxlint). Build: ok. |
| Documentación y migraciones | `GITHUB_BASE_REF=dokploy pnpm docs:check` | pass | `Documentación de cambios: OK (21 archivos…)` y `Migraciones OK: 639 archivo(s), 1 nuevo(s)`. |
| Compose de Kestra | `pnpm infra:config:kestra` | pass | `docker compose config --quiet` sin errores. |
| Calidad determinista | `pnpm calidad` | partial | oxlint, knip (código muerto), jscpd, dependency-cruiser y syncpack ok; **gitleaks no se pudo correr** (docker sin permisos) y lo corre el CI. |

## Output Excerpts

```
Test Files  1 passed (1)
     Tests  10 passed (10)
```

```
ℹ tests 73
ℹ pass 73
ℹ fail 0
```

```
Documentación de cambios: OK (21 archivos comparados contra origin/dokploy).
Migraciones OK: 639 archivo(s), 1 nuevo(s) contra origin/dokploy.
```

```
---- RESUMEN ----
  ok         oxlint (SAST)
  ok         knip (código muerto)
  ok         jscpd (duplicación)
  ok         dependency-cruiser (arquitectura)
  ok         syncpack (versiones)
  hallazgos  gitleaks (secretos)   ← no se pudo correr: docker sin permisos
```

## Residual Risks

- **pgTAP sin correr localmente**: `consultas_aviso.test.sql` (28 asserts) y `avisos_consulta_nueva.test.sql`
  (18 asserts) se ejecutan en el CI contra el stack. El riesgo mayor es un error de sintaxis SQL en el test
  nuevo o en la migración; la migración pasó el guard de idempotencia y de versión (`Migraciones OK`), pero eso
  no aplica el SQL.
- **La migración borra la tabla con sus filas**: si algún entorno tuviera avisos `pendiente` en esa cola
  vieja, no se enviarían. No hay consumidor vivo (el único era el flow que se borra) y el camino vigente los
  cubre, pero conviene mirar la cola en dev/stg antes de promover.
- **`private.exclusiones_exportacion_total()`**: se copió la definición de `20270224110206` menos la fila de la
  tabla; si otra migración posterior la hubiera redefinido, el assert «toda exclusión nombra una tabla que
  existe» lo detectaría en el CI.
- **gitleaks sin correr localmente**: el cambio solo borra variables de ejemplo (incluido un base64 de ejemplo),
  así que el riesgo de secretos es menor que antes; igual lo corre el CI.

## Recommendation

Cerrar la historia cuando el CI haya verde el job de base (pgTAP + E2E) y el de calidad (gitleaks): la
reproducción no se pudo repetir localmente por falta del stack, así que el cierre depende de esa evidencia.
