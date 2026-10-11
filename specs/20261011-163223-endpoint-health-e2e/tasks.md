# Tasks: Endpoint `/health` en apps/web con validación E2E

**Input**: `specs/20261011-163223-endpoint-health-e2e/` (spec.md, plan.md)

**Formato**: `- [ ] T### [STORY-x][USy] descripción`. `STORY-1`/`STORY-2` son marcadores de las historias Jira que se crean al aprobar la spec; reemplazar por la clave real (MSF-N) entonces.

**Delivery scope**: refine

## Phase 1: US1 — `/health` estático (Priority: P1) 🎯 MVP

**Goal**: `/health` responde 200 JSON con el commit SHA, sin depender de React ni de servicios downstream.

**Independent Test**: `pnpm --filter @platform/web build && pnpm --filter @platform/web preview` y `curl localhost:4300/health` devuelve `{"status":"ok","commit":"..."}`.

- [ ] T001 [STORY-1][US1] Test Vitest `apps/web/vite-plugin-health.test.ts`: el payload usa `VERCEL_GIT_COMMIT_SHA`, luego `GITHUB_SHA`, luego `"dev"`, y contiene solo `status` y `commit` (FR-003, FR-007)
- [ ] T002 [STORY-1][US1] Implementar `apps/web/vite-plugin-health.ts` (emite `health.json` en `generateBundle` y middleware `/health` para dev/preview) y registrarlo en `apps/web/vite.config.ts` (FR-001, FR-002)
- [ ] T003 [STORY-1][US1] Test Vitest `apps/web/vercel.test.ts`: en `vercel.json` la regla `/health` → `/health.json` aparece antes del catch-all `/(.*)` y existen los headers `no-store` y `application/json`
- [ ] T004 [STORY-1][US1] Editar `apps/web/vercel.json`: rewrite `/health` antes del catch-all y bloque `headers` para `/health` y `/health.json` (FR-002)
- [ ] T005 [STORY-1][US1] Verificar localmente: `pnpm test`, `pnpm build`, `curl /health` contra `vite preview`; confirmar que `dist/health.json` existe y que `/health` no redirige a login (FR-001)

**Checkpoint**: US1 entregable y verificable por `curl` sin CI. `/clear` antes de la fase 2.

---

## Phase 2: US2 — E2E en staging (Priority: P2)

**Goal**: un workflow independiente valida `/health` en staging tras cada deploy y reporta fallos sin bloquear promoción.

**Independent Test**: `workflow_dispatch` con `WEB_STAGING_URL` válida pasa; con URL inexistente o SHA distinto falla con mensaje diagnosticable.

- [ ] T006 [STORY-2][US2] Agregar `@playwright/test` como devDependency de `apps/web`, script `test:e2e` (`playwright test -c e2e/playwright.config.ts`) y alias raíz `test:e2e:web`; actualizar `pnpm-lock.yaml`
- [ ] T007 [STORY-2][US2] Excluir `e2e/**` de `test.exclude` en `apps/web/vite.config.ts` para que Vitest no recoja los specs de Playwright
- [ ] T008 [STORY-2][US2] Crear `apps/web/e2e/playwright.config.ts` y `apps/web/e2e/health.spec.ts`: fixture `request`, `E2E_BASE_URL` obligatoria, `expect.poll` (5 s / 5 min) hasta 200 + `status:"ok"` + `commit === EXPECTED_SHA`, header opcional `x-vercel-protection-bypass`, mensajes sin secretos (FR-004, FR-005, FR-006, FR-008)
- [ ] T009 [STORY-2][US2] Crear `.github/workflows/e2e-health-staging.yml` (runner `[self-hosted, platform-local]`, `push` a `staging` + `workflow_dispatch`, `E2E_BASE_URL=vars.WEB_STAGING_URL`, `EXPECTED_SHA=github.sha`, artefacto de reporte al fallar; sin `needs` ni inclusión en `promover-todo-a-produccion.yml`) (FR-004, FR-005)
- [ ] T010 [STORY-2][US2] Documentar en `docs/verificar-health-web.md` (variable `WEB_STAGING_URL`, secret opcional de bypass, cómo correr `test:e2e:web` local, que no bloquea promoción) y actualizar `apps/web/README.md`/`AGENTS.md` si listan comandos de prueba; correr `pnpm docs:check`
- [ ] T011 [STORY-2][US2] Validación final: `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm infra:config`, `pnpm docs:check`; ejecutar el workflow por `workflow_dispatch` contra staging y registrar el resultado; `graphify update .`

**Checkpoint**: Spec completa. Al mergear el PR, actualizar la fila correspondiente de `docs/roadmap-template.md` (paso manual del cierre).

---

## Matriz de trazabilidad

| Jira | US | Rel. Jira→US | Tareas | Rel. US→tareas | Requisitos |
|---|---|---|---|---|---|
| MSF-5 (epic) | — | 1:N (2 historias) | — | — | todos |
| STORY-1 (por crear) | US1 | 1:1 | T001–T005 | 1:N | FR-001, FR-002, FR-003, FR-007 |
| STORY-2 (por crear) | US2 | 1:1 | T006–T011 | 1:N | FR-004, FR-005, FR-006, FR-008 |

Dependencias: US2 depende de US1 (T008 necesita el payload de T002). T006 y T007 son paralelizables entre sí.
