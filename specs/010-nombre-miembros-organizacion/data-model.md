# Data Model: Nombre visible entre miembros de una organización

No se crean ni modifican tablas ni columnas. Esta spec agrega una única
función de lectura sobre entidades ya existentes.

## Entidades existentes involucradas (sin cambios de estructura)

### `perfiles_usuario` (spec 008)

- `user_id uuid` (PK, referencia `auth.users`)
- `nombre text` (nullable)
- `apellido text` (nullable)
- `foto_path text` (nullable) — **fuera de alcance**, no expuesto por la
  función nueva (FR-005).
- RLS: sin cambios — `perfiles_usuario_select_titular` sigue siendo
  self-only (`user_id = auth.uid()`).

### `usuarios_organizacion` (spec 003)

- `user_id uuid`, `organizacion_id uuid`, `rol_id text`, `created_at
  timestamptz`.
- RLS: sin cambios — `usuarios_organizacion_select` sigue limitando la
  lectura directa de la tabla a la fila propia o a quien administra
  membresías (spec 005). La función nueva lee esta tabla puenteando esa
  policy (`security definer`), no la modifica.

## Objeto nuevo: función `public.listar_miembros_organizacion()`

Vista de solo lectura, calculada, sin persistencia propia — no es una
entidad de datos nueva sino la forma en que se combinan las dos existentes
para esta pantalla.

| Columna       | Tipo          | Origen                              | Notas |
|---------------|---------------|--------------------------------------|-------|
| `user_id`     | `uuid`        | `usuarios_organizacion.user_id`      | Identificador interno; la UI ya no lo muestra directamente (FR-003). |
| `rol_id`      | `text`        | `usuarios_organizacion.rol_id`       | Sin cambio de regla — ya visible hoy vía el mismo `join` para quien administra. |
| `created_at`  | `timestamptz` | `usuarios_organizacion.created_at`   | Fecha de incorporación, ya mostrada hoy en la pantalla. |
| `nombre`      | `text`        | `perfiles_usuario.nombre`            | `null` si la persona no completó su perfil (FR-004). |
| `apellido`    | `text`        | `perfiles_usuario.apellido`          | Igual que `nombre`; por el `check` de spec 008 nombre/apellido son ambos `null` o ambos con contenido, nunca uno solo. |

**Filtro de alcance** (FR-002, FR-006, FR-007): solo filas donde
`usuarios_organizacion.organizacion_id = private.organizacion_id()` — la
misma función ya usada por `clientes_select`, el panel de funcionalidades y
la analítica embebida para resolver "mi organización efectiva", incluido el
caso superadmin con organización activa. Una persona removida de la
organización deja de tener fila en `usuarios_organizacion` para esa
organización (spec 005), así que deja de aparecer en el resultado sin
lógica adicional.

**Filtro de llamador** (FR-001, alcance acordado en Clarifications): la
función solo devuelve filas si `private.puede_gestionar_membresias(v_organizacion_id)`
es verdadero para el llamador — un miembro raso que invoque la RPC
directamente recibe un conjunto vacío, igual que si no tuviera
organización efectiva. Este chequeo vive en la función (no solo en el
frontend) porque es `security definer` con `grant execute` a
`authenticated`.

**Relación con `foto_path`**: no forma parte de esta función; la foto sigue
resolviéndose en la UI exactamente como hoy (`FotoMiembro`, derivando la
ruta de Storage a partir del `user_id`, sin tocar `perfiles_usuario`).

## Regla de presentación (no de datos)

Cuando `nombre`/`apellido` son `null`, la pantalla de miembros muestra un
texto explícito ("Sin nombre completado" u otro equivalente a definir en
`tasks.md`/implementación) en vez de un espacio vacío o el `user_id`
(FR-004, SC-003). Esta regla vive en el frontend, no en la función SQL —
la función devuelve `null` sin decidir el texto de fallback.
