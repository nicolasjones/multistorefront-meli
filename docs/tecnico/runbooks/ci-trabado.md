---
owner: operacion
sources:
  - .github/workflows
  - infra
---

# CI trabado

**Trigger:** un job queda en cola, un check no aparece, el merge no avanza o el runner está saturado.
**Impacto:** el PR no mergea; el flujo queda esperando.
**Dueño:** operación/SDLC.

## Pasos

1. `gh pr checks <PR>`: distinguir **pendiente**, **rojo** y **no disparado**.
2. Si está pendiente: revisar runners online (`/api/salud` o GitHub Actions) y la cola del gateway.
3. Si el runner está saturado: bajar `MAX_RUNNING` (runtime) o esperar; no cancelar jobs sanos.
4. Si el check no se dispara: verificar el workflow, permisos y el evento (push/PR).
5. Si el merge falla por “rama atrás”: actualizar la rama, no re-despachar al Dev.
6. Reintentar **una** vez el job; si vuelve a fallar por lo mismo, escalar con el log.

## Verificación

- El check requerido está verde y el PR `MERGED` (si correspondía).
- No quedan runs huérfanos ni labels `ci-pendiente` stale.

## Escalado

Si el runner no vuelve o el gate no responde: escalar a orquestación; no mergear “a mano” sin checks.

> **CI (2026-10-24):** el job `web` de Validate corre 3 shards reales (cada uno ~1/3 de la suite). Antes el flag no se aplicaba y cada shard corría la suite completa hasta el timeout de 30 min (AGE-1049).

> **Revisión de fuentes:** 2026-10-25 23:00 — se revisaron las fuentes de esta página (specs, prototipos, migraciones y código) y su contenido no cambia.
