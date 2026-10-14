# Plan: Endpoint /ping (BORRAR)

**Spec**: `specs/20261014-150000-endpoint-ping-borrar/spec.md` · **Épica**: MSF-495 · **Delivery scope**: `refine`

## Enfoque

Agregar en `apps/web/nginx.conf`, junto a `location /health`, una `location /ping` que responda `200` con `{"ok":true}`, siguiendo el mismo patrón (`return 200`, `access_log off`). Dado que el cuerpo es JSON, la respuesta declara `Content-Type: application/json` (FR-001). Documentar el endpoint en `apps/web/README.md` (Principio VIII).

## Constitución

- Sin tablas ni migraciones → sin RLS ni esquema que declarar (Principio VII); sin reversión de migraciones.
- Documentación (Principio VIII): nota en `apps/web/README.md`; `pnpm docs:check` debe pasar.
- Validación: `pnpm lint`, `pnpm build`, `pnpm infra:config`, `pnpm test`; verificación de `/ping` y `/health` contra la imagen/nginx de `apps/web` (o evidencia de qué queda para el CI).
- PR contra `main` abierto al crear la rama; cierre con merge commit (`--no-ff`).

## Riesgos

- Heredar el defecto del patrón de `/health`: en nginx `add_header` después de `return` no fija el `Content-Type`; verificar con `curl -i` que `/ping` entregue `application/json`.
- Es un cambio de contrato/API mínimo (alto riesgo según el historial): revisión humana en el PR.

## Trazabilidad Jira ↔ US ↔ tasks

| Jira | US | Requisito | Tareas |
|------|----|-----------|--------|
| MSF-495 | US1 | FR-001, FR-002, FR-003 | T001, T002, T003 |
