# Solicitar acceso desde la pantalla restringida

Spec: `specs/20261016-130000-perfil-y-permisos-avanzados/` (F-ROL-05, MSF-302, épica MSF-148).
Migraciones: `20261017100000_solicitudes_acceso.sql` y `20261017100001_rpc_solicitar_acceso.sql`.
Pruebas: `supabase/tests/database/solicitudes_acceso.test.sql`,
`supabase/functions/solicitar-acceso/handler.test.ts` (`pnpm test:edge:solicitar-acceso`) y
`apps/web/src/pages/acceso-restringido/AccesoRestringido.test.tsx`.

## Flujo

1. Quien abre una sección sin acceso ve `AccesoRestringido` (F-ROL-03) con «Solicitar acceso» junto a «Volver al inicio».
2. El botón invoca la Edge Function `solicitar-acceso` con la clave de la sección.
3. La función llama a la RPC `public.solicitar_acceso(p_seccion)` con el JWT de la persona. La RPC (security definer) exige sesión, membresía activa, una sección del catálogo (`private.matriz_inicial()`) y que la persona **no** tenga ya acceso; inserta en `public.solicitudes_acceso` con `on conflict do nothing`: **un registro por persona, sección y día**.
4. Si el correo del día todavía no salió, la función reclama el envío de forma atómica (`correo_enviado_en` pasa de `null` a `now()` solo para quien gana), envía **un solo correo** a todos los administradores activos de la organización y lo deja marcado. Si el envío falla, libera la marca: el pedido queda guardado y el botón «Reintentar» vuelve a intentar el aviso sin duplicar el registro.
5. La pantalla muestra «Solicitud enviada al administrador». Si la organización no tiene administrador activo, el pedido se guarda y se informa que no hay a quién avisar.

## Datos (Principio VII)

| Tabla | Esquema | Naturaleza |
|---|---|---|
| `solicitudes_acceso` | `public` | Plataforma: ciclo de vida de acceso/permisos de una persona; no es entidad de negocio del producto. |

RLS por organización: el solicitante ve sus filas y los administradores de su organización ven las de la suya. No hay privilegios de escritura para `authenticated` ni ningún privilegio para `anon`; `anon` tampoco ejecuta la RPC (`revoke … from public, anon` + `grant … to authenticated`, ver `docs/acceso-ingreso.md`). `correo_enviado_en` solo lo escribe la Edge Function con la service-role (servidor).

Reversión (en una migración posterior, no en este PR): eliminar la función `public.solicitar_acceso(text)` y después la tabla `public.solicitudes_acceso`.

## Mecanismo de correo (hallazgo del spike T008)

Supabase no expone una API de correo transaccional con contenido libre: solo envía los correos de Auth (confirmación, invitación, enlace mágico, recuperación) por su SMTP. Disparar un correo de Auth al administrador se descartó porque emite un enlace de ingreso con otra plantilla. Por eso la Edge Function usa **el mismo SMTP que Supabase Auth**, sin proveedor nuevo:

| Entorno | SMTP |
|---|---|
| Local | Mailpit del stack (`[local_smtp]` en `supabase/config.toml`; interfaz en `SUPABASE_MAILPIT_PORT`, 4302). Puerto SMTP 1025 dentro de la red de Docker, contenedor `supabase_inbucket_<project_id>`. |
| Servidor self-hosted | El relay configurado para Auth (`GOTRUE_SMTP_*`). Si no hay un SMTP real configurado en el VPS, el correo no sale: es infraestructura a cargo de Nicolás. |

Cliente SMTP de Deno elegido: `denomailer` (`supabase/functions/_shared/correo.ts`). Si MSF-224 entrega un mecanismo propio, se reemplaza solo el transporte.

Variables de la función (solo en `supabase/functions/.env.example`; los valores reales son secretos de la función, nunca llegan al navegador ni a Git): `SMTP_HOST`, `SMTP_PORT`, `SMTP_TLS`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`. Los textos del correo son simples y quedan marcados en el PR (no hay diseño).

## Cómo verificar la salida del correo (FR-012)

- **Local (a):** con `pnpm dev:supabase` y las variables de la función cargadas, `pnpm correo:verificar-salida` con `AUTH_URL`, `FUNCTIONS_URL`, `SUPABASE_ANON_KEY`, `ACCESO_EMAIL`, `ACCESO_PASSWORD`, `SECCION` y `MAILPIT_URL` inicia sesión como una persona sin acceso, invoca el flujo real y comprueba por la API de Mailpit que el correo llegó.
- **Servidor self-hosted (b):** el mismo guion, sin `MAILPIT_URL`, contra el servidor, con un administrador de la organización de prueba cuyo correo sea `CORREO_PRUEBA` (`nicolas.m.jones@gmail.com`); se confirma a mano que el mensaje llegó y se adjunta la evidencia al PR. Es manual y opt-in: no corre en `pnpm test` ni en el CI. Si el relay SMTP del servidor no está configurado, se documenta el hallazgo y se traza como seguimiento de infraestructura.
