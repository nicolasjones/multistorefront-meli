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

Antes de resolver la cuenta de Auth (service-role), la función llama al RPC `puede_invitar()` (migración `20261013210000`, sin tablas nuevas; reversión: `drop function public.puede_invitar()`): devuelve la organización del llamador solo si gestiona membresías, si no 403. Así un no-administrador no dispara el barrido de `listUsers` ni distingue un correo con cuenta de uno libre (FR-009), y la comprobación de cuenta vinculada se acota a esa organización.

`POST { accion: 'invitar', email, rol }` (también reenvía) o `{ accion: 'cancelar', invitacion_id }`. Para un correo cuya cuenta creó ESTA invitación (aunque ya haya abierto el enlace sin definir contraseña) o que nunca confirmó el correo, reemplaza la cuenta para emitir un enlace nuevo: reenviar nunca agrega sin que la persona acepte. `cancelar_invitacion` devuelve para borrar esa misma cuenta (creada por la invitación, sin membresía ni otra invitación pendiente), haya ingresado o no. La cuenta «creada por la invitación» se reconoce por `auth.users.invited_at` (lo fija Auth solo en `inviteUserByEmail`): `vincular_invitacion` la exige para enviar o reenviar el enlace y `cancelar_invitacion` solo devuelve para borrar cuentas con `invited_at`, así una persona registrada por su cuenta nunca se borra. Un correo con una cuenta preexistente (no creada por esta invitación) que ya ingresó, confirmó el correo y no tiene organización se agrega directo (`miembro_agregado`); esa decisión (FR-009 no la exige ni la prohíbe) queda para confirmar con el CTO. Riesgo conocido: la diferencia entre 201 (`miembro_agregado`) y 409 permite inferir si un correo tiene una cuenta que ya ingresó.

## Eventos (FR-012)

Hasta F-AUD-01 se reutiliza `eventos_membresia`: `usuario.invitado` = `invitacion_enviada` (y `invitacion_reenviada`); además `invitacion_cancelada` y `miembro_agregado` (solo al aceptar la invitación). La migración `20261013150000_invitaciones_endurecer.sql` cambia `target_user_id` a `on delete set null` y agrega `target_email`: al cancelar o reemplazar la cuenta de Auth los eventos **se conservan**, con el correo como identidad.

## Seguridad de la vinculación

- `vincular_invitacion` recibe `p_user_id` del cliente, así que lo valida: la cuenta debe tener el mismo correo que la invitación y no pertenecer a una organización. No existe alta directa: la acción `miembro_agregado` se rechaza (22023) y solo vincula la cuenta creada por la invitación.
- `aceptar_invitacion` / `mi_invitacion` exigen que el correo de la cuenta coincida con el de la invitación. Un índice único parcial impide que una cuenta de Auth esté en dos invitaciones pendientes.
- La Edge Function solo reemplaza (borra y reinvita) la cuenta sin ingreso que es la de **esa** invitación; si el correo tiene una cuenta sin ingreso que no lo es (p. ej. de otra organización), responde 409 sin tocarla. Solo se borra una cuenta creada por una invitación (`invited_at` no nulo): una auto-registración pendiente de confirmar nunca se borra. Una cuenta que no se puede reemplazar y que no está vinculada a ninguna invitación pendiente se rechaza (409) **antes** de llamar a `registrar_invitacion`, para que un reenvío fallido no deje renovados el rol ni el vencimiento de la invitación.
- Si falla el envío, la función compensa: una invitación nueva se elimina; una renovada solo suelta la cuenta ya borrada y queda reenviable. Si no se puede borrar la cuenta al cancelar, responde 502 (la invitación igual queda cancelada y su enlace no da acceso).
- Cuenta huérfana: si una cancelación no pudo borrar la cuenta de Auth, el siguiente reenvío al mismo correo la adopta (la borra y reinvita) siempre que no ingresó nunca y ninguna otra invitación pendiente la use.
- `eventos_membresia` no tiene policy de select: solo la leen las funciones definer y los tests pgTAP como `postgres`.
- Residuales aceptados (no bloquean): la respuesta 201 vs 409 permite a un Administrador sondear si un correo ya está en otra organización (decisión pendiente: respuesta opaca o límite de frecuencia); CORS `*` (la función exige bearer token, sin cookies); `listUsers` pagina las cuentas de Auth en cada invitación (O(N), a optimizar con una RPC si la base crece); `23505` ya es genérico.
- `cambiar_rol_miembro` acepta los 6 roles de negocio y `miembro` (migración `20261013170001_cambiar_rol_miembro_seis_roles.sql`, aditiva; test `cambiar_rol_miembro_seis_roles.test.sql`): el selector de Miembros no falla. La guarda del último administrador cubre cualquier rol destino.
- Los errores se mapean por código (solo «Rol inválido»/«Correo inválido» llevan mensaje propio; el resto de 22023 responde 409 «No se puede invitar a ese correo», así una cuenta confirmada que nunca ingresó no revela que el correo tiene cuenta); no sale el texto interno de Postgres ni se revela en qué organización está una persona («No se puede invitar a ese correo»).
- Fuera de esta historia: `agregar_miembro` (legada, spec de gestión de miembros) sigue ejecutable, y no hay límite de frecuencia de reenvío.

## Vigencia del enlace de Auth (decisión)

`supabase/config.toml` fija `otp_expiry = 3600` (1 h) para **todos** los enlaces de correo (invitación y recuperación; Auth admite como máximo 24 h). Se **mantiene**: alargarlo ensancharía también la ventana de recuperación de contraseña. La invitación vence a los 7 días en la base, pero el enlace dura 1 h; por eso el diálogo y el aviso de reenvío lo dicen («la invitación vence en 7 días; el enlace del correo dura 1 hora y, si vence, se puede reenviar»). Pasada la hora, la persona usa «Solicitar otro enlace» o el Administrador reenvía. El enlace de «Solicitar otro enlace» es de recuperación: `definir-contrasena` también llama a `aceptar_invitacion` con ese origen (en una recuperación común `P0002`/`P0001`/`23505` no bloquean el cambio de contraseña), así la invitación pendiente se acepta por cualquiera de los dos caminos.

## Restablecer la contraseña de otro usuario (F-USR-03, MSF-264)

Sin RPC ni mecanismo nuevo: en `/usuarios` → «Editar usuario» el administrador pulsa «Restablecer contraseña» y la pantalla llama a `supabaseClient.auth.resetPasswordForEmail` con el redirect `definir-contrasena?tipo=recuperacion` (el mismo correo de recuperación de F-ACC-02). El administrador nunca ve ni fija la contraseña; la persona la define con el flujo existente.

- **Suspendido (FR-006)**: el botón queda deshabilitado y el diálogo indica reactivar primero; además `restablecerContrasena` no envía nada para `estado = 'suspendido'`.
- **Solo administrador y no uno mismo (FR-007)**: las acciones de fila solo se ofrecen con `puedeEscribir` y se omiten en la fila propia (la contraseña propia se cambia en «Cuenta»).
- **Error**: se muestra dentro del diálogo («No pudimos enviar el enlace…») sin revelar más datos.
- Pruebas: Vitest en `apps/web/src/pages/usuarios/list.test.tsx`. Sin E2E: el repo no tiene suite Playwright de la app.
- Reversión: revertir el commit; no toca base de datos.

## Reversión

Migración posterior: eliminar las cinco RPC y la tabla `invitaciones_organizacion`, y restaurar el check de `eventos_membresia` (solo si ninguna fila usa `invitacion_reenviada` ni `invitacion_cancelada`). Para `20261013150000`: ver su cabecera (índice único, columna `target_email`, funciones a su versión anterior; `target_user_id` vuelve a `not null ... cascade` solo si no hay filas nulas).

## Pruebas

- pgTAP: `supabase/tests/database/invitaciones_usuarios.test.sql` y `invitaciones_usuarios_endurecimiento.test.sql` (correo de la cuenta, alta directa rechazada, aceptar de otra organización, auditoría tras borrar la cuenta).
- Edge Function: `pnpm test:edge:invitar-miembro` (`supabase/functions/invitar-miembro/handler.test.ts`; la lógica vive en `handler.ts` con dependencias inyectadas, `index.ts` solo las cablea). Corre en el job `application` del CI a través de `pnpm test:web`.

## Pendiente

- «Ver permisos de este rol →» está oculto (`PERMISOS_POR_ROL_DISPONIBLE` en `lib/rolesUsuarios.ts`) porque `/roles` no existe; se activa con F-ROL-02.
- E2E de invitar y definir contraseña (T028) requiere el stack local con Docker.

## Renombre de migraciones por colisión de versión (merge de `dokploy`)

Al integrar la base `dokploy` coincidieron seis versiones con migraciones propias de la épica MSF-125. Se renombraron las de la épica (+1 segundo; el contenido no cambió): `20261013130000_roles_basicos_permisos` → `20261013130002`, `…160000_invitaciones_aceptar_estricto` → `…160001`, `…170000_cambiar_rol_miembro_seis_roles` → `…170001`, `…180000_cancelar_invitacion_cuenta_abierta` → `…180001`, `…190000_invitaciones_cuenta_invitada` → `…190001`, `…200000_invitaciones_sin_alta_directa` → `…200001`.
