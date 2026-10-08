# Contrato: cambiar rol de miembro

**Consumidor**: pantalla de miembros autenticada.

**Operación**: RPC `cambiar_rol_miembro(target_user_id uuid, nuevo_rol text)`.

**Autorización**: administrador de la organización del objetivo o superadmin
con esa organización activa.

## Entrada

| Campo | Regla |
|---|---|
| `target_user_id` | Debe ser una membresía de la organización que el actor puede gestionar y no puede ser el propio actor. |
| `nuevo_rol` | Solo `administrador` o `miembro`; debe diferir del rol actual. |

## Resultado

La RPC devuelve el identificador, organización y nuevo rol de la membresía
actualizada. En la misma transacción registra `rol_cambiado` con actor, objetivo,
rol previo, rol nuevo y timestamp.

## Rechazos

- Actor sin permisos o objetivo de otra organización: prohibido.
- Objetivo inexistente: no encontrado.
- Cambio sobre sí mismo o rol inválido: inválido.
- Degradar al último administrador: conflicto de regla de negocio.

La operación bloquea la organización antes de verificar el último administrador,
por lo que dos administradores concurrentes no pueden dejarla sin uno.
