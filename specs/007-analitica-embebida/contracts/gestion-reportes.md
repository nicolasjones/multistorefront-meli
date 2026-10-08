# Contract: RPCs de gestión de reportes

Todas `security definer`, `search_path = ''`, `revoke execute ... from
public; grant execute ... to authenticated` — mismo patrón que
`agregar_miembro` (spec 005). Todas devuelven una excepción (`errcode =
'42501'`) si quien llama no tiene el permiso requerido, antes de tocar
ninguna fila.

## `registrar_reporte(p_superset_dashboard_uuid text, p_nombre text, p_roles_default text[])`

**Quién**: solo `private.is_superadmin()`.

**Comportamiento**:
1. Si `p_roles_default` contiene `'administrador'`, `raise exception`
   (`errcode = '22023'`) — administrador no se configura (FR-006).
2. Inserta en `reportes` (`creado_por = auth.uid()`).
3. Inserta en `reportes_roles_default` una fila por cada rol del array.
4. Inserta en `eventos_reportes` (`accion = 'reporte_registrado'`,
   `organizacion_id = null`, `detalle = {"roles_default": [...]}`).

**Response**: la fila de `reportes` creada.

## `establecer_roles_default_reporte(p_reporte_id uuid, p_roles_id text[])`

**Quién**: solo `private.is_superadmin()`.

**Comportamiento**: reemplaza por completo el contenido de
`reportes_roles_default` para ese `reporte_id` (`delete` + `insert` en la
misma transacción). Rechaza `'administrador'` en el array, igual que
`registrar_reporte`. **No** modifica ninguna fila de
`reportes_organizaciones_roles` — las organizaciones ya asignadas no se
ven afectadas (FR-004, Acceptance Scenario 4 de la spec). Inserta evento
`default_actualizado`.

**Response**: `void`.

## `asignar_reporte(p_reporte_id uuid, p_organizacion_id uuid)`

**Quién**: solo `private.is_superadmin()`.

**Comportamiento**:
1. `insert into reportes_organizaciones (...) values (...) on conflict
   (reporte_id, organizacion_id) do nothing`.
2. Si la fila se insertó de verdad (no existía antes): el trigger
   `reportes_organizaciones_heredar_roles` copia el default vigente a
   `reportes_organizaciones_roles` (FR-004/FR-016), y se inserta evento
   `asignado`.
3. Si ya existía (idempotente — Principio III): no pasa nada más, no se
   duplica el evento.

**Response**: `void`.

## `desasignar_reporte(p_reporte_id uuid, p_organizacion_id uuid)`

**Quién**: solo `private.is_superadmin()`.

**Comportamiento**: `delete from reportes_organizaciones where
reporte_id = ... and organizacion_id = ...`. El `on delete cascade` de
`reportes_organizaciones_roles` limpia la visibilidad por rol de esa
organización — una reasignación posterior arranca de cero desde el default
vigente en ese momento (FR-016), no desde lo que tenía antes. Si no existía
la asignación, es un no-op (no inserta evento). Si existía, inserta evento
`desasignado`.

**Response**: `void`.

## `establecer_roles_reporte_organizacion(p_reporte_id uuid, p_organizacion_id uuid, p_roles_id text[])`

**Quién**: `private.puede_gestionar_reportes(p_organizacion_id)` — admin de
esa organización, o superadmin con esa organización activa.

**Comportamiento**:
1. Si no existe fila en `reportes_organizaciones` para ese
   `(reporte_id, organizacion_id)`, `raise exception` — no se puede
   configurar visibilidad de un reporte que no está asignado.
2. Si `p_roles_id` contiene `'administrador'`, `raise exception`
   (`errcode = '22023'`) — mismo motivo que en las RPCs del superadmin;
   administrador conserva acceso incondicional pase lo que pase (FR-006,
   Acceptance Scenario 3 de User Story 3).
3. Reemplaza por completo `reportes_organizaciones_roles` para ese
   `(reporte_id, organizacion_id)` (`delete` + `insert`, misma
   transacción) — nunca afecta la fila de otra organización ni el default
   global (FR-005).
4. Inserta evento `roles_organizacion_actualizados` con
   `organizacion_id` seteada y `detalle = {"roles": [...]}`.

**Response**: `void`.
