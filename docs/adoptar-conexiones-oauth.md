# Adoptar Conexiones OAuth de plataforma en un producto derivado

Guía de proceso para traer la capacidad de la spec
`20260930-153545-conexiones-oauth-nango` a un producto derivado. Contratos
técnicos en `specs/20260930-153545-conexiones-oauth-nango/contracts/`.

## 0. Prerrequisitos

- El producto conserva `organizaciones`, RLS y el contexto de organización
  activa del template (specs 003/004) — las funciones nuevas dependen de
  `private.es_administrador_de` y `private.is_superadmin`.
- No confundir esta capacidad con `conexiones`/spec 013 (credenciales
  usuario/contraseña de negocio, custodiadas en Vault). Las dos conviven sin
  tocarse entre sí.

## 1. Levantar Nango self-hosted

1. Copiar `infra/nango/compose.yaml` tal cual al producto.
2. Sumar al `.env.example` propio las variables de la sección "Nango
   self-hosted" del `.env.example` de este template (`NANGO_PORT`,
   `NANGO_ENCRYPTION_KEY`, `NANGO_DB_PASSWORD`, `NANGO_DASHBOARD_USERNAME`,
   `NANGO_DASHBOARD_PASSWORD`, `NANGO_SERVER_URL`, `NANGO_PUBLIC_SERVER_URL`,
   `NANGO_SECRET_KEY_DEV`), generando valores propios para cualquier entorno
   compartido — nunca reutilizar los defaults de ejemplo del template fuera
   de una máquina de desarrollo local.
3. En staging/producción, `NANGO_SERVER_URL`/`NANGO_PUBLIC_SERVER_URL` deben
   apuntar al dominio HTTPS propio de ese entorno (reverse proxy ya
   existente, mismo patrón que Kestra/Superset — `docs/deployment.md`). El
   template no provee ni asume ese dominio.
4. `NANGO_SECRET_KEY_<entorno>` es un secreto de plataforma nuevo por
   entorno: vive únicamente donde corra el backend/worker que va a pedir
   tokens (nunca en Supabase, nunca en el navegador, nunca en Git).

## 2. Migrar el esquema (solo aditivo)

1. Copiar `supabase/migrations/20260930160000_conexiones_oauth.sql` al
   producto tal cual.
2. Ejecutar `pnpm test` (incluye
   `supabase/tests/database/conexiones_oauth.test.sql`).
3. Registrar la primera integración real, con la app OAuth del proveedor ya
   dada de alta en su consola (Google Cloud Console u equivalente — client
   id/secret son secretos de plataforma, nunca de un cliente/estudio):
   - Crear la "Integration" en el dashboard de Nango con esa clave/secreto.
   - `select registrar_integracion_oauth('<clave>', '<Nombre visible>');`
     (superadmin) — la clave debe ser exactamente el `provider_config_key`
     que usaste en Nango.

## 3. Consumir una conexión desde un backend/worker

Seguir `contracts/obtener-token-oauth.md` tal cual: resolver `conexion_id`
por `organizacion_id` + `clave` con un `select` normal (RLS), y pedir el
token directo a la API de Nango con `NANGO_SECRET_KEY_<entorno>` — nunca a
través de una función de Postgres (ese contrato explica por qué: sin
`pg_net`, sin HTTP saliente desde SQL).

No hay una versión "adoptable" con reglas de reconciliación complejas: este
mecanismo es nuevo y no reemplaza nada existente en un producto derivado que
todavía no tenía conexiones OAuth. Si un producto ya construyó algo propio
para esto antes de que esta spec existiera, migrar sus filas a
`conexiones_oauth`/`integraciones_oauth` columna por columna, documentando acá
las diferencias — mismo criterio que otras guías de adopción de este
template (ver `docs/adoptar-ciclo-ejecuciones.md`, sección 4).

## 4. UI de Refine y Edge Function

`apps/web/src/pages/conexiones-oauth/list.tsx`,
`apps/web/src/pages/integraciones-oauth/administrar.tsx` y
`supabase/functions/iniciar-sesion-oauth/` son reutilizables tal cual (no
tienen lógica de negocio de ningún proveedor concreto). Copiarlas junto con
`apps/web/src/providers/nango/` y sumar `@nangohq/frontend` a `package.json`.
Agregar `VITE_NANGO_PUBLIC_SERVER_URL` al `.env` de `apps/web`, y
`NANGO_URL`/`NANGO_SECRET_KEY` a los secretos de Edge Functions de ese
entorno (`supabase secrets set` — nunca en un archivo versionado). La Edge
Function es necesaria: el SDK de frontend de Nango exige un Connect Session
Token generado server-to-server, no solo `host` (`contracts/conectar-oauth.md`
§2.1).

## 5. Mapeo de este producto

_(Completar al adoptar.)_

- Integraciones registradas: —
- Dominio de `NANGO_SERVER_URL` en staging/producción: —
- Primer conector real que consume `contracts/obtener-token-oauth.md`: —
