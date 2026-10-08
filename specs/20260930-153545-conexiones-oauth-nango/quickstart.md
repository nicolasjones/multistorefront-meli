# Quickstart: Conexiones OAuth de plataforma vía Nango

## Desarrollo local

1. Con `.env` ya copiado desde `.env.example` en la raíz (ver README), copiar
   ese mismo archivo también a `infra/nango/.env` (Compose lo lee desde la
   carpeta del propio `compose.yaml`, no desde la raíz) y completar
   `NANGO_ENCRYPTION_KEY` (generar con `openssl rand -base64 32` o similar) y
   `NANGO_SECRET_KEY_DEV` (cualquier valor local, no sensible fuera de tu
   máquina).
2. `pnpm dev:nango` — levanta `nango-db`, `nango-redis` y `nango-server` en
   `http://localhost:3003` (puerto configurable, mismo patrón que la spec 015).
3. Entrar al dashboard de Nango (`http://localhost:3003`) y dar de alta una
   integración de prueba (p. ej. "Google") con un client id/secret de OAuth de
   un proyecto de Google Cloud propio, en modo "Testing" con tu usuario
   agregado como probador. Anotar la `provider_config_key` que Nango asigna
   (normalmente el nombre elegido, p. ej. `google`).
4. Correr la migración de esta spec (`pnpm dev:supabase` + `supabase db
   reset` si hace falta) y registrar esa misma clave en el catálogo:
   `select registrar_integracion_oauth('google', 'Google');` (como superadmin).
4.1. Copiar `supabase/functions/.env.example` a `supabase/functions/.env` y
   completar `NANGO_URL` (en local, `http://host.docker.internal:3003`) y
   `NANGO_SECRET_KEY` (el mismo valor que `NANGO_SECRET_KEY_DEV` del paso 1).
   Sin esto, el botón "Conectar" falla: el SDK de frontend de Nango exige un
   Connect Session Token que solo esta Edge Function puede generar
   (`contracts/conectar-oauth.md` §2.1, `research.md` R6).
5. Desde Refine, con una organización activa, abrir la pantalla de
   conexiones, iniciar la conexión de "Google" y completar el consentimiento.
   Verificar que el estado pasa a "activa".
6. Simular una falla de credencial: revocar el acceso de la app desde
   [myaccount.google.com/permissions](https://myaccount.google.com/permissions)
   (o el panel equivalente del proveedor de prueba) y confirmar, mediante el
   contrato de `contracts/obtener-token-oauth.md`, que el siguiente pedido de
   token falla y que `marcar_conexion_oauth_invalida` deja la conexión en
   `con_error` visible en Refine.

## Validar el aislamiento

7. Repetir el paso 5 con una segunda organización y confirmar que no puede
   ver ni usar la conexión de la primera (pgTAP de RLS + verificación manual
   en Refine con dos sesiones).

## Validar el contrato de token sin escribir el conector real

8. Con la conexión activa del paso 5, ejecutar contra Supabase el `select`
   del Paso 1 de `contracts/obtener-token-oauth.md` y, con el resultado,
   hacer manualmente el `GET` del Paso 2 (por ejemplo con `curl` o Postman)
   para confirmar que devuelve un `access_token` utilizable contra la API real
   del proveedor de prueba (p. ej. `https://sheets.googleapis.com`).
