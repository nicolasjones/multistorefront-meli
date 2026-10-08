# Data Model: Fundación multi-tenant

Todas las tablas viven en el schema `public`, con RLS activado (Principio I
de la constitución exige RLS en toda tabla expuesta).

## `organizaciones`

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `uuid` | PK, `default gen_random_uuid()` |
| `nombre` | `text` | `not null` |
| `created_at` | `timestamptz` | `not null default now()` |

Sin RLS de aislamiento propio (es el tenant en sí) — solo lectura permitida
al miembro/admin de la fila de `usuarios_organizacion` correspondiente y a
cualquier superadmin (el listado de Historia 2 es superadmin-only, ver
policy en el plan de tareas).

## `roles_organizacion`

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `text` | PK — slug del rol (`administrador`, `miembro`) |
| `descripcion` | `text` | qué puede hacer ese rol, en criollo |

Tabla de datos, no un `check` fijo en el esquema — agregar o renombrar un
rol es una fila nueva, no una migración que toque una tabla existente.
Se precarga con las dos filas que necesita esta spec:

```sql
insert into roles_organizacion (id, descripcion) values
  ('administrador', 'Gestiona membresías y datos: lee, crea y edita.'),
  ('miembro', 'Solo lee/lista datos de negocio; no crea ni edita, no gestiona membresías.');
```

## `usuarios_organizacion`

| Campo | Tipo | Notas |
|---|---|---|
| `user_id` | `uuid` | PK y FK a `auth.users(id)` — **único**: como máximo una fila por usuario (FR-002, un usuario = una sola organización) |
| `organizacion_id` | `uuid` | FK a `organizaciones(id)`, `not null` |
| `rol_id` | `text` | FK a `roles_organizacion(id)`, `not null` |
| `created_at` | `timestamptz` | `not null default now()` |

`user_id` como PK (no una columna `id` separada) es lo que hace physicalmente
imposible que un usuario tenga dos filas — la restricción de FR-002 queda
garantizada por el esquema, no solo por una regla de negocio.

## `clientes`

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `uuid` | PK, `default gen_random_uuid()` |
| `organizacion_id` | `uuid` | FK a `organizaciones(id)`, `not null default private.organizacion_id()` — el molde que reutiliza cualquier tabla de negocio futura. El `default` es parte del molde: sin él, crear una fila desde Refine sin indicar la organización a mano falla contra RLS (US3/AC1) |
| `nombre` | `text` | `not null` |
| `created_at` | `timestamptz` | `not null default now()` |

## `superadmins`

| Campo | Tipo | Notas |
|---|---|---|
| `user_id` | `uuid` | PK y FK a `auth.users(id)` |
| `created_at` | `timestamptz` | `not null default now()` |

Marca a un usuario como superadmin (FR-003). Hoy tiene una sola fila (vos).

## `superadmin_organizacion_activa`

| Campo | Tipo | Notas |
|---|---|---|
| `user_id` | `uuid` | PK y FK a `auth.users(id)` |
| `organizacion_id` | `uuid` | FK a `organizaciones(id)`, `not null` |
| `entrado_en` | `timestamptz` | `not null default now()` |

Estado **actual** — una fila por superadmin, se sobrescribe (`upsert`) cada
vez que entra a una organización distinta. No es el historial (eso es la
tabla siguiente).

## `superadmin_entradas`

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `bigint` | PK, `generated always as identity` |
| `user_id` | `uuid` | FK a `auth.users(id)`, `not null` |
| `organizacion_id` | `uuid` | FK a `organizaciones(id)`, `not null` |
| `entrado_en` | `timestamptz` | `not null default now()` |

Append-only, nunca se actualiza ni se borra — es el registro de auditoría
que exige FR-013.

## Relaciones

```text
roles_organizacion ──< usuarios_organizacion >── organizaciones ──< clientes
auth.users (Supabase) ──< usuarios_organizacion
auth.users (Supabase) ──< superadmins
auth.users (Supabase) ──< superadmin_organizacion_activa >── organizaciones
auth.users (Supabase) ──< superadmin_entradas >── organizaciones
```

## Funciones helper (usadas por RLS, no son tablas pero son parte del modelo)

Viven en un schema propio, `private` — no en `auth` (Postgres no deja
crear objetos ahí ni siquiera en local: lo posee `supabase_auth_admin`, ver
research.md) — y no está en la lista de schemas expuestos por la Data API,
así que no aparecen como RPC público.

- `private.is_superadmin() returns boolean` — `exists (select 1 from superadmins where user_id = auth.uid())`.
- `private.organizacion_id() returns uuid` — resuelve la organización del
  usuario actual: su fila en `usuarios_organizacion`, o si es superadmin,
  su fila en `superadmin_organizacion_activa`. Es la función que reutiliza
  cualquier policy de aislamiento futura (FR-004, SC-003).
- `private.puede_escribir() returns boolean` — `true` si el usuario tiene
  `rol_id = 'administrador'` en su fila de `usuarios_organizacion`, o es
  superadmin con esa organización activa. Usada solo en policies de
  escritura de tablas con distinción admin/miembro (hoy, `clientes`).
