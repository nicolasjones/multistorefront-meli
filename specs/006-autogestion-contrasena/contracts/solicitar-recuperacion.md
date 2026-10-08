# Contrato: Solicitar recuperación o nuevo acceso

**Consumidor**: persona no autenticada desde acceso, enlace de invitación no
completado o enlace inválido.

**Operación**: solicitar un enlace de recuperación para el correo indicado.

## Solicitud

| Campo | Regla |
|---|---|
| `email` | dirección válida, normalizada antes de solicitar el correo |

## Resultado público

Siempre se muestra el mismo mensaje de éxito: "Si existe una cuenta para ese
correo, enviamos un enlace para continuar." No se revela si el correo tiene
cuenta, invitación pendiente o membresía.

## Reglas

- El enlace redirige a la ruta pública de definición de contraseña.
- Cada dirección puede solicitar un enlace como máximo cada 15 minutos.
- Auth conserva el enlace durante una hora y lo invalida al usarlo.
- Un fallo técnico se informa sin revelar el estado de la cuenta.
