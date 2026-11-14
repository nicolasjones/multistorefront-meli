# Bug Verification: enlaces a las tiendas en `http://` en STG y PRD (`invitar-cliente` / `recuperar-clave-cliente`)

- **Slug**: msf-726
- **Tested**: 2026-11-12
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

El síntoma original no se reproduce: con `SUPABASE_URL=http://kong:8000` (el valor real en STG y PRD, confirmado con
`docker inspect` sobre los contenedores `supabase_edge_runtime_multistorefront-meli-supabase-prd` y `-stg`) el esquema
del enlace sigue siendo `https`. La decisión ya no se deduce del host de `SUPABASE_URL`: vive en
`supabase/functions/_shared/protocolo.ts` y da `http` solo con la señal explícita `ALLOW_HTTP_REDIRECT=true`
(desarrollo local). Las pruebas de los dos handlers y del helper compartido pasan; `lint`, `build` y `docs:check` dan
verde.

**Lo que NO se ejercitó acá (no es un defecto del código, es un paso de despliegue):** el correo real de STG/PRD con
el `redirectTo` en `https` y la allow-list `GOTRUE_URI_ALLOW_LIST` de esos entornos. Queda como seguimiento de
despliegue, tal como figure en el *Follow-ups* de `fix.md`.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix) | `pnpm test:edge:protocolo` | pass | Caso de aceptación del bug: `SUPABASE_URL=http://kong:8000` ⇒ `https`. El `redirectTo` se arma con ese esquema en `invitar-cliente/handler.ts` y `recuperar-clave-cliente/handler.ts`. |
| New / updated tests | `pnpm test:edge:protocolo` | pass | 5/5 (`protocolo.test.ts`,helper compartido). |
| New / updated tests | `pnpm test:edge:invitar-cliente` | pass | 16/16 (incluye el caso «el enlace sale en http solo si el entorno lo permite»). |
| New / updated tests | `pnpm test:edge:recuperar-clave-cliente` | pass | 10/10 (ídem para el enlace de recuperación). |
| Regression suite | `pnpm lint` | pass | exit 0; sólo warnings preexistentes en archivos que este cambio no toca. |
| Regression suite | `pnpm build` | pass | exit 0 (`✓ built in 1.78s`). |
| Regression suite | `pnpm docs:check` | pass | Documentación de cambios OK (930 archivos contra `HEAD~1`); Migraciones OK: 618 archivos, 0 nuevos contra `origin/dokploy` (esta historia no crea migraciones). |
| Regression suite | `pnpm calidad --no-docker` | pass | oxlint (SAST), knip (código muerto), jscpd (duplicación), dependency-cruiser (arquitectura) y syncpack (versiones) sin hallazgos. `gitleaks` quedó sin correr: en este entorno no hay acceso al socket de Docker (es la herramienta, no un secreto detectado). |
| Lint / type-check | `pnpm lint` | pass | exit 0. |
| Reproduction (post-fix) en STG/PRD | despliegue real + correo al cliente | not-run | Requiere el stack desplegado y una tienda real; se deja para la verificación post-deploy (ver *Residual Risks*). |

## Output Excerpts

```
$ pnpm test:edge:protocolo
✔ en STG/PRD (SUPABASE_URL=http://kong:8000) el esquema sigue siendo https
✔ ningún host de SUPABASE_URL habilita http: el esquema ya no se deduce de la URL
✔ sin la variable explícita el esquema es https
✔ solo el valor true habilita http
✔ ALLOW_HTTP_REDIRECT=true (desarrollo local) habilita http
ℹ tests 5   ℹ pass 5   ℹ fail 0

$ pnpm test:edge:invitar-cliente
ℹ tests 16   ℹ pass 16   ℹ fail 0

$ pnpm test:edge:recuperar-clave-cliente
ℹ tests 10   ℹ pass 10   ℹ fail 0

$ pnpm docs:check
Documentación de cambios: OK (930 archivos comparados contra HEAD~1).
Migraciones OK: 618 archivo(s), 0 nuevo(s) contra origin/dokploy.
```

## Residual Risks

- **Verificación end-to-end pendiente**: no se desplegó en STG/PRD ni se revisó un correo real. Hay que redeployar
  `invitar-cliente` y `recuperar-clave-cliente` y comprobar que el `redirectTo` del correo sale en `https://`.
- **Allow-list de Auth**: en STG/PRD hay que revisar que `GOTRUE_URI_ALLOW_LIST` permita `https://<dominio>/definir-contrasena`
  de cada tienda; si no, GoTrue ignora el `redirect_to` y el cliente aterriza en el `site_url` del panel.
- **Correos ya enviados** con `http://` siguen en las bandejas: el token viaja en claro hasta que el cliente use el
  enlace (la redirección `http`→`https` depende de Traefik). No se puede arreglar desde el código.
- **Configuración**: si alguien define `ALLOW_HTTP_REDIRECT=true` en STG/PRD, los enlaces vuelven a `http://`. La regla
  está documentada como «solo local» en `docs/acceso-ingreso.md`, `docs/clientes.md` y en la plantilla
  `supabase/functions/.env.example` (que advierte explícitamente no definirla en STG/PRD).
- El valor real de `SUPABASE_URL` en STG/PRD (`http://kong:8000`) está confirmado por el tracker con `docker inspect`;
  el test lo reproduce como dato de entrada.

## Sincronización con la base (2026-11-13)

La rama se sincronizó con `origin/dokploy` en un commit de merge **sin tocar el código del fix**: los archivos del
alcance (`supabase/functions/_shared/protocolo.ts`, `protocolo.test.ts`, `invitar-cliente/*` y
`recuperar-clave-cliente/*`) quedan byte a byte iguales que en `fe43fb50`. El único conflicto fue `package.json`
(scripts `test:edge:*` de la base contra el `test:edge:protocolo` de esta historia): se resolvió tomando los
scripts de la base y re-agregando `test:edge:protocolo` a `test:web`.

Verificación sobre el árbol ya sincronizado: `pnpm test:edge:protocolo` → 5/5 · `pnpm test:edge:invitar-cliente`
→ 16/16 · `pnpm test:edge:recuperar-clave-cliente` → 10/10 · `pnpm lint` → exit 0 · `pnpm build` → exit 0 ·
`pnpm docs:check` → OK.

El rojo de `quality` (knip: `docs/javascripts/zoom-imagenes.js`, `scripts/armar-video-evidencia.mjs` y
`scripts/publicar-videos-e2e.mjs`) **no es de esta historia**: los tres archivos los trajo la base y cualquier
rama sincronizada con `dokploy` lo hereda (`quality` falla en `integracion/main-en-dokploy` y pasa en las ramas
sin esos archivos). Además `quality` no es un check requerido: el ruleset de `dokploy` exige sólo `validacion`
(el job único de `Validate`).

## Sincronización con la base (2026-11-14)

Segunda sincronización, otra vez **sin tocar el contenido del fix**: `git merge origin/dokploy` entró limpio
(0 conflictos) y `git diff 41d132dd..HEAD -- supabase/functions/_shared/protocolo.ts
supabase/functions/_shared/protocolo.test.ts supabase/functions/invitar-cliente
supabase/functions/recuperar-clave-cliente docs/acceso-ingreso.md docs/clientes.md
supabase/functions/.env.example .specify/bugs/msf-726 package.json` sale **vacío**: los archivos del alcance
quedan byte a byte iguales que en `41d132dd`.

La rama queda **al día**: `git merge-base origin/dokploy HEAD` es el propio tip de `origin/dokploy`
(`9d843135`), o sea que el diff del PR contra la base son sólo los 16 archivos de esta historia. Por eso el job
`web` (que corre `vitest run --changed <merge-base>`) no arrastra tests de otras historias.

Verificación sobre el árbol ya sincronizado: `pnpm test:edge:protocolo` → 5/5 · `pnpm test:edge:invitar-cliente`
→ 16/16 · `pnpm test:edge:recuperar-clave-cliente` → 10/10 · `pnpm lint` → exit 0 · `pnpm build` → exit 0 ·
`pnpm docs:check` → OK (0 migraciones nuevas) · `pnpm --filter @platform/web exec vitest run
src/pages/tienda-publica/ListadoProductosMovil.test.tsx` → 4/4.

El test que la instrucción del 06/11 señalaba como inestable (`ListadoProductosMovil.test.tsx:60`, «2 filtros
activos») ya está estabilizado **en la base** (commit `f6314412`, `test(MSF-846)`): pasa acá y no hay que tocarlo
en esta rama.

**Los tests vigilan la regla** (mutación y reversión, sin dejar el cambio):

| Mutación | Resultado |
|---|---|
| Volver a la regla vieja (`kong` en el regex ⇒ `local`) | `pnpm test:edge:protocolo` → 3 fallos (entre ellos «en STG/PRD el esquema sigue siendo https») |
| Relajar la condición (`!== 'false'` ⇒ cualquier valor habilita `http`) | `pnpm test:edge:protocolo` → 4 fallos (entre ellos «solo el valor true habilita http») |

**El rojo de `quality` es de la línea base, no de esta historia.** `knip` señala
`docs/javascripts/zoom-imagenes.js` (archivo sin usar), `scripts/armar-video-evidencia.mjs` (`@playwright/test`
y el binario `ffmpeg`) y `scripts/publicar-videos-e2e.mjs` (binarios `tailscale`, `hostname`, `pkill`): los tres
archivos son **idénticos a la base** (`git diff origin/dokploy HEAD -- <archivos>` vacío) y los trajo el PR #940
(`fix/msf-161-menores-939`, mergeado el 13/11), que también entró con `quality -> failure` y `validacion ->
success`. Es decir: el rojo se hereda de `dokploy` y lo tienen todas las ramas sincronizadas. No se arregla acá
(rework de la base dentro de una historia de bug = ampliar alcance y duplicar el arreglo del base). El check
requerido por el ruleset de `dokploy` es **sólo `validacion`** (job único de `Validate`), que es el que
verdictúa el merge; `quality` es complementario.

## Tercera sincronización con la base (2026-11-14)

Tercera sincronización, otra vez **sin tocar el contenido del fix**: `git merge origin/dokploy` entró limpio
(0 conflictos) y `git diff 00e121bf..HEAD -- supabase/functions/_shared/protocolo.ts
supabase/functions/_shared/protocolo.test.ts supabase/functions/invitar-cliente
supabase/functions/recuperar-clave-cliente docs/acceso-ingreso.md docs/clientes.md
supabase/functions/.env.example .specify/bugs/msf-726 package.json` sale **vacío**: los archivos del alcance
quedan byte a byte iguales que en el commit aprobado.

La rama queda **al día**: `git rev-list --left-right --count origin/dokploy...HEAD` → `0	16` (0 commits atrás
de la base `d489d25b`), o sea que el diff del PR contra la base son sólo los archivos de esta historia. El
`reports/calidad.md` se restauró a la versión de la base: es un artefacto generado que el job `quality` vuelve a
escribir en el runner, así que dejarlo desactualizado sólo agregaba ruido al diff del PR.

Verificación sobre el árbol ya sincronizado: `pnpm test:edge:protocolo` → 5/5 · `pnpm test:edge:invitar-cliente`
→ 16/16 · `pnpm test:edge:recuperar-clave-cliente` → 10/10 · `pnpm lint` → exit 0 · `pnpm build` → exit 0 ·
`pnpm docs:check` → OK (0 migraciones nuevas).

**El rojo de `quality` (knip) ya lo arregló la base**: el commit `d345eeb1` («chore(calidad): declarar en knip lo
que traen los scripts de main») declara en `knip.json` los tres archivos de tooling; `pnpm calidad` local da
`knip (código muerto): ok` (antes `hallazgos`). El único check que no da verde local es `gitleaks (secretos)`:
el script lo corre por Docker y en este entorno no hay acceso al socket (`docker: permission denied`), así que lo
marca «hallazgos» por un problema de permisos del sandbox, no por un secreto. Con el **binario nativo** —el mismo
que usa el job `quality` (`gitleaks_8.30.1_linux_x64`)— el resultado es `no leaks found` (exit 0).

## Cuarta sincronización con la base (2026-11-14)

Cuarta sincronización, **otra vez sin tocar el contenido del fix**: `git merge --no-ff origin/dokploy` entró limpio
(0 conflictos) sobre la base `0c749324` («Merge pull request #941 … MSF-848 tiendas identidad héroe mayúsculas»).
La rama queda **al día**: `git rev-list --left-right --count origin/dokploy...HEAD` → `0	17` y
`git merge-base origin/dokploy HEAD` es el propio tip de la base (antes estaba 28 commits atrás).

`git diff a0df8eb7..HEAD -- supabase/functions/_shared/protocolo.ts supabase/functions/_shared/protocolo.test.ts
supabase/functions/invitar-cliente supabase/functions/recuperar-clave-cliente supabase/functions/.env.example
docs/acceso-ingreso.md docs/clientes.md package.json .specify/bugs/msf-726` sale **vacío** (0 líneas): los archivos
del alcance quedan byte a byte iguales que en el commit aprobado. El diff del PR contra la base sigue siendo de
**15 archivos**, los de esta historia.

Verificación sobre el árbol ya sincronizado: `pnpm test:edge:protocolo` → 5/5 · `pnpm test:edge:invitar-cliente`
→ 16/16 · `pnpm test:edge:recuperar-clave-cliente` → 10/10 · `pnpm lint` → exit 0 · `pnpm build` → exit 0 ·
`pnpm docs:check` → OK (651 migraciones, 0 nuevas contra `origin/dokploy`) · `pnpm calidad:code` → oxlint, knip,
jscpd, dependency-cruiser y syncpack **ok** (`gitleaks` quedó sin correr: en este entorno no hay acceso al socket de
Docker; el job `quality` del CI lo corre con el binario nativo y da verde).

**El job `database` (pgTAP) ya corrió y dio verde.** El check que faltaba en las rondas anteriores no estaba
pendiente por código: los runs de `Validate` morían *sin ejecutar un solo job* (cola de runners self-hosted), así que
GitHub nunca registraba el check. Con la base sincronizada, el run sobre el commit anterior (`a0df8eb7`) dejó **todos
los checks en verde**, `database` incluido (run `43544350521`: `application`, `database`, `web (1)`, `web (2)`,
`web (3)`, `e2e-tienda`, `quality`, `changes`, `validacion`).

**Los tests siguen vigilando la regla** (mutación y reversión sobre el árbol sincronizado, sin dejar el cambio):
volver a la regla vieja (`kong` en el regex ⇒ `local`) → `pnpm test:edge:protocolo` → **3 fallos**; relajar la
condición (`!== 'false'` ⇒ cualquier valor habilita `http`) → **4 fallos**. Con el archivo restaurado, 5/5.

## Recommendation

- **Close the bug — verified a nivel de código** (la reproducción del assessment, en su equivalente automatizado,
  pasa y el síntoma es imposible por construcción). Antes de darlo por cerrado en el entorno: redeploy de las dos
  funciones en STG/PRD, un correo de prueba con `redirectTo` en `https://` y revisión de `GOTRUE_URI_ALLOW_LIST`.
- **La deuda de `knip` en la base ya está cerrada** (commit `d345eeb1`): no queda nada que corregir en `dokploy`
  por esta historia.
- **No queda nada pendiente en el código**: la rama está al día con la base, el CI da verde (incluido `database`) y el
  contenido del fix sigue byte a byte igual al aprobado tres veces.
