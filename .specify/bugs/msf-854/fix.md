# Bug Fix: Pasos manuales de infraestructura pendientes (MSF-854)

- **Slug**: msf-854
- **Fixed**: 2026-11-13
- **Assessment**: ./assessment.md
- **Status**: applied (el procedimiento queda escrito y verificado; **la ejecución de los pasos es de Nicolás**)

## Summary

Los cuatro pasos manuales de infraestructura de MSF-854 quedaban solo en el chat de la
sesión: sin acceso SSH al VPS2 ni credenciales de los ambientes, el repo no puede
ejecutarlos, pero sí puede (y debe) dejar el procedimiento escrito, con su respaldo
previo, su verificación y su reversión. Se agregó `docs/pasos-manuales-vps2.md` con los
cuatro pasos y un test que fija los comandos, para que la página no se desvíe del
procedimiento pedido ni quede sin verificar.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `docs/pasos-manuales-vps2.md` | added | Runbook con los cuatro pasos: publicar el sitio de docs, orden de arranque de `tailnet-forwards`, recrear el stack Edge de dev y revocar la clave de API de prueba. Cada paso con comando, respaldo previo, verificación y reversión. |
| `scripts/tests/documentacion-pasos-manuales-vps2.test.mjs` | added | Test que fija los comandos exactos de los cuatro pasos, exige `**Verificación:**` y `**Reversión:**` en cada uno, que la página no lleve secretos y que esté indexada. |
| `package.json` | modified | Nuevo script `test:docs:pasos-manuales`, encadenado en `pnpm test`. |
| `docs/README.md` | modified | Fila en «Funcionalidad ↔ documento» y en «Deuda trazada». |
| `docs/operar-sistema.md` | modified | Enlace desde la página de operación (para que la página no quede huérfana). |

## Diff Highlights

El paso 1 cambió el comando que trae la historia: el `rsync --delete` **excluye**
`/api-publica/`, porque el subsitio público de la API vive dentro de `/srv/docs-site/`
y sin esa exclusión lo borra (está documentado en `docs/tecnico/subsitio-api-publica.md`,
en `main`).

El paso 3 registra el estado medido el 2026-11-13: en dev las tres funciones ya
responden (`api-v1` `200` en `/v1/openapi.json`, las otras dos `401`), o sea que el
síntoma de la historia **ya no se reproduce en dev**; el mismo `Function not found`
sigue en **stg y prd**, que no venían en el paso.

El paso 4 aclara que `public.revocar_clave_api` resuelve la organización con
`private.organizacion_id()` y exige `private.puede_escribir()`: un `psql` suelto como
`postgres` responde `42501`; la vía que funciona es la sesión del administrador de la
organización (panel o RPC con su token).

## Tests Added or Updated

- `scripts/tests/documentacion-pasos-manuales-vps2.test.mjs` — 8 casos: los cuatro pasos
  están; cada uno dice cómo verificar y cómo revertir; el paso 1 respalda y publica sin
  borrar el subsitio; el paso 2 deja el drop-in con `After=docker.service` y la espera por
  la base de producción; el paso 3 respalda el entorno con `docker inspect` y verifica
  por la URL de funciones; el paso 4 revoca la clave `74a567f2-…` con la RPC y verifica
  `revocada_en`; la página no lleva secretos; y está indexada.

## Local Verification

- `pnpm test:docs:pasos-manuales` → 8/8 pasaron.
- `pnpm test:docs:check` → 4/4 pasaron; `pnpm test:docs:importaciones` → 3/3 pasaron.
- `pnpm docs:check` → «Documentación de cambios: OK» y «Migraciones OK» (esta historia no
  crea migración).
- `pnpm lint` → exit 0 (los 287 warnings son preexistentes de `apps/web`, que no se tocó).
- `pnpm build` → exit 0 («✓ built in 2.75s»).
- `pnpm calidad` → oxlint (SAST), knip (código muerto), jscpd (duplicación),
  dependency-cruiser (arquitectura) y syncpack: **ok**. El único check con «hallazgos» es
  gitleaks, que no corrió porque en esta máquina no hay acceso al socket de Docker
  (`permission denied … /var/run/docker.sock`): lo corre el job `quality` del CI.
- Medición del estado real (sin credenciales): `curl` a
  `https://supabase-{dev,stg,prd}.212-90-120-53.sslip.io/functions/v1/…` y a
  `https://docs.212-90-120-53.sslip.io/producto/` (401, `basicAuth`); `ssh root@212.90.120.53`
  → `Permission denied (publickey,password)`.

## Deviations from Assessment

- El paso 1 usa `rsync -a --delete --exclude=/api-publica/` en lugar del comando de la
  historia (`rsync -a --delete`): sin la exclusión se borra el subsitio público de la API.
  Es el mismo paso, con el riesgo que la historia no contempla.
- El comando exacto para recrear el stack Edge **no** queda escrito (depende de cómo se
  levanta cada ambiente en el VPS2): el runbook fija el respaldo previo del entorno del
  contenedor del runtime y la verificación, y remite al procedimiento del ambiente.
- Se anotan en el runbook las mediciones del 2026-11-13 (en dev el síntoma ya no se
  reproduce; en stg y prd sigue). No se reasigna a otra historia: queda en la página como
  estado, no como tarea.

## Follow-ups

- Los cuatro pasos siguen **pendientes** hasta que cada verificación dé lo esperado
  (los hace Nicolás en el VPS2). La página lo dice: no se marcan como hechos por el solo
  hecho de existir.
- Cuando la página llegue a `main`, agregarla al `nav` de `mkdocs.yml` (y al índice de
  `docs/tecnico/runbooks/`) para que aparezca en el sitio publicado.
- El mismo `Function not found` en **stg y prd** queda fuera de esta historia: si hay que
  recrear esos stacks, es una historia aparte (no se reasigna acá).
