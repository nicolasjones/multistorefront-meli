# Data Model: Mapeo de identificadores externos de clientes

Tabla nueva en el esquema `public` (plataforma) — mecanismo del template,
sin lógica de negocio de ningún producto derivado ni de ningún sistema
externo puntual (ver `plan.md`, Structure Decision).

## Entidad: `clientes_identificadores_externos`

Vínculo entre una fila de `clientes` y su identidad en un sistema externo
(Key Entities de `spec.md`).

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` |
| `cliente_id` | `uuid` | `not null`, FK a `clientes(id) on delete cascade` (FR-010, SC-004) |
| `sistema` | `text` | `not null`, texto libre (Decisión 3 de `research.md`); `check (btrim(sistema) <> '')` (FR-011) |
| `identificador_externo` | `text` | `not null`; `check (btrim(identificador_externo) <> '')` (FR-011) |
| `created_at` | `timestamptz` | `not null default now()` — auditoría (Principio III) |

**Sin columna `organizacion_id` propia** — se resuelve siempre vía
`cliente_id → clientes.organizacion_id` (Decisión 2 de `research.md`).

### Restricciones

- `unique (sistema, identificador_externo)` — invariante central (FR-002,
  SC-002): un identificador de un sistema no puede pertenecer a más de un
  cliente. Al ser una constraint de base (no solo una validación de
  aplicación), Postgres la hace cumplir incluso bajo inserciones
  concurrentes.
- `check (btrim(sistema) <> '' and btrim(identificador_externo) <> '')`
  (FR-011).
- Índice `clientes_identificadores_externos_cliente_id_idx` sobre
  `cliente_id` — resuelve FR-005 (listar los identificadores de un
  cliente) sin depender del índice implícito del `unique`, que está
  ordenado por `(sistema, identificador_externo)` y no sirve para ese
  acceso.

El `unique (sistema, identificador_externo)` ya cubre el acceso de FR-006
(resolver el cliente a partir de sistema + identificador) sin necesidad de
un índice adicional.

## RLS

- **Lectura**: `select` para `authenticated`, acotada a quien puede ver el
  cliente dueño del vínculo — mismo criterio que el resto de tablas de
  negocio de esta plataforma:

  ```sql
  using (
    exists (
      select 1 from public.clientes c
      where c.id = clientes_identificadores_externos.cliente_id
        and c.organizacion_id = private.organizacion_id()
    )
  )
  ```

  (FR-008, SC-003). Un superadmin ve los vínculos de la organización que
  tiene activa, igual que ve `clientes` (`private.organizacion_id()` ya
  resuelve ese caso, ver `20260908172920_fundacion_multitenant.sql`).

- **Sin policies de `insert`/`update`/`delete` con `grant` a
  `authenticated`** (Decisión 1 de `research.md`): toda escritura pasa por
  las funciones `SECURITY DEFINER` de abajo. Se definen policies de
  `insert`/`delete` igual, como cinturón de seguridad (mismo patrón que
  `conexiones`), pero sin otorgar el `grant` de tabla correspondiente a
  `authenticated` — solo lectura tiene `grant` directo.

## Funciones (`SECURITY DEFINER`, `set search_path = ''`)

### `public.vincular_identificador_externo(p_cliente_id uuid, p_sistema text, p_identificador_externo text) returns public.clientes_identificadores_externos`

- Resuelve `v_organizacion_id` desde `clientes` por `p_cliente_id`; si no
  existe el cliente, `raise exception ... using errcode = 'P0002'`.
- Verifica `private.es_administrador_de(v_organizacion_id)`; si no, `raise
  exception ... using errcode = '42501'`.
- `insert ... on conflict (sistema, identificador_externo) do nothing`, y si
  la fila resultante (nueva o preexistente) no pertenece a `p_cliente_id`,
  `raise exception` con errcode `23505` y mensaje explícito (FR-010) — así
  la re-vinculación al mismo cliente es no-op (FR-004) y la vinculación a
  otro cliente falla sin modificar el vínculo original.
- `grant execute` a `authenticated`; `revoke` de `public`.

### `public.desvincular_identificador_externo(p_id uuid) returns void`

- Resuelve `v_organizacion_id` desde `clientes_identificadores_externos`
  join `clientes` por `p_id`; si no existe, no-op silencioso (eliminar algo
  que ya no existe no es un error — coherente con FR-007, "libera el
  identificador").
- Verifica `private.es_administrador_de(v_organizacion_id)`; si no, `raise
  exception ... using errcode = '42501'`.
- `delete from public.clientes_identificadores_externos where id =
  p_id`.
- `grant execute` a `authenticated`; `revoke` de `public`.

## Reversión

Migración aditiva — no destruye nada existente (Principio, constitución,
`spec.md`). Camino de reversión si esta spec se revierte completa:

```sql
drop function if exists public.desvincular_identificador_externo(uuid);
drop function if exists public.vincular_identificador_externo(uuid, text, text);
drop table if exists public.clientes_identificadores_externos;
```

No aplica a ninguna tabla ni columna preexistente — no hay camino de
reversión parcial que preservar.
