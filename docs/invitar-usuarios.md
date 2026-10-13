# Invitar usuarios (F-USR-01, MSF-211)

Contrato del flujo de invitación de la épica MSF-125 (spec `20261013-120000-usuarios-y-roles`, FR-009, FR-010, FR-012, FR-018).

## Modelo

- Tabla `public.invitaciones_organizacion` (plataforma → `public`, Principio VII), con RLS por organización: solo lee quien gestiona membresías (`private.puede_gestionar_membresias`). No tiene políticas de escritura: todo pasa por RPC `security definer`.
- Estados guardados: `pendiente`, `aceptada`, `cancelada`. **`vencida` se deriva** (`pendiente` con `vence_en <= now()`); `vence_en` es `now() + 7 días` al crear o reenviar.
- **La membresía (`usuarios_organizacion`) se crea al aceptar**, no al invitar: una invitación vencida o cancelada no deja acceso ni siquiera si la persona recupera su contraseña después.
- Una sola invitación pendiente por `(organización, correo)`: invitar de nuevo la renueva (reenvío), no la duplica.

## RPC

| Función | Quién | Qué hace |
|---|---|---|
| `registrar_invitacion(email, rol)` | Administrador | Valida rol (los seis), correo, que la persona no pertenezca a otra organización; crea o renueva la pendiente. |
| `vincular_invitacion(id, user_id, accion)` | Administrador (vía Edge Function) | Asocia la cuenta de Auth y emite el evento en `eventos_membresia`. |
| `cancelar_invitacion(id)` | Administrador | Marca `cancelada`; devuelve la cuenta de Auth sin uso para que la Edge Function la borre y el enlace deje de servir. |
| `mi_invitacion()` | Persona invitada | Rol y vigencia para «Fuiste invitado como <rol>». |
| `aceptar_invitacion()` | Persona invitada | Crea la membresía con el rol invitado; rechaza vencidas (`P0001`) y canceladas o inexistentes (`P0002`, la página no deja entrar). Idempotente: si la cuenta ya aceptó, devuelve el rol de su membresía (reintento tras fallar el guardado de la contraseña). |

Todas verifican el rol en la base (no solo en la interfaz): un no-Administrador recibe `42501`.

## Edge Function `invitar-miembro`

`POST { accion: 'invitar', email, rol }` (también reenvía) o `{ accion: 'cancelar', invitacion_id }`. Para un correo con cuenta de una invitación anterior que nunca ingresó, reemplaza la cuenta para emitir un enlace nuevo. Un correo con cuenta que ya ingresó y sin organización se agrega directo (`miembro_agregado`).

## Eventos (FR-012)

Hasta F-AUD-01 se reutiliza `eventos_membresia`: `usuario.invitado` = `invitacion_enviada` (y `invitacion_reenviada`); además `invitacion_cancelada` y `miembro_agregado` (al aceptar o al agregar directo). La migración `20261013150000_invitaciones_endurecer.sql` cambia `target_user_id` a `on delete set null` y agrega `target_email`: al cancelar o reemplazar la cuenta de Auth los eventos **se conservan**, con el correo como identidad.

## Seguridad de la vinculación

- `vincular_invitacion` recibe `p_user_id` del cliente, así que lo valida: la cuenta debe tener el mismo correo que la invitación y no pertenecer a una organización. Agregar directo (`miembro_agregado`) solo vale para una cuenta que **ya ingresó** alguna vez; una que nunca ingresó debe aceptar la invitación.
- `aceptar_invitacion` / `mi_invitacion` exigen que el correo de la cuenta coincida con el de la invitación. Un índice único parcial impide que una cuenta de Auth esté en dos invitaciones pendientes.
- La Edge Function solo reemplaza (borra y reinvita) la cuenta sin ingreso que es la de **esa** invitación; si el correo tiene una cuenta sin ingreso que no lo es (p. ej. de otra organización), responde 409 sin tocarla.
- Si falla el envío, la función compensa: una invitación nueva se elimina; una renovada solo suelta la cuenta ya borrada y queda reenviable. Si no se puede borrar la cuenta al cancelar, responde 502 (la invitación igual queda cancelada y su enlace no da acceso).
- Cuenta huérfana: si una cancelación no pudo borrar la cuenta de Auth, el siguiente reenvío al mismo correo la adopta (la borra y reinvita) siempre que no ingresó nunca y ninguna otra invitación pendiente la use.
- Agregar directo exige además correo confirmado (`20261013160000_invitaciones_aceptar_estricto.sql`, reversión en su cabecera). `eventos_membresia` no tiene policy de select: solo la leen las funciones definer y los tests pgTAP como `postgres`.
- Residuales aceptados (no bloquean): CORS `*` (la función exige bearer token, sin cookies); `listUsers` pagina las cuentas de Auth en cada invitación (O(N), a optimizar con una RPC si la base crece); `23505` ya es genérico.
- Los errores se mapean por código; no sale el texto interno de Postgres ni se revela en qué organización está una persona («No se puede invitar a ese correo»). Residual aceptado: el diálogo distingue «Usuario agregado» (cuenta que ya ingresó y sin organización) de «Invitación enviada».
- Fuera de esta historia: `agregar_miembro` (legada, spec de gestión de miembros) sigue ejecutable, y no hay límite de frecuencia de reenvío.

## Vigencia del enlace de Auth (decisión)

`supabase/config.toml` fija `otp_expiry = 3600` (1 h) para **todos** los enlaces de correo (invitación y recuperación; Auth admite como máximo 24 h). Se **mantiene**: alargarlo ensancharía también la ventana de recuperación de contraseña. La invitación vence a los 7 días en la base, pero el enlace dura 1 h; por eso el diálogo y el aviso de reenvío lo dicen («la invitación vence en 7 días; el enlace del correo dura 1 hora y, si vence, se puede reenviar»). Pasada la hora, la persona usa «Solicitar otro enlace» o el Administrador reenvía.

## Reversión

Migración posterior: eliminar las cinco RPC y la tabla `invitaciones_organizacion`, y restaurar el check de `eventos_membresia` (solo si ninguna fila usa `invitacion_reenviada` ni `invitacion_cancelada`). Para `20261013150000`: ver su cabecera (índice único, columna `target_email`, funciones a su versión anterior; `target_user_id` vuelve a `not null ... cascade` solo si no hay filas nulas).

## Pruebas

- pgTAP: `supabase/tests/database/invitaciones_usuarios.test.sql` y `invitaciones_usuarios_endurecimiento.test.sql` (correo de la cuenta, agregar directo, aceptar de otra organización, auditoría tras borrar la cuenta).
- Edge Function: `pnpm test:edge:invitar-miembro` (`supabase/functions/invitar-miembro/handler.test.ts`; la lógica vive en `handler.ts` con dependencias inyectadas, `index.ts` solo las cablea). Corre en el job `application` del CI a través de `pnpm test:web`.

## Pendiente

- «Ver permisos de este rol →» apunta a `/roles?rol=<id>`; la pantalla llega con F-ROL-02.
- E2E de invitar y definir contraseña (T028) requiere el stack local con Docker.
