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

## Recommendation

- **Close the bug — verified a nivel de código** (la reproducción del assessment, en su equivalente automatizado,
  pasa y el síntoma es imposible por construcción). Antes de darlo por cerrado en el entorno: redeploy de las dos
  funciones en STG/PRD, un correo de prueba con `redirectTo` en `https://` y revisión de `GOTRUE_URI_ALLOW_LIST`.
