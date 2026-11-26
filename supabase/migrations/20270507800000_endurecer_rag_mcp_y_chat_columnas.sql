-- Lote 89 (MSF-867, bugs consolidados MSF-728, MSF-729 y MSF-730): lo que de la auditoría de funciones edge de IA exige base de datos.
--
-- A) MSF-728 · indexar-documento
--   1. `fragmentos_indexados` no tenía unicidad por `(version_id, orden)`: dos invocaciones concurrentes o un reintento podían dejar
--      fragmentos duplicados de la misma versión.
--      a) La política de escritura de `authenticated` solo exigía `organizacion_id = organización del usuario`: quien conociera el UUID
--         de una versión de OTRA organización podía insertar ahí un fragmento propio y, con el índice único, ocupar un `orden` de la
--         versión ajena. Se recrean las políticas INSERT y UPDATE (siguen exigiendo `private.puede_gestionar_documentos()`) para que
--         además la versión pertenezca a la organización del fragmento (versión -> documento -> organización).
--      b) `private.deduplicar_fragmentos_indexados()` primero borra TODO fragmento cuya organización no es la dueña de su versión
--         (la del documento) y recién después, entre los repetidos de la dueña (indistinguibles: mismo contenido), conserva el de
--         menor `id` (uuid aleatorio: criterio determinista, no cronológico) y borra el resto. Luego se crea el índice único.
--      c) `private.insertar_fragmentos_si_dueno` rechaza (22023) `orden` repetidos dentro de `p_filas` y, ante un conflicto
--         `(version_id, orden)` con una fila ya guardada, la ACTUALIZA con el contenido recibido (`do update`): el dueño con
--         el candado vigente es la fuente de verdad, así un reintento con las mismas filas es idempotente y una fila ajena o vieja
--         con otro contenido nunca se conserva en silencio (antes `do nothing` habría dejado la versión activa con un hueco).
--         Devuelve `true` si era dueña.
--      Aplicación en producción: el índice único (sin `concurrently`, dentro de la transacción de la migración) toma un lock SHARE sobre
--      `fragmentos_indexados` (bloquea INSERT/UPDATE/DELETE mientras se construye, con el índice HNSW del vector en la misma tabla) y la
--      deduplicación recorre la tabla entera. Aplicarla en una ventana sin indexaciones (la tabla crece ~1 fila por 1200 caracteres de
--      documento), medir antes `select count(*) from public.fragmentos_indexados`, y si la tabla es grande hacerlo en caliente
--      (ver `docs/funciones-edge-endurecimiento.md`, «Aplicar en producción»).
--   2. Versiones atascadas en `procesando`: `private.liberar_versiones_documento_atascadas(p_minutos int default 30)` marca `fallida`
--      (con un `motivo_error` claro) toda versión `procesando` con más de `p_minutos` minutos desde su subida (`subida_en`) cuyo
--      candado de indexación (`motivo_error = 'indexando:<instante_ms>:<id>'`, compare-and-swap de `indexar-documento`) no esté vigente
--      (se respeta el mismo vencimiento de 10 minutos que `reclamoVigente`: una invocación en curso no se pisa), y borra los
--      fragmentos huérfanos de esas versiones. Devuelve cuántas versiones marcó. NO está agendada (ni Kestra ni cron en este lote):
--      se invoca a mano o desde un flujo futuro con `select public.liberar_versiones_documento_atascadas(30);` usando service_role.
--      Solo `service_role` puede ejecutar la función pública; la privada no se otorga a nadie.
--
-- B) MSF-729 · servidor MCP
--   1. `fuentes_mcp` (PK `(feature_id, vista)`) y `acciones_mcp` (PK `(feature_id, rpc)`) permitían varias filas por funcionalidad,
--      pero `private.mcp_leer_fila` resuelve UNA vista por `feature_id` (`limit 1`, sin orden) y el candado de ejecución es por
--      `(credencial_id, feature_id)`. Se agrega unicidad por `feature_id` en ambas. Son tablas de seguridad: si ya hay una funcionalidad
--      con varias filas la migración ABORTA (`private.exigir_una_fila_por_funcionalidad_mcp()`, 23505) con un mensaje que nombra las
--      funcionalidades, para que un superadmin deje la fila correcta (no se borra ni se elige en silencio la más permisiva).
--      `fuentes_chat_ia` NO se toca: el chat resuelve la funcionalidad a partir de la vista, así que varias vistas por funcionalidad son válidas.
--   2. `private.iniciar_ejecucion_mcp` vence ahora, dentro de la misma transacción y antes de poner el candado, las ejecuciones
--      `en_curso` de esa credencial y funcionalidad con más de `private.ejecucion_mcp_vence_min()` minutos (10): pasan a `fallida` con
--      `motivo_error = 'vencida'`. Antes el vencimiento vivía solo en el servidor TypeScript. Misma firma, mismas ACL.
--      NO se crea el wrapper `ejecutar_accion_mcp` (no hay acciones registradas; queda como seguimiento).
--
-- C) MSF-730 · chat-ia-responder
--   `fuentes_chat_ia.columnas text[]` (nullable, aditiva): columnas que el chat puede pedir de la vista. NULL conserva el
--   comportamiento anterior (`select *`); si está definida, `handler.ts` consulta solo esas y solo admite filtros sobre ellas. CHECK: de 1 a 50
--   identificadores `[a-z0-9_]`, sin nulos, vacíos ni repetidos. ORDEN DE DESPLIEGUE: aplicar esta migración ANTES de desplegar
--   `chat-ia-responder` (el handler selecciona `columnas`; si la función sale primero, el chat responde `FUENTE_NO_DISPONIBLE`: falla cerrado).
--
-- Reaplicable: `create ... if not exists`, `create or replace`, el CHECK se agrega solo si falta.
--
-- Reversión (migración posterior; los pasos son reales y ordenados):
--   alter table public.fuentes_chat_ia drop constraint if exists fuentes_chat_ia_columnas_validas;
--   alter table public.fuentes_chat_ia drop column if exists columnas;
--   drop index if exists public.acciones_mcp_feature_unica_idx;
--   drop index if exists public.fuentes_mcp_feature_unica_idx;
--   drop index if exists public.fragmentos_indexados_version_orden_uidx;
--   drop function if exists public.liberar_versiones_documento_atascadas(int);
--   drop function if exists private.liberar_versiones_documento_atascadas(int);
--   drop function if exists private.exigir_una_fila_por_funcionalidad_mcp();
--   drop function if exists private.deduplicar_fragmentos_indexados();
--   y volver a las políticas `fragmentos_indexados_insert` / `fragmentos_indexados_update` de 20270507180400 (sin la comprobación de la versión),
--   a las definiciones de `private.insertar_fragmentos_si_dueno` (20270507260000) y `private.iniciar_ejecucion_mcp` (20261003231600)
--   con `create or replace function` copiando esos archivos, y borrar `private.ejecucion_mcp_vence_min()`. Los fragmentos que borró
--   la deduplicación (repetidos o de otra organización) no se pueden restaurar (se reindexan con `indexar-documento`).

-- ============================================================================
-- A1) Unicidad de fragmentos por (version_id, orden)
-- ============================================================================

create or replace function private.deduplicar_fragmentos_indexados()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ajenos bigint;
  v_repetidos bigint;
begin
  -- 1) Fuera todo fragmento cuya organización no es la dueña de su versión (la del documento): nunca compite con el legítimo.
  delete from public.fragmentos_indexados f
   using public.versiones_documento v, public.documentos d
   where v.id = f.version_id and d.id = v.documento_id and f.organizacion_id <> d.organizacion_id;
  get diagnostics v_ajenos = row_count;

  -- 2) De cada grupo (version_id, orden) que queda (todos de la organización dueña) se conserva el de menor id.
  with repetidos as (
    select id, row_number() over (partition by version_id, orden order by id) as posicion
      from public.fragmentos_indexados
     where (version_id, orden) in (
       select version_id, orden from public.fragmentos_indexados group by version_id, orden having count(*) > 1
     )
  )
  delete from public.fragmentos_indexados f
   using repetidos r
   where f.id = r.id and r.posicion > 1;
  get diagnostics v_repetidos = row_count;
  return v_ajenos + v_repetidos;
end;
$$;

comment on function private.deduplicar_fragmentos_indexados() is
  'Lote 89 (MSF-728): borra los fragmentos de otra organización que la dueña de su versión y, entre los repetidos por (version_id, orden), todos menos el de menor id; devuelve cuántos borró. La usa la migración antes de crear el índice único.';

revoke execute on function private.deduplicar_fragmentos_indexados() from public, anon, authenticated, service_role;

select private.deduplicar_fragmentos_indexados();

create unique index if not exists fragmentos_indexados_version_orden_uidx
  on public.fragmentos_indexados (version_id, orden);

-- La versión de un fragmento debe pertenecer a su organización (la FK sola no lo garantiza). Las subconsultas corren con el RLS de quien escribe.
drop policy if exists fragmentos_indexados_insert on public.fragmentos_indexados;
create policy fragmentos_indexados_insert on public.fragmentos_indexados
  for insert to authenticated
  with check (
    organizacion_id = (select private.organizacion_id())
    and (select private.puede_gestionar_documentos())
    and exists (
      select 1 from public.versiones_documento v join public.documentos d on d.id = v.documento_id
       where v.id = fragmentos_indexados.version_id and d.organizacion_id = fragmentos_indexados.organizacion_id
    )
  );

drop policy if exists fragmentos_indexados_update on public.fragmentos_indexados;
create policy fragmentos_indexados_update on public.fragmentos_indexados
  for update to authenticated
  using (organizacion_id = (select private.organizacion_id()) and (select private.puede_gestionar_documentos()))
  with check (
    organizacion_id = (select private.organizacion_id())
    and (select private.puede_gestionar_documentos())
    and exists (
      select 1 from public.versiones_documento v join public.documentos d on d.id = v.documento_id
       where v.id = fragmentos_indexados.version_id and d.organizacion_id = fragmentos_indexados.organizacion_id
    )
  );

create or replace function private.insertar_fragmentos_si_dueno(p_version_id uuid, p_organizacion_id uuid, p_reclamo text, p_filas jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_estado text;
  v_motivo text;
begin
  if p_filas is null or jsonb_typeof(p_filas) is distinct from 'array' then
    raise exception 'p_filas debe ser un arreglo' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_to_recordset(p_filas) as f(orden int))
     <> (select count(distinct f.orden) from jsonb_to_recordset(p_filas) as f(orden int)) then
    raise exception 'p_filas tiene valores de orden repetidos' using errcode = '22023';
  end if;
  select v.estado, v.motivo_error into v_estado, v_motivo
    from public.versiones_documento v
    join public.documentos d on d.id = v.documento_id
   where v.id = p_version_id and d.organizacion_id = p_organizacion_id
     for share of v;
  if not found or v_estado is distinct from 'procesando' or v_motivo is distinct from p_reclamo then
    return false;
  end if;
  -- El dueño con el reclamo vigente es la fuente de verdad: si `(version_id, orden)` ya existe (reintento, o una fila vieja o ajena con otro
  -- contenido) se actualiza con lo recibido, nunca se descarta en silencio. Con las mismas filas el efecto es idempotente.
  insert into public.fragmentos_indexados (version_id, organizacion_id, texto, embedding, orden)
  select p_version_id, p_organizacion_id, f.texto, f.embedding::public.vector, f.orden
    from jsonb_to_recordset(p_filas) as f(texto text, embedding text, orden int)
  on conflict (version_id, orden) do update
    set texto = excluded.texto, embedding = excluded.embedding, organizacion_id = excluded.organizacion_id;
  return true;
end;
$$;

-- ============================================================================
-- A2) Barrido de versiones atascadas en `procesando` (sin agendar)
-- ============================================================================

create or replace function private.liberar_versiones_documento_atascadas(p_minutos int default 30)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_ahora_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  -- Mismo vencimiento que `RECLAMO_VENCE_MS` de indexar-documento/reglas.ts (10 minutos).
  c_reclamo_vence_ms constant bigint := 10 * 60 * 1000;
begin
  if p_minutos is null or p_minutos < 1 then
    raise exception 'p_minutos debe ser un entero mayor o igual a 1' using errcode = '22023';
  end if;

  with atascadas as (
    select v.id
      from public.versiones_documento v
     where v.estado = 'procesando'
       and v.subida_en < clock_timestamp() - make_interval(mins => p_minutos)
       and not coalesce(
         v.motivo_error like 'indexando:%'
         and split_part(substr(v.motivo_error, length('indexando:') + 1), ':', 1) ~ '^[0-9]{1,15}$'
         and v_ahora_ms - split_part(substr(v.motivo_error, length('indexando:') + 1), ':', 1)::bigint < c_reclamo_vence_ms
         -- un instante en el futuro (reloj corrido) no protege: nunca vencería
         and split_part(substr(v.motivo_error, length('indexando:') + 1), ':', 1)::bigint <= v_ahora_ms + 60000,
         false
       )
       for update skip locked
  ),
  marcadas as (
    update public.versiones_documento v
       set estado = 'fallida',
           motivo_error = format('Se interrumpió el procesamiento: más de %s minutos sin completarse. Subí el archivo de nuevo.', p_minutos)
      from atascadas a
     where v.id = a.id and v.estado = 'procesando'
    returning v.id
  )
  select coalesce(array_agg(id), '{}'::uuid[]) into v_ids from marcadas;

  delete from public.fragmentos_indexados where version_id = any (v_ids);
  return coalesce(cardinality(v_ids), 0);
end;
$$;

comment on function private.liberar_versiones_documento_atascadas(int) is
  'Lote 89 (MSF-728): marca fallida (motivo_error claro) toda versión procesando de hace más de p_minutos (default 30) sin candado de indexación vigente (10 min) y borra sus fragmentos huérfanos; devuelve cuántas marcó. Sin agendar.';

create or replace function public.liberar_versiones_documento_atascadas(p_minutos int default 30)
returns int
language sql
security definer
set search_path = ''
as $$ select private.liberar_versiones_documento_atascadas(p_minutos) $$;

revoke execute on function private.liberar_versiones_documento_atascadas(int) from public, anon, authenticated, service_role;
revoke execute on function public.liberar_versiones_documento_atascadas(int) from public, anon, authenticated;
grant execute on function public.liberar_versiones_documento_atascadas(int) to service_role;

-- ============================================================================
-- B1) Una fila por funcionalidad en fuentes_mcp y acciones_mcp
-- ============================================================================

create or replace function private.exigir_una_fila_por_funcionalidad_mcp()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tabla text;
  v_lista text;
begin
  -- Tablas de seguridad: no se borra ni se elige una fila en silencio (la de menor nombre podría ser la más permisiva).
  select string_agg(feature_id, ', ' order by feature_id) into v_lista
    from (select feature_id from public.fuentes_mcp group by feature_id having count(*) > 1) t;
  if v_lista is not null then v_tabla := 'fuentes_mcp'; end if;
  if v_lista is null then
    select string_agg(feature_id, ', ' order by feature_id) into v_lista
      from (select feature_id from public.acciones_mcp group by feature_id having count(*) > 1) t;
    if v_lista is not null then v_tabla := 'acciones_mcp'; end if;
  end if;
  if v_lista is not null then
    raise exception '% tiene más de una fila por feature_id (%): dejá una sola por funcionalidad y reaplicá la migración', v_tabla, v_lista
      using errcode = '23505';
  end if;
end;
$$;

comment on function private.exigir_una_fila_por_funcionalidad_mcp() is
  'Lote 89 (MSF-729): aborta con 23505 si fuentes_mcp o acciones_mcp tienen más de una fila por feature_id. La corre la migración antes de crear los índices únicos.';

revoke execute on function private.exigir_una_fila_por_funcionalidad_mcp() from public, anon, authenticated, service_role;

select private.exigir_una_fila_por_funcionalidad_mcp();

create unique index if not exists fuentes_mcp_feature_unica_idx on public.fuentes_mcp (feature_id);
create unique index if not exists acciones_mcp_feature_unica_idx on public.acciones_mcp (feature_id);

-- ============================================================================
-- B2) Vencimiento de ejecuciones en_curso dentro de iniciar_ejecucion_mcp
-- ============================================================================

create or replace function private.ejecucion_mcp_vence_min()
returns int
language sql
immutable
set search_path = ''
as $$ select 10 $$;

comment on function private.ejecucion_mcp_vence_min() is
  'Minutos tras los cuales una ejecución MCP en_curso se considera abandonada (proceso reiniciado o finalizar_ejecucion_mcp fallido). Fuente única: la usa private.iniciar_ejecucion_mcp.';

revoke execute on function private.ejecucion_mcp_vence_min() from public, anon, authenticated, service_role;

create or replace function private.iniciar_ejecucion_mcp(p_credencial_id uuid, p_feature_id text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion_id uuid;
  v_ejecucion_id uuid;
begin
  select organizacion_id into v_organizacion_id
  from public.credenciales_mcp
  where id = p_credencial_id and revocada_en is null;

  if v_organizacion_id is null then
    raise exception 'Credencial inválida o revocada' using errcode = '42501';
  end if;

  if not private.puede_mcp_ejecutar_funcionalidad(p_feature_id, v_organizacion_id) then
    raise exception 'Funcionalidad no ejecutable para esta organización' using errcode = '42501';
  end if;

  -- Libera el candado de una ejecución abandonada (proceso reiniciado o finalización fallida): sin esto el índice único
  -- parcial bloquearía esa acción para la credencial para siempre. No depende del cliente.
  update public.ejecuciones_mcp
     set estado = 'fallida', motivo_error = 'vencida', finalizada_en = clock_timestamp()
   where credencial_id = p_credencial_id
     and feature_id = p_feature_id
     and estado = 'en_curso'
     and iniciada_en < clock_timestamp() - make_interval(mins => private.ejecucion_mcp_vence_min());

  -- El índice único parcial rechaza acá mismo (23505) una segunda ejecución
  -- concurrente de la misma acción con la misma credencial (FR-014).
  insert into public.ejecuciones_mcp (credencial_id, feature_id, estado)
  values (p_credencial_id, p_feature_id, 'en_curso')
  returning id into v_ejecucion_id;

  return v_ejecucion_id;
end;
$$;

-- ============================================================================
-- C) Columnas permitidas por vista en fuentes_chat_ia
-- ============================================================================

alter table public.fuentes_chat_ia add column if not exists columnas text[];

comment on column public.fuentes_chat_ia.columnas is
  'Columnas que el chat puede pedir de la vista (MSF-730). NULL = comportamiento anterior (select *); si está definida, chat-ia-responder consulta solo esas. Identificadores [a-z0-9_], de 1 a 50.';

-- Se recrea siempre (reaplicable y con la definición vigente).
alter table public.fuentes_chat_ia drop constraint if exists fuentes_chat_ia_columnas_validas;
alter table public.fuentes_chat_ia add constraint fuentes_chat_ia_columnas_validas check (
  columnas is null or (
    cardinality(columnas) between 1 and 50
    and array_position(columnas, null) is null
    and array_to_string(columnas, '|') ~ '^[a-z0-9_]+(\|[a-z0-9_]+)*$'
    and cardinality(string_to_array(array_to_string(columnas, '|'), '|')) = cardinality(columnas)
    -- sin repetidos (el handler también los rechaza): ningún identificador aparece dos veces
    and array_to_string(columnas, '|') !~ '(^|\|)([a-z0-9_]+)\|(.*\|)?\2(\||$)'
  )
);
