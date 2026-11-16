# Bug Assessment: Pasos manuales de infraestructura pendientes (MSF-854)

- **Slug**: msf-854
- **Created**: 2026-11-13
- **Source**: MSF-854 (tracker) — descripción de la historia
- **Verdict**: valid
- **Severity**: medium

## Report (verbatim o resumido)

> ## Pasos que solo puede dar Nicolás (escrituras remotas a VPS2 bloqueadas para el asistente)
>
> 1. **Publicar el sitio de docs** (ya construido con `mkdocs build --strict` desde `main`, incluye #886):
>    `ssh root@212.90.120.53 'cp -a /srv/docs-site /srv/docs-site.respaldo-AAAAMMDD' && rsync -a --delete <worktree>/site/ root@212.90.120.53:/srv/docs-site/`.
>    Si pasó tiempo, reconstruir desde `main` (`docker run --rm --entrypoint sh -v <worktree de main>:/docs -w /docs squidfunk/mkdocs-material:9 -c 'pip install -r requirements-docs.txt; mkdocs build --strict'`).
> 2. **Orden de arranque de tailnet-forwards** (tras el reinicio del 2026-11-12 las bases de dev/stg/prd no arrancaron porque socat ocupó sus puertos): drop-in `/etc/systemd/system/tailnet-forwards.service.d/esperar-docker.conf` con `After=docker.service` y un `ExecStartPre` que espere a `supabase_db_multistorefront-meli-supabase-prd`; luego `systemctl daemon-reload`.
> 3. **Recrear el stack Edge de dev** (`api-v1`, `entregar-webhook`, `cotizacion-sugerida` dan 404): respaldar antes el entorno del contenedor del runtime.
> 4. **Revocar la clave de API de prueba** `PRUEBA-claude-2026-11-11` (id 74a567f2-d3d8-416c-bd20-084af9b6b417) con `public.revocar_clave_api`.
>
> Referencias: memoria reinicio-vps2-tailnet-forwards-puertos, no-reemplazar-contenedores-sin-guardar-su-entorno.

## Symptom

Cuatro operaciones de infraestructura del VPS2 quedaban pendientes **solo en el chat de la sesión**: nada en el repo las registraba, así que se pierden entre sesiones y nadie sabe si ya se hicieron ni cómo verificarlas. Dos de ellas tienen riesgo de romper algo si se ejecutan a ciegas (el `rsync --delete` del sitio borra el subsitio público de la API si no se excluye; recrear el stack Edge sin guardar el entorno del contenedor pierde su configuración) y una es irreversible (revocar la clave de API de prueba).

## Reproduction

1. `ssh root@212.90.120.53` desde la máquina de desarrollo → `Permission denied (publickey,password)`: no hay acceso remoto.
2. Buscar los pasos en el repo (`grep -r "tailnet-forwards\|PRUEBA-claude"`) → sin resultados: el procedimiento no está escrito.
3. `curl https://docs.212-90-120-53.sslip.io/producto/contactos/` → `401` (Traefik `basicAuth`): el sitio publicado sigue siendo el del 2026-11-01, sin las páginas nuevas (`docs/ayuda-en-panel.md`).
4. `curl https://supabase-dev.212-90-120-53.sslip.io/functions/v1/api-v1/v1/openapi.json` → `200` (registrada), pero el mismo pedido en `supabase-stg` y `supabase-prd` → `Function not found`.
5. La clave `PRUEBA-claude-2026-11-11` sigue revocable desde el panel (Administración → API → Claves): el paso 4 nunca se ejecutó.

## Suspected Code Paths

- `docs/pasos-manuales-vps2.md` (nuevo) — el runbook donde queda el procedimiento; hoy no existe.
- `docs/deployment.md:27` — la regla de que una función Edge nueva no queda registrada hasta recrear el stack (base del paso 3).
- `docs/ayuda-en-panel.md:56` — el sitio publicado aparte, sus credenciales y las páginas que faltaban (base del paso 1).
- `docs/tecnico/subsitio-api-publica.md` (en `main`) — el `rsync --delete` **tiene** que excluir `/api-publica/`: sin eso, el paso 1 borra el subsitio público de la API.
- `supabase/migrations/20270224110201_api_claves.sql:246` — `public.revocar_clave_api`: resuelve la organización con `private.organizacion_id()` y exige `private.puede_escribir()`, o sea que necesita la sesión de un administrador (un `psql` suelto responde `42501`).
- `apps/web/src/pages/api/PanelClaves.tsx:108` — el botón «Revocar» del panel, la vía que sí funciona con la sesión del administrador.

## Root Cause Hypothesis

Los pasos son operaciones de ambiente (acceso SSH, `docker`, `systemd`, `psql` con la sesión del administrador) que el desarrollo no puede ejecutar: no hay clave SSH al VPS2 ni credenciales de los ambientes. Como además no estaban escritos en el repo, el trabajo se apoyaba en la memoria de
la sesión. Confianza: alta (verificado: sin acceso SSH y sin rastro en el repo).

## Proposed Remediation

**Preferred**: escribir el procedimiento como runbook en el repo —una página con los cuatro pasos, cada uno con el comando exacto, el respaldo previo, la verificación y la reversión— y un test que fije los comandos (para que la página no se desvíe del procedimiento pedido) y que exija verificación y reversión en cada paso. Se agrega además una línea en el índice de documentación y en la página de operación, para que la página no quede huérfana.

El repo **no** puede ejecutar los pasos: eso queda para Nicolás, y la página dice explícitamente que siguen pendientes hasta que cada verificación dé lo esperado.

**Alternatives**:
- Un script que los ejecute por SSH: no sirve (no hay clave ni credenciales en el repo; además mete un ejecutor remoto nuevo para cuatro pasos que se hacen a mano).
- Una migración que revoque la clave: incorrecto (una migración es esquema; la clave es datos de un ambiente y la RPC exige la sesión del administrador).

**Files likely to change**:
- `docs/pasos-manuales-vps2.md` (nuevo)
- `scripts/tests/documentacion-pasos-manuales-vps2.test.mjs` (nuevo)
- `package.json` (el test entra en `pnpm test`)
- `docs/README.md`, `docs/operar-sistema.md` (índice)

**Tests to add or update**:
- Test de documentación que fija los comandos de los cuatro pasos (respaldo + `rsync --delete --exclude=/api-publica/`, drop-in con `After=docker.service`, respaldo del entorno con `docker inspect`, `public.revocar_clave_api` con el id de la clave) y que exige `**Verificación:**` y `**Reversión:**` en cada paso.

## Risks & Considerations

- Publicar el sitio con `--delete` sin `--exclude=/api-publica/` borra el subsitio público de la API: el runbook lo excluye y el test lo fija.
- Recrear el stack Edge sin guardar el entorno del contenedor del runtime pierde su configuración: el runbook pone el respaldo antes de la recreación.
- Revocar la clave es irreversible (`revocada_en` no se borra): el runbook lo dice; si hace falta, se crea una clave nueva.
- El runbook no puede afirmar que los pasos estén hechos: se verifican en el VPS2, no desde el repo.
- La página se arma desde `main` (el tooling del sitio solo existe ahí): hasta que llegue a `main` y se agregue al `nav` de `mkdocs.yml`, no aparece en el sitio publicado.

## Open Questions

- [NEEDS CLARIFICATION: el comando exacto para recrear el stack Edge de dev (Dokploy o workdir del CLI de Supabase) depende del ambiente; el runbook deja el respaldo y la verificación y remite al procedimiento del ambiente.]
- [NEEDS CLARIFICATION: el mismo «Function not found» se midió en stg y prd, que no venían en la historia; queda anotado en el runbook, no se reasigna a otra historia.]
