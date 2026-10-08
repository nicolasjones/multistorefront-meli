# Bug Assessment: analítica embebida de Superset frágil ante recrear contenedores

- **Slug**: superset-embebido-fragil-recrear
- **Created**: 2026-09-25
- **Source**: producto derivado `Agenmatica/estudio-contable-automation`, PR #35
  (assessment completo con evidencia en su `.specify/bugs/superset-embebido-fragil-recrear/`)
- **Verdict**: valid
- **Severity**: high

## Report (resumido)

En el producto derivado, recrear el contenedor de Superset rompió la
analítica embebida dos veces el mismo día: se perdió el alias de red
`superset` en la red de Supabase (la Edge Function `emitir-acceso-reporte`
quedó colgada) y, con eso ya arreglado a mano, el iframe devolvía 403 porque
Refine quedó en otro puerto y `allow_domain_list` del embed solo tenía el
puerto viejo. Los permisos de datos del rol `Guest` también se cargan a mano.

## Symptom

La analítica embebida depende de tres piezas de estado que no están en git:
la red cruzada Supabase ↔ Superset, los permisos del rol `Guest` y los
orígenes permitidos de cada embed. Un `docker compose up` desde un checkout
limpio no deja `/reportes` funcionando.

## Reproduction

Contra el stack real del producto, 2026-09-25:

1. Recrear `superset` → `emitir-acceso-reporte` cuelga hasta el wall-clock
   (el `fetch` a `http://superset:8088` no resuelve).
2. Con la red reconectada a mano, la función da 200 y los 38 charts
   devuelven datos por `POST /api/v1/chart/data` con el guest token.
3. En el navegador, los 5 reportes muestran "403 Forbidden" dentro del
   iframe: `GET /embedded/<uuid>` con `Referer: http://localhost:3100` → 403 y
   con `Referer: http://localhost:4100` → 200.

## Suspected Code Paths

- `infra/superset/compose.yaml` — `superset` solo está en su red `default`.
- `infra/superset/superset_config.py` — CORS se deriva de
  `WEB_PORT`/`REFINE_ORIGIN`, pero `allow_domain_list` y el rol `Guest` se
  configuran a mano (comentario de `GUEST_ROLE_NAME`, `docs/operar-superset.md`).
- `supabase/functions/emitir-acceso-reporte/index.ts` — `fetch` sin timeout.

## Root Cause Hypothesis

Confianza alta. `docs/operar-superset.md` ya documentaba estas fragilidades
como pasos manuales y dejaba su automatización "para el primer producto que
la necesite". Ese producto ya apareció.

## Proposed Remediation

**Preferred**:

1. Red externa `supabase` en `compose.yaml`
   (`${SUPABASE_DOCKER_NETWORK:-supabase_network_<project_id>}`) con alias
   `superset`; `compose.vps.yaml` la resetea porque en el VPS la red es otra.
2. `infra/superset/configurar_embebido.py`, idempotente y solo aditivo,
   encadenado en `superset-init`: permisos fijos del rol `Guest` (sin
   `can_view_query`), `datasource_access` derivado de los dashboards con
   embed y orígenes de Refine (los mismos que CORS) en cada embed.
3. Timeout en los `fetch` de `emitir-acceso-reporte`.
4. `scripts/verificar-superset-embebido.mjs` (`pnpm test:superset:embebido`):
   verificación real de punta a punta sin credenciales admin, con el mismo
   camino que el SDK.
5. Capacidad nueva `embedded-analytics-runtime` en `template-capabilities.json`.

**Tests**: la verificación del punto 4 falla contra el estado roto (403 del
embed) y pasa después. Además, idempotencia de `configurar_embebido.py`: la
segunda corrida no cambia nada.

## Risks & Considerations

- `pnpm dev:superset` pasa a exigir Supabase levantado (la red externa tiene
  que existir). Se documenta.
- `datasource_access` derivado automáticamente: `Guest` ve todo dataset usado
  por un dashboard embebible. El aislamiento por organización sigue en el RLS
  del guest token.
