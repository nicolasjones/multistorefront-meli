# Bug Fix: analítica embebida de Superset frágil ante recrear contenedores

- **Slug**: superset-embebido-fragil-recrear
- **Fixed**: 2026-09-25
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

La red hacia Supabase, los permisos del rol `Guest` y los orígenes permitidos
de cada embed ahora los declara Compose o los aplica `superset-init` en cada
arranque, sin pasos manuales. La Edge Function corta a los 10 s y hay una
verificación E2E versionada.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `infra/superset/compose.yaml` | modified | red externa `supabase` (`SUPABASE_DOCKER_NETWORK`) con alias `superset`; `superset-init` monta y corre `configurar_embebido.py` |
| `infra/superset/compose.vps.yaml` | modified | `networks: !reset` → solo `default` en el VPS |
| `infra/superset/configurar_embebido.py` | added | permisos fijos del rol `Guest`, `datasource_access` derivado, orígenes de `CORS_OPTIONS` en `allow_domain_list`; idempotente y aditivo |
| `infra/superset/superset_config.py` | modified | comentario de `GUEST_ROLE_NAME` (ya no "se crea a mano") |
| `supabase/functions/emitir-acceso-reporte/index.ts` | modified | `AbortSignal.timeout(10_000)` en las dos llamadas a Superset |
| `scripts/verificar-superset-embebido.mjs` | added test | E2E por el mismo camino que el SDK, sin admin |
| `package.json` | modified | `pnpm test:superset:embebido` |
| `template-capabilities.json`, `template-adoption.json` | modified | capacidad `embedded-analytics-runtime` 1.0.0 |
| `.env.example`, `docs/operar-superset.md`, `docs/crear-producto-derivado.md` | modified | variable nueva, operación y renombrado en forks |

## Tests Added or Updated

- `scripts/verificar-superset-embebido.mjs`: falla si cualquier reporte no
  emite guest token, si `/embedded/<uuid>` rechaza el origen de Refine o si
  algún chart no devuelve datos con el guest token.

## Local Verification

Contra el stack real del producto derivado (el del template no está
levantado; el código de `infra/superset` y la función es el mismo). Evidencia
en `evidencia/`.

- **Antes**: `WEB_ORIGIN=http://localhost:3100 pnpm test:superset:embebido`
  → rc 1, 5 fallos `403` en `/embedded/<uuid>` (`antes-3100.txt`). Con
  `:4100` → rc 0, 35 charts 200 (`antes-4100.txt`).
- `configurar_embebido.py` desde cero sobre un rol descartable (`Guest Prueba
  Embebido`): crea 19 permisos, **idénticos** al `Guest` real cargado a mano
  (diferencia vacía en ambos sentidos); la segunda corrida da 0 cambios; el
  rol de prueba se borró (`prueba-rol-scratch.txt`).
- Aplicación real (`aplicacion-real.txt`): 5 cambios (`:3100` agregado a los
  5 embeds, nada quitado); la segunda corrida da 0 cambios.
- **Después**: `WEB_ORIGIN=http://localhost:3100` → rc 0, 35/35 charts 200
  (`despues-3100.txt`). Navegador (Chrome headless + `playwright-core`, login
  real en Refine, `/reportes`): 5/5 reportes pintan sus charts sin
  403/Forbidden (`navegador-despues.txt`, `despues-libro-mayor-ok.png`).
- `pnpm infra:config` OK (incluye `compose.yaml` + `compose.vps.yaml` por
  separado: el config de VPS no lleva la red externa). `pnpm lint` OK (2
  warnings previos, no relacionados), `pnpm build` OK, `pnpm docs:check` OK,
  `pnpm template:capabilities:check` OK, `pnpm test:template:adoption` 11/11.

## Deviations from Assessment

- El assessment dice "38 charts": son 35 (1+1+11+11+11).
- La red de Compose y el timeout de la función **no se ejercitaron en vivo**:
  aplicarlos exige recrear `superset` y reiniciar las Edge Functions del
  stack compartido, y eso se hace desde el checkout que lo levanta, después
  del merge. Sí se validó el config resultante (`docker compose config`),
  y la red `supabase_network_<project_id>` existe con ese nombre en el
  producto. No hay `deno` local para typecheckear la función.

## Follow-ups

- Al adoptar en un producto: cambiar el default de `SUPABASE_DOCKER_NETWORK`
  por su `project_id`, recrear `superset` + `superset-init` desde el checkout
  que levanta el stack y correr `pnpm test:superset:embebido`.
- Dashboards exportados a YAML e importados en el init: sin eso, perder el
  volumen de Superset pierde los dashboards y los UUID de embed (fuera de
  este bug).
