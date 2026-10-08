# Data Model: Panel de funcionalidades por organización

Todas las tablas viven en `public`, con RLS activado (Principio I). Las
mutaciones pasan exclusivamente por RPCs `security definer` — mismo
patrón endurecido que la spec 007 (`revoke all ... from anon,
authenticated; grant select ...`), no `insert`/`update`/`delete` directos
vía PostgREST.

La migración abre con un comentario de reversión: reversión = deshabilitar
toda fila de `organizaciones_features` que dependa de una funcionalidad a
retirar, después retirar RLS/RPCs/tablas en orden inverso — conservar
`eventos_features` hasta exportar o eliminar explícitamente su historial
(mismo requisito que `perfil_usuario.sql`, spec 008).

## `features`

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `text` | PK. `check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$')` — slug estable (research.md #1), dado de alta únicamente por la migración de la funcionalidad real que lo usa (FR-001) |
| `nombre` | `text` | `not null` |
| `descripcion` | `text` | nullable |
| `creado_por` | `uuid` | FK a `auth.users(id) on delete set null`, nullable — alta vía migración, no necesariamente una sesión interactiva |
| `creado_en` | `timestamptz` | `not null default now()` |

El catálogo arranca vacío — esta spec no inserta ninguna fila de negocio
real (Assumptions de spec.md).

## `organizaciones_features`

| Campo | Tipo | Notas |
|---|---|---|
| `feature_id` | `text` | FK a `features(id) on delete cascade` |
| `organizacion_id` | `uuid` | FK a `organizaciones(id) on delete cascade` |
| `habilitado_por` | `uuid` | FK a `auth.users(id)`, `not null` |
| `habilitado_en` | `timestamptz` | `not null default now()` |

PK `(feature_id, organizacion_id)`. Sin fila = deshabilitada — fail-closed
por diseño (FR-003). Borrar la fila es "deshabilitar" (FR-002); no existe
ningún estado intermedio ni historial de configuración que conservar
entre habilitaciones (a diferencia de `reportes_organizaciones_roles` en
007, acá no hay granularidad por rol — research.md #7).

## `eventos_features`

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `bigint` | PK, `generated always as identity` |
| `feature_id` | `text` | FK a `features(id) on delete cascade`, `not null` |
| `organizacion_id` | `uuid` | FK a `organizaciones(id) on delete cascade`, **nullable** — null en eventos a nivel de catálogo (`feature_registrada`), no nulo en eventos por organización |
| `actor_user_id` | `uuid` | FK a `auth.users(id)`, `not null` |
| `accion` | `text` | `not null`, `check (accion in ('feature_registrada', 'habilitada', 'deshabilitada'))` |
| `detalle` | `jsonb` | nullable |
| `created_at` | `timestamptz` | `not null default clock_timestamp()` |

Append-only — sin policy de `update`/`delete`, ninguna RPC la modifica
después de insertarla (FR-005, SC-003).

## Funciones helper (`private`, no expuestas como RPC)

- **`private.tiene_feature(p_feature_id text) returns boolean`** —
  "¿mi organización activa tiene esta funcionalidad habilitada?" (FR-006).
  `security definer`, `set search_path = ''`, `stable`.
  ```sql
  create or replace function private.tiene_feature(p_feature_id text)
  returns boolean
  language sql stable security definer set search_path = ''
  as $$
    select exists (
      select 1 from public.organizaciones_features of
      where of.feature_id = p_feature_id
        and of.organizacion_id = (select private.organizacion_id())
    );
  $$;
  ```
  Es el único punto que una funcionalidad futura debe llamar desde su
  propio RLS (`using (private.tiene_feature('mi-feature') and ...)`),
  cumpliendo FR-006 como control real de datos, no solo para ocultar UI.
  También responde `false` para un superadmin sin organización activa —
  no hay "organización de nadie" que evaluar (FR-009).

- **`private.puede_ver_feature_organizacion(p_feature_id text, p_organizacion_id uuid) returns boolean`**
  — "¿puedo ver ESTA fila puntual de `organizaciones_features`?" Compara
  el `organizacion_id` de la fila evaluada contra el de quien consulta —
  **nunca** reemplazar por `tiene_feature()` acá (research.md #6; mismo
  tipo de bug de aislamiento que `puede_ver_reporte` vs
  `puede_ver_asignacion` en 007 — ver `data-model.md` de esa spec).
  ```sql
  create or replace function private.puede_ver_feature_organizacion(
    p_feature_id text, p_organizacion_id uuid
  )
  returns boolean
  language sql stable security definer set search_path = ''
  as $$
    select p_organizacion_id = (select private.organizacion_id())
      and exists (
        select 1 from public.organizaciones_features of
        where of.feature_id = p_feature_id
          and of.organizacion_id = p_organizacion_id
      );
  $$;
  ```

## RPCs (`public`, `security definer`, `search_path = ''`)

Ver contratos completos en `contracts/gestion-funcionalidades.md`.

| RPC | Quién | Qué hace |
|---|---|---|
| `registrar_feature(p_id text, p_nombre text, p_descripcion text default null) returns features` | superadmin | inserta en `features`; llamada solo desde la migración de la funcionalidad real que la registra (research.md #2), nunca desde una pantalla |
| `habilitar_feature(p_feature_id text, p_organizacion_id uuid) returns void` | superadmin | `insert ... on conflict (feature_id, organizacion_id) do nothing` + `get diagnostics` — audita solo si insertó de verdad (idempotente, Principio III) |
| `deshabilitar_feature(p_feature_id text, p_organizacion_id uuid) returns void` | superadmin | `delete` + `get diagnostics` — mismo patrón de idempotencia |
| `tiene_feature_publica(p_feature_id text) returns boolean` | cualquier autenticado | wrapper delgado sobre `private.tiene_feature` — evita que el frontend duplique la resolución de "organización efectiva" (membresía directa vs. superadmin con organización activa) |

Las tres primeras rechazan (`errcode = '42501'`) a quien no sea
superadmin, antes de tocar ninguna fila (FR-010). `habilitar_feature` y
`deshabilitar_feature` validan que `p_feature_id` y `p_organizacion_id`
existan, rechazando (`errcode = 'P0002'`) si no.

## RLS

- `features`: `select` — `is_superadmin() or private.tiene_feature(id)`
  (FR-008, research.md #4) — **no** abierto a cualquier `authenticated`;
  una organización sin la funcionalidad habilitada no ve esa fila del
  catálogo.
- `organizaciones_features`: `select` — `is_superadmin() or private.puede_ver_feature_organizacion(feature_id, organizacion_id)`
  — nunca `tiene_feature()` acá (research.md #6, FR-007).
- `eventos_features`: `select` — `is_superadmin() or (organizacion_id = private.organizacion_id() and private.puede_escribir())`
  — mismo patrón que `eventos_reportes` en 007.

Ninguna tabla tiene policy de `insert`/`update`/`delete` — el `grant` a
`authenticated` es solo `select`; toda escritura pasa por una RPC
`security definer`.

`revoke all on table features, organizaciones_features, eventos_features from anon, authenticated;`
seguido de `grant select ... to authenticated` puntual por tabla.

## Relaciones

```text
features ──< organizaciones_features >── organizaciones
features ──< eventos_features >── organizaciones (nullable)
auth.users (Supabase) ──< features (creado_por, nullable)
auth.users (Supabase) ──< organizaciones_features (habilitado_por)
auth.users (Supabase) ──< eventos_features (actor_user_id)
```
