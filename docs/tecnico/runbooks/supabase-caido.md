---
owner: operacion
sources:
  - .github/workflows
  - infra
---

# Supabase caído

**Trigger:** el panel no carga datos, Auth falla, Postgres/Storage no responde.
**Impacto:** sin lectura/escritura; los workers pueden encolar y reintentar.
**Dueño:** operación/infra.

## Pasos

1. Verificar salud del panel y de Supabase (Postgres/Auth/Storage). Revisar logs y disco.
2. Si es un servicio: reiniciar el contenedor/servicio afectado; confirmar que las migraciones no están a mitad.
3. Si es disco lleno: liberar espacio **sin borrar datos** (logs/temporales), luego reiniciar.
4. Si es Auth: verificar claves/URLs y que el panel use la configuración correcta.
5. Confirmar que la cola de workers no se llenó de errores; reintentar lo seguro.

## Verificación

- `/health` 200; login funciona; una lectura y una escritura de prueba.
- Storage sirve una imagen existente.
- No hay migraciones pendientes a medias.

## Escalado

Si hay pérdida de datos o el servicio no vuelve: runbook de [restaurar base](db-restore.md) + escalado a CTO.

> **CI (2026-10-24):** el job `web` de Validate corre 3 shards reales (cada uno ~1/3 de la suite). Antes el flag no se aplicaba y cada shard corría la suite completa hasta el timeout de 30 min (AGE-1049).

> **CI (2026-10-27):** los `.md` de raíz (`CLAUDE.md`, `AGENTS.md`) ya no cuentan como cambio de la app web. Antes, un PR sólo de docs encendía el e2e sin `build` y moría con *"Falta apps/web/dist"*; ahora, si el e2e corre, el `build` corre antes.
