# Service técnico · Consulta de estado por el cliente con enlace (F-SVC-22)

Historia **MSF-157**, épica **MSF-124** · spec en `specs/20261028-100000-service-seguimiento-y-reportes/`
(User Story 3, FR-040 a FR-047). El cliente consulta el estado de su equipo con un enlace, sin crear una cuenta.

## Qué ve la persona del taller

En `/service-tecnico/reparaciones/:id`, el botón **«Enlace de seguimiento»** aparece solo con `edicion` en
`service_tecnico`. Abre un diálogo con la URL completa (`<origen del panel>/seguimiento/<token>`), **«Copiar enlace»**
(con confirmación «Enlace copiado») y **«Cerrar»**. Pedirlo de nuevo muestra **el mismo enlace**. El panel **no envía
ningún mensaje** al cliente: el enlace se copia a mano (avisos al cliente: MSF-232).

## Qué ve el cliente

`/seguimiento/:token` está **fuera del panel**: sin sesión, sin menú ni barra superior, con `<meta name="robots"
content="noindex">`. Muestra **solo** código `R-xxxx`, tienda, equipo y modelo, estado actual con «Qué significa»,
entrega prevista y línea de tiempo de estados (nombre y fecha). Estados: carga, «No encontramos esa reparación»,
«Demasiadas consultas, probá en unos minutos» y error con «Reintentar». Se lee en 320, 768 y 1440 px.

**Nunca** muestra: cliente ni contacto, N.º de serie, falla, accesorios, técnico, notas o usuarios del historial,
ítems, importes, costos, adjuntos ni ids internos.

## Cómo funciona

| Pieza | Esquema | Acceso |
|---|---|---|
| `dominio.reparacion_enlaces_consulta` (`reparacion_id` único, `token` único, FK compuesta con la organización) | `dominio` (dato de negocio del taller) | RLS habilitada **sin políticas ni grants** para `authenticated`/`anon` |
| `public.consultas_publicas_intentos` (`ip_hash`, `ventana`, `cuenta`) | `public` (contador transversal de un endpoint público; sin `organizacion_id`) | RLS habilitada sin políticas ni grants |
| `public.obtener_enlace_consulta(reparacion)` | RPC `security definer` | `authenticated`, exige `edicion` y tienda accesible |
| `public.registrar_consulta_publica(ip_hash, ventana_seg, limite)` | RPC | **solo `service_role`** |
| `private.estado_publico_reparacion(token)` + `public.obtener_estado_publico_reparacion(token)` | función interna + envoltorio | envoltorio **solo `service_role`** |
| Edge Function `consultar-estado-reparacion` | `POST { token }` | sin sesión; usa la service-role solo en el servidor |

- **Token**: 24 bytes aleatorios de la base (`extensions.gen_random_bytes`, 192 bits) en base64url (32 caracteres).
  Un token por reparación; `obtener_enlace_consulta` es idempotente (`on conflict (reparacion_id) do nothing`).
  Registra la actividad `reparacion.enlace_generado` solo cuando crea (ver `docs/actividad.md`).
- **No hay RPC para `anon`** (regla del repo): la Edge Function es el único camino público.
- **Lista blanca**: `private.estado_publico_reparacion` arma el JSON campo por campo (nunca `select *`) y el handler
  la vuelve a filtrar antes de responder.
- **Respuestas**: 200 con la lista blanca · **404 uniforme** `{ error: 'no_encontrada' }` (token inexistente, mal
  formado o ausente, sin distinguir) · **429** `{ error: 'demasiadas_consultas' }` con `Retry-After` · 500
  `{ error: 'error_interno' }`. Todas llevan `Cache-Control: no-store`, `Referrer-Policy: no-referrer` y
  `X-Robots-Tag: noindex`. El cambio de estado se ve en la próxima carga (sin caché).
- **Límite de tasa**: 30 consultas por ventana fija de 10 minutos por IP, contando **toda** consulta (válida o no),
  con `upsert` atómico; al excederse responde 429 **sin consultar reparaciones**. Las ventanas vencidas se purgan de
  a 100 filas por llamada.
- **IP**: se hashea con HMAC-SHA256 y la sal de servidor `SEGUIMIENTO_IP_SALT`; la IP no se guarda ni se loguea.
  La IP del cliente sale de `x-real-ip` si la fija el proxy más cercano; si no, del valor de `x-forwarded-for` que
  está `SEGUIMIENTO_SALTOS_PROXY` proxies antes del último (por defecto **1**).
  - **Topología STG/PROD** (`docs/deployment.md`, `docs/operar-sistema.md`): navegador → **Traefik** (Dokploy,
    VPS2) → **Kong** (gateway del stack self-hosted) → Edge Runtime. Traefik agrega la IP del cliente y Kong
    agrega la de Traefik: hay **un** proxy de confianza, así que el cliente es el valor **penúltimo** y cada
    cliente tiene su propio contador (nadie comparte cupo). Es el mismo criterio de
    `private.saltos_proxy_confiables()` (F-TDA-15, `supabase/migrations/20261203110300_tienda_busqueda_visitante_saltos.sql`).
  - **Cómo confirmarlo en STG/PROD**: la función avisa por log (sin IP) cuando la cadena de `x-forwarded-for`
    trae **más** valores de los esperados: ahí la IP resuelta podría ser la de un proxy y todos los clientes
    detrás de él compartirían el mismo contador (30 consultas/10 min). Si aparece el aviso, ajustá
    `SEGUIMIENTO_SALTOS_PROXY` al número real de proxies de confianza (secreto de la función, sin redeploy).
  - **Si no llega ninguna cabecera**: se usa un valor fijo → **contador compartido** (falla cerrada, como la
    tienda online): 30 consultas/10 min entre todos.

## Acceso sin sesión

- `supabase/config.toml` declara `[functions.consultar-estado-reparacion] verify_jwt = false`: la página
  pública `/seguimiento/:token` consulta **sin sesión** y la clave pública (anon/publishable) **no es un JWT**;
  si el gateway exigiera un JWT, la consulta sin sesión terminaría en **401**. Con `verify_jwt = false` el
  gateway solo pide la clave pública (`apikey`) y la función no crea ni usa sesión.
- Al desplegar, el `supabase/config.toml` del **workdir del CLI de cada entorno** (`/root/supabase-stg`,
  `/root/supabase-prd`) tiene que llevar la misma sección: es de ahí que `supabase functions deploy` lee el
  `verify_jwt` de la función.
- La **service-role** vive solo en el servidor (`index.ts`): la función llama únicamente a
  `obtener_estado_publico_reparacion` y `registrar_consulta_publica`, ejecutables **solo por `service_role`**.

## Variables

`SEGUIMIENTO_IP_SALT` — solo en `supabase/functions/.env.example` (sin valor). Se configura como secreto de la
función (`supabase secrets set`), nunca en el navegador ni en Git. Sin ella la función responde 500.
`SEGUIMIENTO_SALTOS_PROXY` — mismo archivo (sin valor): proxies de confianza que agregan su IP al final de
`x-forwarded-for` (por defecto **1**; ver «IP» arriba). Vacío = 1.
La página pública llama a la función con la clave pública (anon) para pasar el gateway; no usa ni crea sesión.

## Riesgos conocidos

- **Sin revocación ni vencimiento** (*Decisiones abiertas* 4 de la spec): un enlace filtrado sigue válido. Mitigan:
  192 bits de entropía, lista blanca mínima sin datos personales, límite por IP, `no-store` y `noindex`.
  Confirmar si hace falta «Regenerar enlace».
- Quien tenga el enlace ve el estado de **esa** reparación (código, tienda, equipo, fechas).
- El límite por IP depende de la cadena de `x-forwarded-for` del proxy (ver «IP»): con la topología de STG/PROD
  cada cliente tiene su contador; si el entorno tuviera más proxies de confianza, el log de la función avisa y
  hay que ajustar `SEGUIMIENTO_SALTOS_PROXY`. Si no llega ninguna cabecera, el contador es compartido.

## Pruebas

`supabase/tests/database/service_enlace_consulta.test.sql` (SC-006) · `supabase/functions/consultar-estado-reparacion/handler.test.ts`
(`pnpm test:edge:consultar-estado-reparacion`) · `seguimiento.test.tsx`, `seguimientoPublico.test.ts`,
`EnlaceSeguimientoDialog.test.tsx`, `reparacion-enlace.test.tsx` (SC-007) · E2E `service-seguimiento.e2e.ts` (SC-008).

## Reversión

Migraciones aditivas. Para deshacer la historia (los enlaces ya compartidos dejan de funcionar), en una migración
posterior: `drop function public.obtener_estado_publico_reparacion(text); drop function private.estado_publico_reparacion(text);
drop function public.registrar_consulta_publica(text, integer, integer); drop table public.consultas_publicas_intentos;
drop function public.obtener_enlace_consulta(uuid); drop table dominio.reparacion_enlaces_consulta;`, y retirar la
función `consultar-estado-reparacion`, la ruta `/seguimiento/:token` y el botón del detalle. Con el merge commit de la
spec basta un `git revert -m 1`.
