# Data Model: Backups automáticos de la base de datos

La tabla vive en `public`, con RLS activado (Principio I). A diferencia
del resto de las specs del repo, sus mutaciones no las hace un
`authenticated` de Supabase Auth vía RPC estándar — las hace Kestra con un
rol de Postgres dedicado (`kestra_backups`, ver research.md R1/R2). Solo
la lectura (historial, FR-007) pasa por el camino habitual de RLS +
`private.is_superadmin()`.

La migración abre con un comentario de reversión: reversión = `drop
function` de las 3 funciones (en orden inverso a su creación), `drop role
kestra_backups`, `drop table respaldos` — sin dependencias de ninguna otra
spec, nada más que revertir.

## `respaldos`

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `bigint` | PK, `generated always as identity` |
| `origen` | `text` | `not null`, `check (origen in ('programado', 'manual'))` |
| `estado` | `text` | `not null default 'en_progreso'`, `check (estado in ('en_progreso', 'completado', 'error'))` |
| `iniciado_en` | `timestamptz` | `not null default clock_timestamp()` |
| `finalizado_en` | `timestamptz` | nullable — vacío mientras `en_progreso` |
| `tamano_bytes` | `bigint` | nullable — solo si `completado` |
| `ubicacion` | `text` | nullable — solo si `completado`; ruta/clave dentro del storage interno de Kestra |
| `motivo_error` | `text` | nullable — solo si `error` |

Constraint de consistencia entre `estado` y el resto de los campos
(evita un `completado` sin archivo, o un `error` sin motivo):

```sql
constraint respaldos_estado_consistente check (
  (estado = 'en_progreso' and finalizado_en is null
    and tamano_bytes is null and ubicacion is null and motivo_error is null)
  or (estado = 'completado' and finalizado_en is not null
    and tamano_bytes is not null and ubicacion is not null and motivo_error is null)
  or (estado = 'error' and finalizado_en is not null and motivo_error is not null)
)
```

No se guarda "quién" disparó un backup manual como FK a `auth.users`:
Kestra ya audita internamente su propio historial de ejecuciones (quién
inició sesión y disparó el flow), y la spec solo pide distinguir el
*origen* (programado/manual, FR-004), no la identidad puntual — evita
inventar un puente de identidad entre la sesión de Kestra y
`auth.users` que la spec nunca pidió.

Índice único que impide dos backups simultáneos (FR-003), como respaldo a
nivel de base de datos del chequeo que ya hace `iniciar_respaldo`:

```sql
create unique index respaldos_un_solo_en_progreso
  on respaldos (estado)
  where estado = 'en_progreso';
```

## Rol `kestra_backups`

```sql
create role kestra_backups with login password 'reemplazar-por-entorno';
```

Sin ningún otro privilegio por defecto (ni `SELECT` directo sobre
`respaldos` ni sobre ninguna otra tabla) — únicamente lo que las
`grant execute` de abajo le otorguen. La contraseña real se rota por
entorno vía `alter role` (research.md R8, `KESTRA_BACKUPS_DB_PASSWORD` en
`.env.example`), nunca queda en la migración.

## Funciones (`public`, `security definer`, `search_path = ''`)

### `iniciar_respaldo(p_origen text) returns respaldos`

```sql
create or replace function public.iniciar_respaldo(p_origen text)
returns public.respaldos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_respaldo public.respaldos;
begin
  if p_origen not in ('programado', 'manual') then
    raise exception 'Origen de respaldo inválido: %', p_origen using errcode = '22023';
  end if;

  -- Auto-sanar una fila colgada por una caída real del proceso (research.md R5)
  -- antes de intentar arrancar un backup nuevo.
  update public.respaldos
    set estado = 'error',
        finalizado_en = clock_timestamp(),
        motivo_error = 'Backup interrumpido: quedó en progreso más de 3 horas sin resolverse (probable caída del proceso que lo ejecutaba).'
    where estado = 'en_progreso'
      and iniciado_en < clock_timestamp() - interval '3 hours';

  begin
    insert into public.respaldos (origen, estado, iniciado_en)
    values (p_origen, 'en_progreso', clock_timestamp())
    returning * into v_respaldo;
  exception
    when unique_violation then
      raise exception 'Ya hay un respaldo en progreso' using errcode = '55006';
  end;

  return v_respaldo;
end;
$$;

revoke execute on function public.iniciar_respaldo(text) from public, authenticated, anon;
grant execute on function public.iniciar_respaldo(text) to kestra_backups;
```

**Contrato**: llamada como primer paso de todo flow de backup (programado
o manual). Devuelve la fila recién creada — el resto del flow usa su `id`.
Si ya hay un backup en progreso (no vencido), corta con error explícito
(FR-003) y el flow debe terminar ahí, sin ejecutar `pg_dump`.

### `finalizar_respaldo_completado(p_id bigint, p_tamano_bytes bigint, p_ubicacion text) returns void`

```sql
create or replace function public.finalizar_respaldo_completado(
  p_id bigint,
  p_tamano_bytes bigint,
  p_ubicacion text
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.respaldos
  set estado = 'completado',
      finalizado_en = clock_timestamp(),
      tamano_bytes = p_tamano_bytes,
      ubicacion = p_ubicacion
  where id = p_id and estado = 'en_progreso';
$$;

revoke execute on function public.finalizar_respaldo_completado(bigint, bigint, text) from public, authenticated, anon;
grant execute on function public.finalizar_respaldo_completado(bigint, bigint, text) to kestra_backups;
```

### `finalizar_respaldo_error(p_id bigint, p_motivo text) returns void`

```sql
create or replace function public.finalizar_respaldo_error(p_id bigint, p_motivo text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.respaldos
  set estado = 'error',
      finalizado_en = clock_timestamp(),
      motivo_error = p_motivo
  where id = p_id and estado = 'en_progreso';
$$;

revoke execute on function public.finalizar_respaldo_error(bigint, text) from public, authenticated, anon;
grant execute on function public.finalizar_respaldo_error(bigint, text) to kestra_backups;
```

Llamada desde el bloque `errors:` del flow de Kestra (FR-006, FR-008) —
cualquier falla en cualquier paso del flow (exportar, verificar) termina
acá, nunca deja la fila en `en_progreso`.

## RLS

```sql
alter table respaldos enable row level security;

create policy respaldos_select on respaldos
  for select to authenticated
  using ((select private.is_superadmin()));
```

Sin policy de `insert`/`update`/`delete` para `authenticated` ni `anon` —
las únicas mutaciones posibles son las 3 funciones de arriba, y solo
`kestra_backups` puede ejecutarlas (FR-011). Ningún rol de organización
puede ver esta tabla, ni siquiera indirectamente — la policy de `select`
exige superadmin sin excepción.
