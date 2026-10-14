# Tasks: Endpoint /ping (BORRAR)

**Input**: `specs/20261014-150000-endpoint-ping-borrar/` (spec.md, plan.md) · **Épica**: MSF-495 · **Delivery scope**: `refine`

**Formato**: `- [ ] T### [STORY-x][USy] descripción`.

## Phase 1: US1 — Endpoint GET /ping (MSF-495)

**Goal**: `GET /ping` responde `200` con `{"ok":true}` siguiendo el patrón de `/health`.

**Independent Test**: `curl -i <host>/ping` → `200`, `application/json`, `{"ok":true}`; `/health` sin cambios.

- [x] T001 [MSF-495][US1] Agregar `location /ping` en `apps/web/nginx.conf` junto a `/health`, con `return 200 '{"ok":true}'` y `Content-Type: application/json` (FR-001, FR-002, SC-001)
- [ ] T002 [MSF-495][US1] Verificar localmente `GET /ping` (200, cuerpo `{"ok":true}`, content-type JSON) y que `/health` no cambió; correr `pnpm lint`, `pnpm build`, `pnpm infra:config`, `pnpm test` y dejar la evidencia en el PR (SC-001, SC-002, SC-003)
- [x] T003 [MSF-495][US1] Documentar `/ping` junto a `/health` en `apps/web/README.md` y correr `pnpm docs:check` (Principio VIII)

## Matriz de trazabilidad

| Jira | US | Tareas |
|------|----|--------|
| MSF-495 | US1 | T001, T002, T003 |
