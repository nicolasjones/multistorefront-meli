-- MSF-293 (F-VTA-37, FR-005…FR-007): funciones que usa el worker `historial-importador` con su rol
-- `worker_<org>` (miembro de `workers_orquestacion`). El worker no recibe grants sobre las tablas
-- `dominio.historial_*`: escribe solo por `private.importar_historial_lote`, que valida la ejecución.
--
-- Esquemas (Principio VII): solo funciones en `private`; leen `public.ejecuciones_worker` (plataforma)
-- y escriben `dominio.historial_*` (dominio). Ninguna función es alcanzable por PostgREST.
--
-- Migración aditiva (solo funciones). Reversión (migración posterior):
--   drop function private.importar_historial_lote(uuid, text, jsonb);
--   drop function private.empresas_importacion_historial(uuid);
--   drop function private.datos_importacion_historial(uuid);
--   drop function private.autorizar_worker_importacion(uuid);

-- Autoriza al worker sobre su ejecución en curso y devuelve (organización, tipo, archivo).
create or replace function private.autorizar_worker_importacion(p_ejecucion_id uuid)
returns table (organizacion_id uuid, tipo text, archivo text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_e public.ejecuciones_worker;
  v_vigente boolean;
begin
  if session_user not like 'worker\_%'
     or not pg_catalog.pg_has_role(session_user, 'workers_orquestacion', 'member') then
    raise exception 'NO_AUTORIZADO: solo un worker accede a los datos de su importación' using errcode = 'P0001';
  end if;

  select * into v_e from public.ejecuciones_worker e where e.id = p_ejecucion_id;
  if not found then
    raise exception 'EJECUCION_DESCONOCIDA: %', p_ejecucion_id using errcode = 'P0001';
  end if;
  perform private.autorizar_llamante_ciclo(v_e.organizacion_id);

  select ev.en_curso into v_vigente from private.estado_ejecucion_vigente(p_ejecucion_id) ev;
  if not coalesce(v_vigente, false) then
    raise exception 'EJECUCION_NO_EN_CURSO: %', p_ejecucion_id using errcode = 'P0001';
  end if;
  if v_e.detalle->>'tipo' is null or v_e.detalle->>'archivo' is null then
    raise exception 'CONFIGURACION_INVALIDA: la ejecución % no trae tipo ni archivo', p_ejecucion_id using errcode = 'P0001';
  end if;

  return query select v_e.organizacion_id, v_e.detalle->>'tipo', v_e.detalle->>'archivo';
end;
$$;

revoke execute on function private.autorizar_worker_importacion(uuid) from public, anon, authenticated;

create or replace function private.datos_importacion_historial(p_ejecucion_id uuid)
returns table (organizacion_id uuid, tipo text, archivo text)
language sql
stable
security definer
set search_path = ''
as $$
  select * from private.autorizar_worker_importacion(p_ejecucion_id);
$$;

comment on function private.datos_importacion_historial(uuid) is
  'F-VTA-37: tipo y ruta del archivo de una ejecución de importación en curso. Solo workers de la organización dueña.';

revoke execute on function private.datos_importacion_historial(uuid) from public, anon, authenticated;
grant execute on function private.datos_importacion_historial(uuid) to workers_orquestacion;

-- Tiendas (empresas) de la organización: el worker valida que cada fila apunte a una existente.
create or replace function private.empresas_importacion_historial(p_ejecucion_id uuid)
returns table (id uuid, nombre text)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.nombre
  from private.autorizar_worker_importacion(p_ejecucion_id) a
  join dominio.empresas e on e.organizacion_id = a.organizacion_id;
$$;

revoke execute on function private.empresas_importacion_historial(uuid) from public, anon, authenticated;
grant execute on function private.empresas_importacion_historial(uuid) to workers_orquestacion;

-- Inserta un lote ya validado. Idempotente: `on conflict do nothing` sobre la clave natural.
-- Cada fila trae `tienda` (nombre de la empresa); no se crean empresas: una tienda inexistente
-- hace fallar el lote (la base es la autoridad, aunque el worker ya la haya validado).
create or replace function private.importar_historial_lote(p_ejecucion_id uuid, p_tipo text, p_filas jsonb)
returns table (nuevas integer, existentes integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a record;
  v_total integer;
  v_nuevas integer := 0;
begin
  select * into v_a from private.autorizar_worker_importacion(p_ejecucion_id);
  if v_a.tipo is distinct from p_tipo then
    raise exception 'TIPO_INVALIDO: el lote no coincide con el tipo de la ejecución' using errcode = 'P0001';
  end if;
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' then
    raise exception 'LOTE_INVALIDO: se esperaba un arreglo de filas' using errcode = '22023';
  end if;
  v_total := jsonb_array_length(p_filas);
  if v_total > 5000 then
    raise exception 'LOTE_INVALIDO: máximo 5000 filas por lote' using errcode = '22023';
  end if;

  if p_tipo in ('comprobantes', 'cobros') and exists (
    select 1 from jsonb_to_recordset(p_filas) as x(tienda text)
    where not exists (
      select 1 from dominio.empresas e
      where e.organizacion_id = v_a.organizacion_id and lower(btrim(e.nombre)) = lower(btrim(x.tienda))
    )
  ) then
    raise exception 'TIENDA_DESCONOCIDA: el lote tiene una tienda que no existe en la organización' using errcode = '22023';
  end if;

  if p_tipo = 'comprobantes' then
    with filas as (
      select x.*, (
        select e.id from dominio.empresas e
        where e.organizacion_id = v_a.organizacion_id and lower(btrim(e.nombre)) = lower(btrim(x.tienda))
        order by e.created_at limit 1
      ) as empresa_id
      from jsonb_to_recordset(p_filas) as x(
        tienda text, tipo text, numero text, fecha date, cliente_nombre text, cliente_numero text,
        operador text, estado_final text, total numeric)
    ), ins as (
      insert into dominio.historial_comprobantes
        (organizacion_id, empresa_id, tipo, numero, fecha, cliente_nombre, cliente_numero, operador, estado_final, total)
      select v_a.organizacion_id, f.empresa_id, coalesce(f.tipo, ''), f.numero, f.fecha, f.cliente_nombre,
             nullif(f.cliente_numero, ''), nullif(f.operador, ''), nullif(f.estado_final, ''), f.total
      from filas f
      on conflict (organizacion_id, empresa_id, tipo, numero) do nothing
      returning 1
    )
    select count(*) into v_nuevas from ins;
  elsif p_tipo = 'cobros' then
    with filas as (
      select x.*, (
        select e.id from dominio.empresas e
        where e.organizacion_id = v_a.organizacion_id and lower(btrim(e.nombre)) = lower(btrim(x.tienda))
        order by e.created_at limit 1
      ) as empresa_id
      from jsonb_to_recordset(p_filas) as x(
        tienda text, fecha date, comprobante_numero text, cliente_nombre text, cliente_numero text,
        cuenta_cobro text, aprobado_por text, importe numeric)
    ), ins as (
      insert into dominio.historial_cobros
        (organizacion_id, empresa_id, fecha, comprobante_numero, cliente_nombre, cliente_numero, cuenta_cobro, aprobado_por, importe)
      select v_a.organizacion_id, f.empresa_id, f.fecha, f.comprobante_numero, f.cliente_nombre,
             nullif(f.cliente_numero, ''), nullif(f.cuenta_cobro, ''), nullif(f.aprobado_por, ''), f.importe
      from filas f
      on conflict (organizacion_id, empresa_id, comprobante_numero, fecha, importe) do nothing
      returning 1
    )
    select count(*) into v_nuevas from ins;
  elsif p_tipo = 'cotizaciones' then
    with ins as (
      insert into dominio.historial_cotizaciones_dolar
        (organizacion_id, fecha, dolar_comprador, dolar_vendedor, cargado_por)
      select v_a.organizacion_id, x.fecha, x.dolar_comprador, x.dolar_vendedor, nullif(x.cargado_por, '')
      from jsonb_to_recordset(p_filas) as x(fecha date, dolar_comprador numeric, dolar_vendedor numeric, cargado_por text)
      on conflict (organizacion_id, fecha) do nothing
      returning 1
    )
    select count(*) into v_nuevas from ins;
  else
    raise exception 'TIPO_INVALIDO: %', p_tipo using errcode = '22023';
  end if;

  return query select v_nuevas, v_total - v_nuevas;
end;
$$;

comment on function private.importar_historial_lote(uuid, text, jsonb) is
  'F-VTA-37 (FR-007): inserta un lote validado en dominio.historial_* con on conflict do nothing y devuelve nuevas/existentes. Solo el worker de la ejecución en curso; única vía de escritura del historial.';

revoke execute on function private.importar_historial_lote(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function private.importar_historial_lote(uuid, text, jsonb) to workers_orquestacion;
