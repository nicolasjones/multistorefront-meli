# Data Model: Analítica embebida por organización

Todas las tablas viven en `public`, con RLS activado (Principio I). Las
mutaciones pasan exclusivamente por RPCs `security definer` — el patrón
endurecido que ya usa la spec 005 (`revoke all ... from anon, authenticated;
grant select ...`), no `insert`/`update`/`delete` directos vía PostgREST.

## `reportes`

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `uuid` | PK, `default gen_random_uuid()` |
| `superset_dashboard_uuid` | `text` | `not null unique` — el UUID de embedding que Superset genera al habilitar un dashboard (research.md #2), no el `id` interno del dashboard |
| `nombre` | `text` | `not null` — nombre a mostrar en Refine, independiente del título real en Superset |
| `creado_por` | `uuid` | FK a `auth.users(id)`, `not null` |
| `creado_en` | `timestamptz` | `not null default now()` |

## `reportes_roles_default`

| Campo | Tipo | Notas |
|---|---|---|
| `reporte_id` | `uuid` | FK a `reportes(id) on delete cascade` |
| `rol_id` | `text` | FK a `roles_organizacion(id)` |

PK `(reporte_id, rol_id)`. `check (rol_id <> 'administrador')` — garantiza
FR-006 a nivel de esquema: administrador nunca es una fila configurable acá,
tiene acceso incondicional por otra vía (ver RLS de `reportes` más abajo).

## `reportes_organizaciones`

| Campo | Tipo | Notas |
|---|---|---|
| `reporte_id` | `uuid` | FK a `reportes(id) on delete cascade` |
| `organizacion_id` | `uuid` | FK a `organizaciones(id) on delete cascade` |
| `asignado_por` | `uuid` | FK a `auth.users(id)`, `not null` |
| `asignado_en` | `timestamptz` | `not null default now()` |

PK `(reporte_id, organizacion_id)`. Borrar una fila acá es "desasignar"
(FR-003/FR-016) — el `on delete cascade` de la tabla siguiente se encarga
de limpiar la visibilidad por rol de esa organización sin un paso aparte.

## `reportes_organizaciones_roles`

| Campo | Tipo | Notas |
|---|---|---|
| `reporte_id` | `uuid` | — |
| `organizacion_id` | `uuid` | — |
| `rol_id` | `text` | FK a `roles_organizacion(id)` |

PK `(reporte_id, organizacion_id, rol_id)`. FK compuesta
`(reporte_id, organizacion_id) references reportes_organizaciones(reporte_id, organizacion_id) on delete cascade`.
`check (rol_id <> 'administrador')` — mismo motivo que en la tabla default.

Se completa por un trigger `AFTER INSERT` en `reportes_organizaciones`
(`private.heredar_roles_default_reporte()`) que copia las filas vigentes de
`reportes_roles_default` para ese `reporte_id` — es la herencia congelada
de FR-004/FR-016: corre una sola vez, al momento de la asignación, nunca
se vuelve a sincronizar con el default.

```sql
create or replace function private.heredar_roles_default_reporte()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.reportes_organizaciones_roles (reporte_id, organizacion_id, rol_id)
  select new.reporte_id, new.organizacion_id, rol_id
  from public.reportes_roles_default
  where reporte_id = new.reporte_id;
  return new;
end;
$$;

create trigger reportes_organizaciones_heredar_roles
  after insert on public.reportes_organizaciones
  for each row execute function private.heredar_roles_default_reporte();
```

## `eventos_reportes`

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `bigint` | PK, `generated always as identity` |
| `reporte_id` | `uuid` | FK a `reportes(id) on delete cascade`, `not null` |
| `organizacion_id` | `uuid` | FK a `organizaciones(id) on delete cascade`, **nullable** — null para eventos a nivel de reporte (`reporte_registrado`, `default_actualizado`), no nulo para eventos por organización |
| `actor_user_id` | `uuid` | FK a `auth.users(id)`, `not null` |
| `accion` | `text` | `not null`, `check (accion in ('reporte_registrado', 'default_actualizado', 'asignado', 'desasignado', 'roles_organizacion_actualizados'))` |
| `detalle` | `jsonb` | ej. `{"roles": ["miembro"]}` — un solo campo flexible en vez de columnas `rol_anterior`/`rol_nuevo`, porque acá se reemplaza el conjunto completo de roles en cada cambio (FR-005/FR-016), no un valor único |
| `created_at` | `timestamptz` | `not null default clock_timestamp()` |

Append-only — sin policy de `update`/`delete`, ninguna RPC la modifica
después de insertarla (FR-012, SC-004).

## Funciones helper (`private`, no expuestas como RPC)

- **`private.rol_id() returns text`** — el `rol_id` del usuario actual en
  `usuarios_organizacion`, o `'administrador'` si es superadmin con una
  organización activa (mismo criterio que `private.puede_escribir()` trata
  a un superadmin en contexto). `null` si no aplica ninguno de los dos
  casos.
- **`private.puede_gestionar_reportes(p_organizacion_id uuid) returns boolean`**
  — administrador de esa organización, o superadmin con esa organización
  activa. Misma lógica que `private.puede_gestionar_membresias` de la spec
  005, redefinida acá porque esta spec parte de `main` sin ese PR mergeado
  todavía (research.md #7).
- **`private.puede_ver_reporte(p_reporte_id uuid) returns boolean`** —
  agregada durante la implementación (no estaba en el diseño original de
  este documento): `exists` contra `reportes_organizaciones` (la
  asignación) con `organizacion_id = private.organizacion_id()`, y
  `private.rol_id() = 'administrador'` o una fila propia en
  `reportes_organizaciones_roles`. Encapsularlo evita que la policy de
  `select` de `reportes` (y la de `reportes_organizaciones`, que también la
  reusa) consulte otra tabla con RLS propia desde dentro de su propio
  `using` — el mismo riesgo de recursión de policies que ya motivó que
  `private.organizacion_id()` e `is_superadmin()` fueran `security
  definer` en la spec 003.
  - **Corrección post-quickstart**: la primera versión chequeaba
    `reportes_organizaciones_roles` directo (existía una fila con ese
    `rol_id`, o el caller era administrador). Se rompía en un caso real:
    una organización con **cero** roles habilitados para un reporte (p.
    ej. tras destildar el único rol) no tiene ninguna fila ahí — ni
    siquiera para `administrador`, que nunca tiene fila propia (FR-006) —
    así que el `exists` daba `false` también para el administrador,
    violando su acceso incondicional. Apoyarse en
    `reportes_organizaciones` en cambio funciona porque esa fila existe
    mientras el reporte esté asignado, sin importar cuántos roles tenga
    habilitados (quickstart.md sección 3).
  - **Responde "¿mi organización puede ver ESTE reporte, en general?"** —
    correcto para `reportes` (una fila por reporte), pero NO sirve para la
    policy de `reportes_organizaciones` (una fila **por organización**
    asignada a un reporte) — ver `private.puede_ver_asignacion()` más
    abajo, agregada para corregir un bug de aislamiento real que reusar
    esta función ahí causó.
- **`private.puede_ver_asignacion(p_reporte_id uuid, p_organizacion_id uuid) returns boolean`**
  — agregada para corregir un **bug de aislamiento multi-tenant real**
  encontrado corriendo el quickstart (T023, sección fuera del guion
  original — "¿cada organización ve solo lo suyo?"): la policy de
  `reportes_organizaciones` usaba `puede_ver_reporte(reporte_id)`, que
  solo comprueba "¿mi organización tiene ALGUNA fila para este reporte?",
  sin comparar el `organizacion_id` de la fila evaluada contra el de quien
  consulta. Con el mismo reporte asignado a dos organizaciones, esa
  función daba `true` para las filas de **las dos**, no solo la propia —
  la Edge Function `emitir-acceso-reporte` (que confía en que RLS ya
  filtró y hace `select ... limit 1` sin `where organizacion_id = ...`) a
  veces devolvía la cláusula `rls` de la organización **ajena**, filtrando
  datos de Superset con el `organizacion_id` equivocado. `exists` contra
  `reportes_organizaciones_roles` con `p_organizacion_id = ro.organizacion_id`
  explícito en el `where` — la comparación que faltaba.

## RPCs (`public`, `security definer`, `search_path = ''`)

Ver contratos completos en `contracts/gestion-reportes.md`. Firma y quién
puede llamar cada una:

| RPC | Quién | Qué hace |
|---|---|---|
| `registrar_reporte(p_superset_dashboard_uuid text, p_nombre text, p_roles_default text[])` | superadmin | crea `reportes` + `reportes_roles_default`; rechaza `'administrador'` en el array |
| `establecer_roles_default_reporte(p_reporte_id uuid, p_roles_id text[])` | superadmin | reemplaza el default completo de un reporte (no afecta organizaciones ya asignadas — FR-004) |
| `asignar_reporte(p_reporte_id uuid, p_organizacion_id uuid)` | superadmin | inserta en `reportes_organizaciones` (`on conflict do nothing`, idempotente); dispara la herencia |
| `desasignar_reporte(p_reporte_id uuid, p_organizacion_id uuid)` | superadmin | borra de `reportes_organizaciones`; cascada limpia la visibilidad por rol de esa organización |
| `establecer_roles_reporte_organizacion(p_reporte_id uuid, p_organizacion_id uuid, p_roles_id text[])` | admin de esa organización (o superadmin con esa activa) | reemplaza el conjunto de roles visibles de esa organización para ese reporte; exige que la asignación ya exista |
| `resolver_organizacion_reporte(p_reporte_id uuid) returns uuid` | cualquier autenticado | agregada post-quickstart (contrato: `contracts/acceso-reporte.md`) — resuelve con qué `organizacion_id` `emitir-acceso-reporte` arma la cláusula `rls` del guest token; `null` si no hay acceso. Reemplaza un `select ... from reportes_organizaciones limit 1` que la Edge Function hacía antes, confiando en que RLS ya había filtrado a una sola fila — cierto para un miembro/administrador normal, pero no para un superadmin, que ve todas las filas de esa tabla sin importar cuál organización tiene activa (bug real, ver abajo) |
| `reportes_visibles_para_mi() returns table (id uuid, nombre text)` | cualquier autenticado | agregada post-quickstart, usada por `apps/web/src/hooks/useReportesAsignados.ts` (US2) — reportes visibles para quien consulta, en SU organización activa. A propósito no tiene el bypass de `is_superadmin()` que sí tiene la policy de `reportes` (ese bypass es para que `administrar.tsx`, US1, vea el catálogo completo) — un superadmin acá se trata igual que su administrador. Sin esto, el dropdown de Analítica ofrecía reportes que `resolver_organizacion_reporte` después rechazaba (bug real, ver abajo) |

## RLS

- `reportes`: `select` — `private.is_superadmin()` o
  `private.puede_ver_reporte(reportes.id)` (organización y rol de quien
  consulta habilitados, o el rol es `administrador`). Esto es lo que da a
  `administrador` su acceso incondicional (FR-006) sin necesitar una fila
  propia en ninguna tabla de roles.
- `reportes_roles_default`: `select` — solo `private.is_superadmin()`.
- `reportes_organizaciones`: `select` — `private.is_superadmin()` o
  `private.puede_ver_asignacion(reporte_id, organizacion_id)` — **no**
  `puede_ver_reporte()` (bug de aislamiento real corregido, ver arriba):
  esta tabla tiene una fila por organización asignada, así que la policy
  tiene que comparar el `organizacion_id` de cada fila contra el de quien
  consulta, no solo "mi organización tiene alguna fila para este
  reporte".
- `reportes_organizaciones_roles`: `select` — `private.is_superadmin()` o
  (`organizacion_id = private.organizacion_id()` y
  (`rol_id = private.rol_id()` o `private.rol_id() = 'administrador'`)).
  Esta tabla ya **no** es el mecanismo de autorización que usa la Edge
  Function — ese rol lo tiene ahora `reportes_organizaciones` (ver arriba,
  corrección post-quickstart); esta policy sigue existiendo para que la UI
  (`GrillaPermisosPorRol`, `administrar.tsx`, `permisos.tsx`) pueda leer qué
  roles están habilitados hoy.
- `eventos_reportes`: `select` — `private.is_superadmin()` o
  (`organizacion_id = private.organizacion_id()` y
  `private.puede_escribir()`).

Ninguna tabla tiene policy de `insert`/`update`/`delete` — el `grant` a
`authenticated` es solo `select`; toda escritura pasa por una RPC
`security definer`, que corre con los permisos de su dueño y no necesita
policy propia para escribir.

## Relaciones

```text
roles_organizacion ──< reportes_roles_default >── reportes
reportes ──< reportes_organizaciones >── organizaciones
reportes_organizaciones ──< reportes_organizaciones_roles >── roles_organizacion
reportes ──< eventos_reportes >── organizaciones (nullable)
auth.users (Supabase) ──< reportes (creado_por)
auth.users (Supabase) ──< reportes_organizaciones (asignado_por)
auth.users (Supabase) ──< eventos_reportes (actor_user_id)
```
