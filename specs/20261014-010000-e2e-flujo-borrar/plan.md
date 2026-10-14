# Plan: E2E flujo (BORRAR)

**Spec**: `specs/20261014-010000-e2e-flujo-borrar/spec.md` · **Épica**: MSF-487 · **Delivery scope**: ninguno

## Enfoque

Sin implementación. Solo se versionan los artefactos de spec para que el flujo tenga algo que recorrer.

## Constitución

- Sin tablas ni migraciones → sin RLS ni esquema que declarar (Principio VII), sin reversión de migraciones.
- Documentación (Principio VIII): la propia spec cubre `pnpm docs:check`; no hay cambio de plataforma.
- PR contra `main` abierto al crear la rama; cierre con merge commit (`--no-ff`) o descarte de la rama/PR, según se decida al borrar la épica.

## Riesgos

- Que el contenido descartable quede en `main`: si se mergea, revertir con `git revert -m 1 <hash>`; si se descarta, cerrar el PR sin mergear.

## Trazabilidad Jira ↔ US ↔ tasks

| Jira | US | Requisito | Tareas |
|------|----|-----------|--------|
| MSF-487 | US1 | FR-001, FR-002 | T001, T002 |
