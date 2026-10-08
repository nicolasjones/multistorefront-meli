# Contrato: incorporar miembro

**Consumidor**: pantalla de miembros autenticada.

**Operación**: `POST /functions/v1/invitar-miembro`

**Autorización**: JWT del usuario en `Authorization: Bearer <token>`. Solo un
administrador de su propia organización o un superadmin dentro de su
organización activa puede invocarla.

## Solicitud

```json
{
  "email": "persona@example.com",
  "rol": "miembro"
}
```

- `email`: dirección válida, normalizada antes de resolver la identidad.
- `rol`: `administrador` o `miembro`.

## Respuesta exitosa

```json
{
  "user_id": "uuid",
  "organizacion_id": "uuid",
  "rol": "miembro",
  "resultado": "invitacion_enviada"
}
```

`resultado` vale `invitacion_enviada` para una cuenta nueva y
`miembro_agregado` cuando ya existía una cuenta sin membresía. En el segundo
caso no se envía correo.

## Errores funcionales

| Código | Cuándo ocurre |
|---|---|
| 400 | Email/rol inválido, la persona ya pertenece a una organización o es una incorporación duplicada. |
| 403 | No hay JWT válido o el actor no puede gestionar esa organización. |
| 409 | Una carrera detectó que la persona quedó vinculada mientras se procesaba la solicitud. |
| 502 | No se pudo completar la invitación de Auth para una cuenta nueva. No queda membresía ni evento efectivos. |

La función no acepta un identificador de organización desde el navegador: la
determina a partir de la membresía del actor o de su contexto activo.
