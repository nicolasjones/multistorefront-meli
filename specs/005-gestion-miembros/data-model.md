# Data Model: Gestión de miembros de organización

## Entidades existentes extendidas

### `usuarios_organizacion`

La membresía existente conserva `user_id` como clave primaria, por lo que una
persona solo puede pertenecer a una organización. Sus roles permitidos siguen
siendo `administrador` y `miembro`.

Reglas nuevas:

- Un administrador puede leer las membresías de su organización; un miembro solo conserva lectura de su propia fila.
- Un superadmin puede gestionar solo las membresías de su organización activa.
- Las escrituras no se exponen directamente a `authenticated`.
- La fila del último administrador no puede cambiar a `miembro` ni eliminarse.
- El fundador no tiene protección distinta: las reglas anteriores aplican igual.

### `auth.users`

Es la fuente de identidad y correo. No se expone al navegador. La Edge Function
usa la API administrativa de Auth en su entorno de servidor para resolver una
cuenta existente y decidir entre invitar una cuenta nueva o asociar una cuenta
ya existente sin membresía.

## Nueva entidad: `eventos_membresia`

Línea de tiempo append-only de operaciones efectivas de membresías.

| Campo | Tipo | Reglas |
|---|---|---|
| `id` | bigint identity | Clave primaria, orden determinístico de auditoría. |
| `organizacion_id` | uuid | Obligatorio; referencia a la organización afectada. |
| `actor_user_id` | uuid | Obligatorio; quien realizó la operación. |
| `target_user_id` | uuid | Obligatorio; persona incorporada, modificada o removida. |
| `accion` | text | Solo `invitacion_enviada`, `miembro_agregado`, `rol_cambiado` o `miembro_removido`. |
| `rol_anterior` | text nullable | Requerido para cambio de rol; nulo para incorporación/remoción según corresponda. |
| `rol_nuevo` | text nullable | Requerido para incorporación/cambio; nulo para remoción. |
| `created_at` | timestamptz | Obligatorio; instante de la operación efectiva. |

Restricciones:

- RLS habilitada y sin grants de inserción, actualización o borrado para el navegador.
- Se inserta únicamente desde las operaciones autorizadas de incorporación, cambio de rol y remoción.
- Índice por organización y orden descendente de evento para una futura consulta operativa.

## Operaciones y transiciones

| Operación | Precondiciones | Cambio | Evento |
|---|---|---|---|
| Invitar cuenta nueva | Actor gestiona la organización; email sin cuenta; rol válido | Auth crea invitación y se crea membresía reservada | `invitacion_enviada` |
| Asociar cuenta existente | Actor gestiona la organización; cuenta sin membresía; rol válido | Se crea membresía | `miembro_agregado` |
| Cambiar rol | Actor gestiona la organización; objetivo distinto al actor; rol válido; no último administrador | Se actualiza `rol_id` | `rol_cambiado` |
| Remover | Actor gestiona la organización; objetivo distinto al actor; no último administrador | Se elimina membresía | `miembro_removido` |

Una operación rechazada no modifica membresías ni crea evento de auditoría.

## Autorización derivada

`puede_gestionar_membresias(organizacion_id)` será verdadera solo para:

- un usuario con rol `administrador` en esa organización; o
- un superadmin cuyo contexto activo sea esa misma organización.

El helper se evalúa tanto en la lectura de listas como dentro de las RPCs de
mutación. Las operaciones de cambio/remoción bloquean la organización antes de
contar administradores para conservar la invariante ante acciones concurrentes.
