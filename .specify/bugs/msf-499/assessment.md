# Bug Assessment: Falta la suite Playwright E2E de la app (desvíos E2E de MSF-119/125/132/138)

- **Slug**: msf-499
- **Created**: 2026-10-15
- **Source**: pasted text (Jira MSF-499, "[Seg. E2E] Suite Playwright de la app + recorridos críticos"); sin URL
- **Verdict**: valid
- **Severity**: medium

## Report (verbatim or summarized)

"[Seg. E2E] Suite Playwright de la app + recorridos críticos (desvíos E2E de MSF-119/125/132/138)". Es un ticket de seguimiento: varias specs difirieron sus tareas E2E porque el repo no tiene suite Playwright.

## Symptom

No existe una suite E2E de la app (`apps/web` no depende de `@playwright/test`, no hay `playwright.config.*`, ni paso E2E en CI). Solo existe `infra/playwright` (servidor remoto patchright para workers). Resultado: los criterios de aceptación de recorridos críticos solo están cubiertos por Vitest/pgTAP, y quedan tareas E2E abiertas. Esperado: suite E2E ejecutable local y en CI que cubra esos recorridos.

## Reproduction

1. `find . -name "playwright.config*" -not -path "*/node_modules/*"` → vacío.
2. `grep playwright apps/web/package.json` → sin resultados; `validate.yml` no ejecuta E2E.
3. Tareas abiertas por esta causa (ver "Suspected Code Paths").

## Suspected Code Paths

- `specs/20261012-140000-acceso-y-organizacion/tasks.md:97` — T020 E2E ingreso, recuperación, cierre de sesión (SC-001, SC-003) (MSF-119).
- `specs/20261012-140000-empresas/tasks.md:43,58,71,84` — T011/T017/T021/T025 E2E empresas (listar/restringido, editar, pausar/reactivar, cambiar de empresa), "no hay suite Playwright E2E en el repo" (MSF-138).
- `specs/20261013-120000-usuarios-y-roles/tasks.md:46,83,109` — T019 (Operador abre Rentabilidad por URL), T036 (editar/suspender/reactivar), T043b (editar y guardar matriz) (MSF-125/132; nota de desvío l.122: E2E "quedan para el CI").
- `infra/playwright/{Dockerfile,compose.yaml}` — servidor remoto patchright (anti-bot), no es runner de tests de la app.
- `.github/workflows/validate.yml:31-97` — corre `test:web` y `test:db:ci`; el stack Supabase de CI excluye `kong,postgrest,edge-runtime,studio` (l.87), por lo que no sirve para un E2E real contra la app.
- `apps/web/package.json` — sin Playwright; `test` = `vitest run`.
- `apps/web/src/pages/{login.tsx,empresas,usuarios,roles,acceso-restringido}` — pantallas a cubrir.

## Root Cause Hypothesis

Gap de infraestructura de pruebas, no regresión de código: nunca se creó el harness E2E (config, fixtures de sesión/usuarios sembrados, ejecución en CI), y cada spec difirió su E2E con la misma nota. Bloqueos concretos: (a) sin `@playwright/test` ni config; (b) CI sin stack completo (sin kong/postgrest/auth gateway) y sin servir la web; (c) sin datos/fixtures de roles (Administrador, Operador, suspendido). Confianza: alta.

## Proposed Remediation

**Preferred**: spec propia (Spec Kit, alcance `refine` + CI) que cree `apps/web/e2e/` con `@playwright/test` (versión alineada a 1.61.0), `playwright.config.ts` (baseURL, webServer `vite preview`, proyecto chromium local), fixtures de login por rol con usuarios sembrados vía API admin de Supabase local (service-role solo en el setup de Node, nunca en el navegador), y specs de recorridos críticos: ingreso/recuperación/cierre de sesión (T020), empresas (T011/T017/T021/T025), Rentabilidad por URL (T019), usuarios editar/suspender/reactivar (T036), matriz de roles (T043b). Script `pnpm test:e2e`, excluido de `pnpm test`. Documentar en `docs/` y cerrar las tareas con referencia al commit.

**Alternatives**:
- Reusar `infra/playwright` como navegador remoto (`connect`): evita instalar navegador en el runner, pero patchright no es necesario y acopla tests a un servicio compartido.
- Job E2E separado y no bloqueante (nightly/manual) en self-hosted runner hasta que el stack completo sea estable; menor costo, menos gate.

**Files likely to change**:
- `apps/web/package.json`, `pnpm-lock.yaml`, `package.json` (script `test:e2e`)
- `apps/web/playwright.config.ts`, `apps/web/e2e/**`
- `.github/workflows/validate.yml` (o workflow nuevo; runner self-hosted) y/o `scripts/supabase-ci.mjs` (stack con kong/postgrest/auth)
- `specs/*/tasks.md` (marcar T020, T011, T017, T021, T025, T019, T036, T043b), `docs/`, `AGENTS.md`

**Tests to add or update**: los specs E2E listados; un chequeo de que `pnpm test:e2e` no se cuela en `pnpm test`.

## Risks & Considerations

- El stack CI actual omite servicios necesarios (kong, postgrest, auth gateway): ampliarlo aumenta tiempo/recursos del runner y toca `scripts/supabase-ci.mjs` (grupo de concurrencia `supabase-ci`).
- Credenciales de siembra: usar solo en setup Node; nada de secretos en Git (`.env.example`).
- Flakiness y coste de CI: preferir runners self-hosted; tags `@smoke` para gate mínimo.
- Alcance grande para un solo PR: dividir por recorrido/historia (regla de implementar por fase).
- Requiere spec con alcance de entrega declarado (`refine`, posiblemente `supabase`).

## Open Questions

- [NEEDS CLARIFICATION: ¿gate bloqueante en `validate.yml` o job separado/nightly?]
- [NEEDS CLARIFICATION: ¿qué recorridos de MSF-125/132 (además de los listados) entran en el alcance de este ticket?]
- [NEEDS CLARIFICATION: ¿se levanta la web en CI con `vite preview` o con la imagen `infra/refine`?]
