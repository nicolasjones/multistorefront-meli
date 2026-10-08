# Contrato: remover miembro

**Consumidor**: pantalla de miembros autenticada.

**Operación**: RPC `remover_miembro(target_user_id uuid)`.

**Autorización**: administrador de la organización del objetivo o superadmin
con esa organización activa.

## Entrada

`target_user_id` debe identificar una membresía de la organización que el actor
puede gestionar y no puede coincidir con el actor.

## Resultado

La RPC elimina la membresía y devuelve confirmación. En la misma transacción
registra `miembro_removido` con actor, objetivo, organización, rol previo y
timestamp. La cuenta de Auth no se elimina: puede incorporarse a otra
organización posteriormente.

## Rechazos

- Actor sin permisos o objetivo de otra organización: prohibido.
- Objetivo inexistente o el propio actor: inválido.
- Remover al último administrador: conflicto de regla de negocio.

La operación bloquea la organización antes de verificar el último administrador
y antes de eliminar, manteniendo la invariante ante solicitudes concurrentes.
