# Implementation Plan: Endpoint `/health` en apps/web con validación E2E

**Branch**: `epic/MSF-5-test-e2e-endpoint-health-en-apps-web` | **Date**: 2026-10-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/20261011-163223-endpoint-health-e2e/spec.md`

## Summary

`/health` es un archivo estático `health.json` generado en cada build de apps/web con el commit SHA, servido directo por Vercel mediante un rewrite explícito `/health` → `/health.json` ubicado antes del catch-all a `index.html`. La primera suite Playwright E2E del repo (`apps/web/e2e/`) lo consulta por HTTP contra la URL fija de staging y reintenta hasta que el SHA devuelto coincida con el commit que disparó el workflow. El workflow es independiente: reporta, no bloquea la promoción.

## Technical Context

**Language/Version**: TypeScript (Vite 8, Node 24); Playwright Test para E2E

**Primary Dependencies**: `@playwright/test` (nueva devDependency de `apps/web`, solo el cliente HTTP `request`: no se descargan navegadores); Vercel (variable de sistema `VERCEL_GIT_COMMIT_SHA`)

**Storage**: N/A

**Testing**: Vitest (unidad: generador del payload y orden de rewrites en `vercel.json`); Playwright (E2E contra staging)

**Target Platform**: Vercel (estático) y runner self-hosted `[self-hosted, platform-local]`

**Project Type**: web (apps/web) + CI

**Performance Goals**: respuesta de `/health` < 2 s (SC-001)

**Constraints**: sin dependencias downstream (FR-007); sin secretos en Git; sin runners de GitHub

**Scale/Scope**: 1 archivo generado, 1 plugin Vite, 1 test E2E, 1 workflow

## Constitution Check

- I (aislamiento): sin datos ni tablas; el cuerpo no expone información sensible. OK.
- II (spec antes de implementar): esta spec. OK.
- IV (despliegues independientes): el workflow no toca Supabase/Kestra/VPS. OK.
- V (simplicidad): sin servidor ni función serverless nueva; URL fija en variable de repositorio. OK.
- VI (panel operable): no agrega pantalla de navegación; N/A.

Sin violaciones; no se requiere Complexity Tracking.

## Decisiones de diseño

1. **Mecanismo estático (Q4)**: plugin Vite en `apps/web/vite.config.ts` (o módulo `apps/web/vite-plugin-health.ts` importado ahí) que en `generateBundle` emite `health.json` con `{"status":"ok","commit":"<sha>"}`. SHA = `VERCEL_GIT_COMMIT_SHA` → `GITHUB_SHA` → `"dev"`. No incluye nada más (sin timestamps ni URLs internas).
2. **Rewrite**: Vercel sirve primero el filesystem y luego aplica rewrites; como `/health` no es un archivo, el catch-all lo capturaría. Se agrega en `apps/web/vercel.json`, antes del catch-all, `{ "source": "/health", "destination": "/health.json" }` y un bloque `headers` para `/health` y `/health.json` con `Cache-Control: no-store` y `Content-Type: application/json`. `/health.json` también queda accesible directo.
3. **Local reproducible**: `vite dev` y `vite preview` no leen `vercel.json`; el mismo plugin registra un middleware (`configureServer` / `configurePreviewServer`) que responde `/health` con el mismo payload, para que el test y `curl` funcionen en local.
4. **Guard de Refine**: `/health` se sirve antes de que cargue la SPA, por lo que el `accessControlProvider` no lo alcanza; se documenta como invariante (edge case de la spec).
5. **E2E (Q2, Q3)**: `apps/web/e2e/health.spec.ts` usa el fixture `request` (sin navegador). Lee `E2E_BASE_URL` (obligatoria; si falta, falla con "no se pudo resolver la URL del entorno") y `EXPECTED_SHA`; con `expect.poll` (intervalo 5 s, timeout 5 min) espera 200 + `status:"ok"` + `commit === EXPECTED_SHA`. Si la protección de despliegues de Vercel está activa en la URL de staging, se envía opcionalmente el header `x-vercel-protection-bypass` desde el secret `VERCEL_AUTOMATION_BYPASS_SECRET` (nunca se imprime). Los mensajes de fallo muestran código de estado y SHA esperado vs. recibido.
6. **Aislamiento de Vitest**: `vite.config.ts` excluye `e2e/**` de `test.exclude` para que `pnpm test` no recoja los `.spec.ts` de Playwright.
7. **Workflow (Q1, Q5)**: `.github/workflows/e2e-health-staging.yml`, `runs-on: [self-hosted, platform-local]`, disparadores `push` a `staging` y `workflow_dispatch`. `E2E_BASE_URL = vars.WEB_STAGING_URL`, `EXPECTED_SHA = github.sha`. Sin `needs` hacia/desde otros workflows y sin sumarse a `promover-todo-a-produccion.yml`. Sube el reporte de Playwright como artefacto al fallar.
8. **Conectividad del runner**: se asume salida HTTPS a Vercel; si no existe, el job falla con error de red acotado por timeouts (edge case de la spec).

## Project Structure

### Documentation (this feature)

```text
specs/20261011-163223-endpoint-health-e2e/
├── spec.md
├── plan.md
├── tasks.md
└── checklists/requirements.md
```

### Source Code (repository root)

```text
apps/web/
├── vercel.json                 # rewrite /health + headers
├── vite.config.ts              # registra plugin, excluye e2e de Vitest
├── vite-plugin-health.ts       # genera health.json y middleware dev/preview
├── vite-plugin-health.test.ts  # unidad
├── vercel.test.ts              # orden de rewrites
├── package.json                # @playwright/test + script test:e2e
└── e2e/
    ├── playwright.config.ts
    └── health.spec.ts
.github/workflows/e2e-health-staging.yml
docs/verificar-health-web.md
```

**Structure Decision**: todo el código vive en `apps/web` (regla del proyecto); el único artefacto fuera es el workflow y su documentación.

## Riesgos

- Vercel Authentication en previews/branch URLs puede responder 401: mitigado con el bypass opcional (decisión 5).
- Carrera deploy/workflow: mitigada por el polling por SHA (FR-006).
- El plan Hobby no separa producción de `main`; fuera de alcance (ver spec 20261005-140934).
