# Contract: RPCs de gestión del panel de funcionalidades

Todas `security definer`, `search_path = ''`, `revoke execute ... from
public; grant execute ... to authenticated` — mismo patrón que
`asignar_reporte` (spec 007). Todas devuelven una excepción (`errcode =
'42501'`) si quien llama no tiene el permiso requerido, antes de tocar
ninguna fila.

## `registrar_feature(p_id text, p_nombre text, p_descripcion text default null)`

**Quién**: solo `private.is_superadmin()`.

**Comportamiento**:
1. Valida el formato de `p_id` contra el mismo `check` de la tabla
   (`^[a-z0-9]+(-[a-z0-9]+)*$`) — error explícito, no dejar que el `check`
   de la tabla sea la única señal.
2. Inserta en `features` (`creado_por = auth.uid()`). Un `p_id` repetido
   rompe por la PK — a propósito no es `on conflict do nothing`: un slug
   duplicado entre dos funcionalidades distintas es un error de nombrado
   real que debe fallar ruidosamente, no absorberse en silencio.
3. Inserta en `eventos_features` (`accion = 'feature_registrada'`,
   `organizacion_id = null`).

**Response**: la fila de `features` creada.

## `habilitar_feature(p_feature_id text, p_organizacion_id uuid)`

**Quién**: solo `private.is_superadmin()`.

**Comportamiento**:
1. Si no existe `p_feature_id` en `features`, o `p_organizacion_id` en
   `organizaciones`, `raise exception` (`errcode = 'P0002'`).
2. `insert into public.organizaciones_features (feature_id,
   organizacion_id, habilitado_por) values (...) on conflict (feature_id,
   organizacion_id) do nothing`.
3. Si la fila se insertó de verdad (no existía antes): inserta evento
   `habilitada`.
4. Si ya existía (idempotente — Principio III): no pasa nada más, no se
   duplica el evento.

**Response**: `void`.

## `deshabilitar_feature(p_feature_id text, p_organizacion_id uuid)`

**Quién**: solo `private.is_superadmin()`.

**Comportamiento**: `delete from public.organizaciones_features where
feature_id = ... and organizacion_id = ...`. Si no existía la
habilitación, es un no-op (no inserta evento). Si existía, inserta evento
`deshabilitada`.

**Response**: `void`.

## `tiene_feature_publica(p_feature_id text) returns boolean`

**Quién**: cualquier `authenticated` — no valida rol, delega
completamente en `private.tiene_feature`.

**Comportamiento**: `select private.tiene_feature(p_feature_id)`. Wrapper
delgado para que el frontend no tenga que resolver "organización
efectiva" (membresía directa vs. superadmin con organización activa) por
su cuenta — esa resolución ya vive en `private.organizacion_id()`.

**Response**: `boolean`. `false` para cualquier caso sin organización
efectiva resuelta (incluido un superadmin sin organización activa).
