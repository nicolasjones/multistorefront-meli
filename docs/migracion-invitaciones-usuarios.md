---
owner: producto
sources:
  - specs
---

# Migración: invitaciones de usuarios

Registro de la corrección de la migración de invitaciones (tarea **P-20** del orquestador SDLC).

## Contexto

La funcionalidad de invitaciones se introdujo con una **versión de migración duplicada**, lo que hacía que el pipeline de migraciones fallara al aplicar en staging/producción (dos migraciones con la misma versión).

## Cambio

Se unificó en una **única versión**: `20261013140001_invitaciones_usuarios.sql`. Se eliminó la versión duplicada y quedó una sola fuente de verdad.

## Estado

- **Staging**: aplicado — pipeline `Migraciones cloud` = SUCCESS.
- **Producción**: aplicado — pipeline `Migraciones` = SUCCESS.

## Referencias

- `supabase/migrations/20261013140001_invitaciones_usuarios.sql`
- `docs/invitar-usuarios.md`
