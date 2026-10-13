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
| `aceptar_invitacion()` | Persona invitada | Crea la membresía con el rol invitado; rechaza vencidas (`P0001`). Idempotente. |

Todas verifican el rol en la base (no solo en la interfaz): un no-Administrador recibe `42501`.

## Edge Function `invitar-miembro`

`POST { accion: 'invitar', email, rol }` (también reenvía) o `{ accion: 'cancelar', invitacion_id }`. Para un correo con cuenta de una invitación anterior que nunca ingresó, reemplaza la cuenta para emitir un enlace nuevo. Un correo con cuenta que ya ingresó y sin organización se agrega directo (`miembro_agregado`).

## Eventos (FR-012)

Hasta F-AUD-01 se reutiliza `eventos_membresia`: `usuario.invitado` = `invitacion_enviada` (y `invitacion_reenviada`). Cancelar borra la cuenta de Auth sin uso y, por `on delete cascade`, sus eventos; el registro de la cancelación queda en `invitaciones_organizacion.estado`.

## Decisión pendiente: vigencia del enlace de Auth

`supabase/config.toml` fija `otp_expiry = 3600` (1 h) para **todos** los enlaces de correo (spec 006: invitación y recuperación). La invitación vence a los 7 días en la base, pero el enlace de Auth sigue siendo de 1 h: pasada la hora, la persona usa «Solicitar otro enlace» o el Administrador reenvía. Subir `otp_expiry` a 7 días alargaría también la recuperación de contraseña, por lo que no se cambió sin decisión.

## Reversión

Migración posterior: eliminar las cinco RPC y la tabla `invitaciones_organizacion`, y restaurar el check de `eventos_membresia` (solo si ninguna fila usa `invitacion_reenviada`).

## Pendiente

- «Ver permisos de este rol →» apunta a `/roles?rol=<id>`; la pantalla llega con F-ROL-02.
- E2E de invitar y definir contraseña (T028) requiere el stack local con Docker.
