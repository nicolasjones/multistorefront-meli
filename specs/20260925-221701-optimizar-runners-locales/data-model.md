# Data Model: Runners locales

No hay datos de negocio ni tablas. Las "entidades" son recursos de
infraestructura del host.

## Store compartido de pnpm

- **Recurso**: volumen Docker local con nombre `${RUNNER_PNPM_STORE_VOLUME:-platform-runner-pnpm-store}`.
- **Montaje**: `/pnpm` en cada réplica: `store/v11/` (`files/` direccionado
  por hash + `index.db` SQLite en WAL) y `cache/` (metadata del registro y
  `lockfile-verified.jsonl`).
- **Ciclo de vida**: lo crea el primer `docker compose up` que lo declara; no
  lo borra `docker compose down` (solo `down -v` o `docker volume rm`). Crece
  con cada versión nueva de dependencia; se limpia a mano con `pnpm store
  prune` con los runners sin jobs.
- **Compartido por**: todas las réplicas de todos los proyectos Compose que
  usen el mismo nombre de volumen.

## Réplica de runner

- **Recurso**: contenedor `<proyecto>-runner-N`, registrado en GitHub como
  `<RUNNER_NAME>-<hostname>`.
- **Cantidad**: `${RUNNER_REPLICAS:-3}` (entero ≥ 0).
- **Tope de memoria**: `${RUNNER_MEMORY_LIMIT}` (tamaño Docker: `3g`, `2048m`).
- **Estados en GitHub**: `online/busy=false` (libre), `online/busy=true`
  (corriendo un job — no recrear), `offline` (registro viejo; el entrypoint
  usa `--replace`).
