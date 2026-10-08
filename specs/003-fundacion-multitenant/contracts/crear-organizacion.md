# Contract: Edge Function `crear-organizacion`

**Quién la llama**: Refine, desde la pantalla de organizaciones (Historia 2),
solo accesible a superadmin.

## Request

```http
POST /functions/v1/crear-organizacion
Authorization: Bearer <jwt del superadmin>
Content-Type: application/json

{
  "nombre": "string, requerido",
  "email_fundador": "string (email), requerido"
}
```

## Comportamiento

1. Verifica que el JWT corresponda a un usuario con fila en `superadmins`.
   Si no, `403`.
2. Inserta la fila en `organizaciones`.
3. Llama a la Auth Admin API (`auth.admin.inviteUserByEmail`) con
   `email_fundador` — Supabase envía el email de invitación.
4. Inserta la fila en `usuarios_organizacion` (`user_id` del invitado,
   `organizacion_id` de la fila creada, `rol_id = 'administrador'`).
5. Si el paso 3 falla (email inválido, ya invitado, etc.), revierte la
   organización creada en el paso 2 (no debe quedar una organización sin
   su primer administrador).

## Response

**201 Created**
```json
{ "organizacion_id": "uuid", "invitado": "email_fundador" }
```

**403 Forbidden** — quien llama no es superadmin.

**400 Bad Request** — falta `nombre` o `email_fundador`, o el email ya
tiene cuenta con membresía activa en otra organización (FR-002: un usuario,
una sola organización).

**502 Bad Gateway** — falló el envío de la invitación (rollback aplicado).
