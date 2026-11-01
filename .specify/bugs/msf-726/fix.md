# Bug Fix: enlaces a las tiendas en `http://` en STG y PRD (`invitar-cliente` / `recuperar-clave-cliente`)

- **Slug**: msf-726
- **Fixed**: 2026-11-01
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

El esquema del enlace (`redirectTo`) ya no se deduce del host de `SUPABASE_URL`: `kong` es el gateway interno de
Docker también en STG y PRD, así que esa heurística mandaba los correos de invitación y de recuperación de clave de
los clientes en `http://`. Ahora el esquema es `https` por defecto y `http` solo con la señal explícita
`ALLOW_HTTP_REDIRECT=true` (desarrollo local), con una regla compartida por las dos funciones.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `supabase/functions/_shared/protocolo.ts` | added | `protocoloTienda(entorno)`: `http` solo con `ALLOW_HTTP_REDIRECT=true` (trim + minúsculas); `https` en todos los demás casos. El host de `SUPABASE_URL` no interviene. |
| `supabase/functions/_shared/protocolo.test.ts` | added test | Caso de STG/PRD (`SUPABASE_URL=http://kong:8000` ⇒ `https`), que ningún host de `SUPABASE_URL` habilita `http`, y `ALLOW_HTTP_REDIRECT=true` ⇒ `http`. |
| `supabase/functions/invitar-cliente/index.ts` | modified | Se eliminó la regex con `kong`; el esquema sale del helper compartido, con `SUPABASE_URL` a propósito para dejar constancia de que no decide. |
| `supabase/functions/recuperar-clave-cliente/index.ts` | modified | Ídem: se eliminó la regex duplicada y se usa el helper compartido. |
| `supabase/functions/invitar-cliente/handler.ts` | modified | Comentario del `Deps.protocolo`: `http` solo con `ALLOW_HTTP_REDIRECT=true`. |
| `supabase/functions/recuperar-clave-cliente/handler.ts` | modified | Comentario del `Deps.protocolo`: `http` solo con `ALLOW_HTTP_REDIRECT=true`. |
| `supabase/functions/invitar-cliente/handler.test.ts` | test | El enlace sale en `http` solo si el entorno lo permite (desarrollo local); por defecto `https`. |
| `supabase/functions/recuperar-clave-cliente/handler.test.ts` | test | Ídem para el enlace de recuperación. |
| `supabase/functions/.env.example` | modified | `ALLOW_HTTP_REDIRECT=true` (plantilla de desarrollo local) con la advertencia de NO definirla en STG/PRD. |
| `docs/acceso-ingreso.md` | modified | Regla del esquema del enlace: `https` siempre; `http` solo con `ALLOW_HTTP_REDIRECT=true` en local; el host de `SUPABASE_URL` no decide. |
| `docs/clientes.md` | modified | La invitación al cliente vuelve al dominio de la tienda siempre en `https` salvo en local. |
| `package.json` | modified | `test:edge:protocolo` (sumado a `test:web`). |

## Diff Highlights

```ts
// supabase/functions/_shared/protocolo.ts
export const protocoloTienda = (entorno: Entorno): 'https' | 'http' =>
  entorno.ALLOW_HTTP_REDIRECT?.trim().toLowerCase() === 'true' ? 'http' : 'https'
```

```ts
// supabase/functions/invitar-cliente/index.ts (antes: regex con `kong`)
const protocolo = protocoloTienda({
  ALLOW_HTTP_REDIRECT: Deno.env.get('ALLOW_HTTP_REDIRECT'),
  SUPABASE_URL: Deno.env.get('SUPABASE_URL'),
})
```

## Tests Added or Updated

- `supabase/functions/_shared/protocolo.test.ts::en STG/PRD (SUPABASE_URL=http://kong:8000) el esquema sigue siendo https` — el criterio de aceptación del bug.
- `supabase/functions/_shared/protocolo.test.ts::ningún host de SUPABASE_URL habilita http` — `localhost`, `127.0.0.1`, `host.docker.internal` y `kong` dan `https`.
- `supabase/functions/_shared/protocolo.test.ts::solo el valor true habilita http` — `false`, `0`, `1`, `yes`, `no`, `http` dan `https`.
- `supabase/functions/_shared/protocolo.test.ts::ALLOW_HTTP_REDIRECT=true (desarrollo local) habilita http`.
- `supabase/functions/invitar-cliente/handler.test.ts::el enlace sale en http solo si el entorno lo permite (desarrollo local); por defecto https (MSF-726)`.
- `supabase/functions/recuperar-clave-cliente/handler.test.ts::el enlace sale en http solo si el entorno lo permite (desarrollo local); por defecto https (MSF-726)`.

## Local Verification

- `pnpm test:edge:protocolo` → 5/5; `pnpm test:edge:invitar-cliente` → 16/16; `pnpm test:edge:recuperar-clave-cliente` → 10/10.
- `pnpm lint` → exit 0 (solo warnings preexistentes en archivos que este cambio no toca); `pnpm build` → exit 0.
- `pnpm docs:check` → OK (12 archivos comparados contra `HEAD~1`; 0 migraciones nuevas).

## Deviations from Assessment

- La señal local es una variable (`ALLOW_HTTP_REDIRECT`) y no la validación del dominio: la decisión de negocio
  aceptaba cualquiera de las dos. Se eligió la variable porque el dominio de la tienda lo configura el equipo
  técnico y no distingue por sí solo un entorno local de uno productivo. Como red de seguridad, el valor por defecto
  es `https` y el archivo `.env.example` (plantilla local) advierte explícitamente que la variable NO se define en
  STG/PRD.
- El assessment proponía `SITE_PROTOCOL`/`ENTORNO_LOCAL`; se usó `ALLOW_HTTP_REDIRECT` porque es el nombre que
  sugiere la propia decisión de negocio y su semántica (permitir `http`) es exacta.
- Fuera del alcance del assessment: se tocaron `docs/clientes.md` y los `handler.test.ts` (cobertura del caso
  local), que son documentación y pruebas del mismo comportamiento.

## Follow-ups

- **Contrato de API**: sin cambios. Las dos funciones reciben y responden lo mismo; lo único que cambia es el
  esquema del `redirectTo` que viaja en el correo. El repo no tiene carpeta `openapi/` (los contratos de las
  funciones están en `specs/…/contracts/` y no cambian).
- **Despliegue**: redeploy de `invitar-cliente` y `recuperar-clave-cliente` en STG y PRD, y verificar en el correo que
  el `redirectTo` sale en `https://` (antes del deploy, el enlace queda en `http://`).
- Los correos ya enviados con `http://` siguen en las bandejas: el token viaja en claro hasta que el cliente use el
  enlace (la redirección `http`→`https` depende de Traefik). No hay forma de arreglar los correos ya enviados desde
  el código.
- En STG/PRD hay que revisar la allow-list de redirecciones de Auth (`GOTRUE_URI_ALLOW_LIST`): con el enlace en
  `https` la entrada `https://<dominio>/definir-contrasena` es la que vale (ver `docs/acceso-ingreso.md`).
- Riesgo residual: si alguien define `ALLOW_HTTP_REDIRECT=true` en STG/PRD, los enlaces vuelven a `http://`. Por eso
  la variable está documentada como «solo local» y la plantilla local advierte lo contrario.
