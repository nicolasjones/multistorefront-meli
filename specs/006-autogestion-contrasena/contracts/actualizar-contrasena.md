# Contrato: Definir o modificar contraseña

**Consumidor**: persona con una sesión válida de invitación, recuperación o
sesión normal.

## Solicitud de definición mediante enlace

| Campo | Regla |
|---|---|
| `nueva_contrasena` | mínimo 12 caracteres; al menos una mayúscula, una minúscula, un número y un símbolo |
| `confirmacion` | debe coincidir con `nueva_contrasena` |

La sesión temporal del enlace es obligatoria. Un enlace inválido, usado o
vencido impide la actualización y ofrece solicitar otro enlace.

## Solicitud de cambio desde sesión normal

| Campo | Regla |
|---|---|
| `contrasena_actual` | debe coincidir con la credencial vigente del titular |
| `nueva_contrasena` | aplica la misma política de 12 caracteres |
| `confirmacion` | debe coincidir con `nueva_contrasena` |

## Resultado efectivo

- La contraseña anterior deja de permitir nuevas autenticaciones.
- Se conservan la sesión que completó el flujo y se cierran las demás sesiones
  para renovación.
- Se emite un aviso por correo sin contraseña ni enlace sensible.

## Errores funcionales

| Situación | Mensaje esperado |
|---|---|
| enlace inválido, usado o vencido | Indicar que el enlace ya no sirve y ofrecer solicitar otro |
| política o confirmación inválida | Explicar el requisito incumplido sin revelar la contraseña |
| contraseña actual incorrecta | Indicar que no coincide y ofrecer recuperación |
| fallo temporal | Indicar que no se modificó la contraseña y permitir reintentar |
