# Plan: [E2E super] Health endpoint /ping (BORRAR)

**Spec**: `specs/20261014-140000-e2e-super-health-ping-borrar/spec.md` · **Épica**: MSF-491 · **Delivery scope**: ninguno

## Enfoque

Sin implementación (instrucción de Nicolás: descartar). Solo se versionan los artefactos de spec para dejar constancia de la decisión.

## Constitución

- Sin tablas ni migraciones → sin RLS ni esquema que declarar (Principio VII), sin reversión de migraciones.
- Documentación (Principio VIII): la propia spec cubre `pnpm docs:check`; no hay cambio de plataforma.
- PR contra `main` abierto al crear la rama; se cierra sin mergear salvo que se decida conservar la constancia (en ese caso, merge commit `--no-ff`).

## Riesgos

- Que el Desarrollador sea relanzado por error: la spec declara "Descartada" para evitarlo.

## Trazabilidad Jira ↔ US ↔ tasks

| Jira | US | Requisito | Tareas |
|------|----|-----------|--------|
| MSF-491 | US1 | FR-001, FR-002 | T001 |
