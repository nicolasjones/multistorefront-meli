-- F-MIG-03 (MSF-330, épica MSF-142): archivo consultable del historial de ingresos de mercadería.
-- Spec: specs/20261023-120000-migracion-inicial-de-datos/ (FR-030…FR-034).
--
-- Esquemas (Principio VII), verificados tabla por tabla:
--   dominio.archivo_ingresos_mercaderia  dominio  (nueva)  historial del negocio (ingresos de
--       mercadería anteriores al sistema), no plataforma. Solo lectura para `authenticated`.
--   public.migracion_cargas / public.migracion_filas: existentes (F-MIG-01); la entidad
--       'ingresos_archivo' ya está permitida en su check. Sin cambios de esquema.
--
-- FR-032: el archivo NO toca stock ni movimientos y no se mezcla con dominio.ingresos_mercaderia:
-- sin FK a productos/proveedores/depósitos (producto, proveedor y operador son texto del panel
-- anterior) y las RPC solo escriben esta tabla y las filas de la carga.
--
-- RLS: `select` por organización para quien ve la sección Stock; SIN insert/update/delete para
-- `authenticated` ni acceso para `anon`. Escribe únicamente la RPC `aplicar_lote_archivo_ingresos`
-- (security definer, solo Administrador). `set search_path = ''`, `revoke ... from public, anon`,
-- `grant execute ... to authenticated`.
--
-- Migración aditiva. Reversión (en una migración posterior; exportar antes los datos):
--   drop function public.previsualizar_lote_archivo_ingresos(jsonb);
--   drop function public.aplicar_lote_archivo_ingresos(uuid, integer, jsonb);
--   drop function private.clasificar_fila_archivo_ingreso(uuid, jsonb);
--   drop function private.validar_fila_archivo_ingreso(jsonb);
--   drop function private.fecha_archivo_ingreso(text);
--   drop table dominio.archivo_ingresos_mercaderia;

-- ============================================================================
-- dominio.archivo_ingresos_mercaderia
-- ============================================================================

create table if not exists dominio.archivo_ingresos_mercaderia (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null default private.organizacion_id()
    references public.organizaciones (id) on delete cascade,
  id_externo text not null check (btrim(id_externo) <> '' and char_length(id_externo) <= 200),
  fecha date not null,
  producto text not null check (btrim(producto) <> '' and char_length(producto) <= 200),
  cantidad integer not null check (cantidad > 0),
  proveedor text check (proveedor is null or char_length(proveedor) <= 200),
  operador text check (operador is null or char_length(operador) <= 200),
  carga_id uuid references public.migracion_cargas (id) on delete set null,
  creado_en timestamptz not null default now(),
  constraint archivo_ingresos_org_id_externo_uq unique (organizacion_id, id_externo)
);

comment on table dominio.archivo_ingresos_mercaderia is
  'F-MIG-03: historial de ingresos de mercadería anterior al sistema. Solo consulta: se carga por RPC del asistente de migración y no mueve stock ni se mezcla con dominio.ingresos_mercaderia.';
comment on column dominio.archivo_ingresos_mercaderia.operador is
  'Operador histórico como texto (~19, no son usuarios del sistema).';

create index if not exists archivo_ingresos_org_fecha_idx
  on dominio.archivo_ingresos_mercaderia (organizacion_id, fecha desc, id);
create index if not exists archivo_ingresos_carga_idx
  on dominio.archivo_ingresos_mercaderia (carga_id) where carga_id is not null;

alter table dominio.archivo_ingresos_mercaderia enable row level security;

drop policy if exists archivo_ingresos_select on dominio.archivo_ingresos_mercaderia;
create policy archivo_ingresos_select on dominio.archivo_ingresos_mercaderia
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('stock')) in ('lectura', 'edicion')
  );

-- auto_expose_new_tables = false: grants explícitos. Solo lectura.
grant usage on schema dominio to authenticated;
revoke all on dominio.archivo_ingresos_mercaderia from public, anon, authenticated;
grant select on dominio.archivo_ingresos_mercaderia to authenticated;

-- ============================================================================
-- Fecha del archivo: ISO (2026-03-15) o día/mes/año (15/03/2026). null si no es válida.
-- ============================================================================

create or replace function private.fecha_archivo_ingreso(p_texto text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_texto text := btrim(coalesce(p_texto, ''));
  v_anio integer;
  v_mes integer;
  v_dia integer;
  v_fecha date;
begin
  if v_texto ~ '^\d{4}-\d{1,2}-\d{1,2}$' then
    v_anio := split_part(v_texto, '-', 1)::integer;
    v_mes := split_part(v_texto, '-', 2)::integer;
    v_dia := split_part(v_texto, '-', 3)::integer;
  elsif v_texto ~ '^\d{1,2}/\d{1,2}/\d{4}$' then
    v_dia := split_part(v_texto, '/', 1)::integer;
    v_mes := split_part(v_texto, '/', 2)::integer;
    v_anio := split_part(v_texto, '/', 3)::integer;
  else
    return null;
  end if;
  if v_anio < 1900 or v_mes not between 1 and 12 or v_dia not between 1 and 31 then
    return null;
  end if;
  -- make_date acepta 31 de febrero con desborde en algunas versiones: se compara de vuelta.
  v_fecha := make_date(v_anio, v_mes, 1) + (v_dia - 1);
  if extract(month from v_fecha)::integer <> v_mes then
    return null;
  end if;
  return v_fecha;
exception when others then
  return null;
end;
$$;

revoke execute on function private.fecha_archivo_ingreso(text) from public, anon, authenticated;

-- ============================================================================
-- Validación de una fila: motivo en castellano o null si es válida.
-- ============================================================================

create or replace function private.validar_fila_archivo_ingreso(p_fila jsonb)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_cantidad text := btrim(coalesce(p_fila ->> 'cantidad', ''));
begin
  if nullif(btrim(p_fila ->> 'id_externo'), '') is null then
    return 'Falta el identificador del panel actual';
  end if;
  if char_length(btrim(p_fila ->> 'id_externo')) > 200 then
    return 'El identificador del panel actual supera 200 caracteres';
  end if;
  if private.fecha_archivo_ingreso(p_fila ->> 'fecha') is null then
    return 'La fecha no es válida (usá AAAA-MM-DD o DD/MM/AAAA)';
  end if;
  if nullif(btrim(p_fila ->> 'producto'), '') is null then
    return 'Falta el producto';
  end if;
  if char_length(btrim(p_fila ->> 'producto')) > 200 then
    return 'El producto supera 200 caracteres';
  end if;
  if v_cantidad !~ '^\d{1,7}$' or v_cantidad::integer < 1 or v_cantidad::integer > 1000000 then
    return 'La cantidad debe ser un entero entre 1 y 1000000';
  end if;
  if char_length(btrim(coalesce(p_fila ->> 'proveedor', ''))) > 200 then
    return 'El proveedor supera 200 caracteres';
  end if;
  if char_length(btrim(coalesce(p_fila ->> 'operador', ''))) > 200 then
    return 'El operador supera 200 caracteres';
  end if;
  return null;
end;
$$;

revoke execute on function private.validar_fila_archivo_ingreso(jsonb) from public, anon, authenticated;

-- ============================================================================
-- Clasificación: nueva / actualizada / error. Conciliación por id_externo dentro
-- de la organización. Solo lee: la usan la vista previa y el aplicado.
-- ============================================================================

create or replace function private.clasificar_fila_archivo_ingreso(
  p_org uuid,
  p_fila jsonb,
  out o_estado text,
  out o_motivo text
)
language plpgsql
stable
set search_path = ''
as $$
begin
  o_motivo := private.validar_fila_archivo_ingreso(p_fila);
  if o_motivo is not null then
    o_estado := 'error';
    return;
  end if;
  o_estado := case
    when exists (
      select 1 from dominio.archivo_ingresos_mercaderia a
       where a.organizacion_id = p_org and a.id_externo = btrim(p_fila ->> 'id_externo')
    ) then 'actualizada'
    else 'nueva'
  end;
end;
$$;

revoke execute on function private.clasificar_fila_archivo_ingreso(uuid, jsonb) from public, anon, authenticated;

-- ============================================================================
-- RPC · previsualizar_lote_archivo_ingresos (solo lee)
-- ============================================================================

create or replace function public.previsualizar_lote_archivo_ingresos(p_filas jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
begin
  if v_org is null or not (select private.puede_escribir()) then
    raise exception 'Solo un administrador puede migrar datos' using errcode = '42501';
  end if;
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' then
    raise exception 'Las filas deben ser una lista' using errcode = '22023';
  end if;
  if jsonb_array_length(p_filas) > 500 then
    raise exception 'Un lote admite hasta 500 filas' using errcode = '54000';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_filas) as e (value)
     where jsonb_typeof(e.value -> 'fila') is distinct from 'number'
        or (e.value ->> 'fila') !~ '^\d{1,9}$'
  ) then
    raise exception 'Cada fila debe traer su número de fila (entero positivo)' using errcode = '22023';
  end if;

  return coalesce((
    select jsonb_agg(
             jsonb_build_object('fila', (f.value ->> 'fila')::integer, 'estado', k.o_estado, 'motivo', k.o_motivo)
             order by f.ordinality
           )
      from jsonb_array_elements(p_filas) with ordinality as f (value, ordinality)
      cross join lateral private.clasificar_fila_archivo_ingreso(v_org, f.value) as k
  ), '[]'::jsonb);
end;
$$;

comment on function public.previsualizar_lote_archivo_ingresos(jsonb) is
  'F-MIG-03: clasifica filas del archivo de ingresos (nueva / actualizada / error + motivo) sin escribir. Solo Administrador; hasta 500 filas.';

revoke execute on function public.previsualizar_lote_archivo_ingresos(jsonb) from public, anon;
grant execute on function public.previsualizar_lote_archivo_ingresos(jsonb) to authenticated;

-- ============================================================================
-- RPC · aplicar_lote_archivo_ingresos
-- Atómico por lote; errores de datos de una fila se registran y siguen las demás.
-- Idempotente por (carga, fila) y por id_externo (upsert). Solo escribe la tabla del
-- archivo y migracion_filas: no toca stock, movimientos ni ingresos vivos (FR-032).
-- ============================================================================

create or replace function public.aplicar_lote_archivo_ingresos(
  p_carga uuid,
  p_lote integer,
  p_filas jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_carga public.migracion_cargas;
  v_fila jsonb;
  v_num integer;
  v_ext text;
  v_estado text;
  v_motivo text;
  v_resultado text;
  v_nuevos integer := 0;
  v_actualizados integer := 0;
  v_omitidos integer := 0;
  v_errores jsonb := '[]'::jsonb;
begin
  if v_org is null or not (select private.puede_escribir()) then
    raise exception 'Solo un administrador puede migrar datos' using errcode = '42501';
  end if;
  if p_lote is null or p_lote < 0 then
    raise exception 'El número de lote no es válido' using errcode = '22023';
  end if;
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' then
    raise exception 'Las filas deben ser una lista' using errcode = '22023';
  end if;
  if jsonb_array_length(p_filas) > 500 then
    raise exception 'Un lote admite hasta 500 filas' using errcode = '54000';
  end if;

  select * into v_carga
    from public.migracion_cargas c
   where c.id = p_carga and c.organizacion_id = v_org
     for update;
  if not found then
    raise exception 'La carga no existe en tu organización' using errcode = 'P0002';
  end if;
  if v_carga.entidad <> 'ingresos_archivo' then
    raise exception 'La carga no es del archivo de ingresos' using errcode = '22023';
  end if;

  for v_fila in select e.value from jsonb_array_elements(p_filas) as e (value) loop
    if jsonb_typeof(v_fila -> 'fila') is distinct from 'number' or (v_fila ->> 'fila') !~ '^\d{1,9}$' then
      raise exception 'Cada fila debe traer su número de fila (entero positivo)' using errcode = '22023';
    end if;
    v_num := (v_fila ->> 'fila')::integer;
    v_ext := nullif(btrim(v_fila ->> 'id_externo'), '');
    v_resultado := null;
    v_motivo := null;

    if exists (
      select 1 from public.migracion_filas f
       where f.carga_id = p_carga and f.fila = v_num and f.estado in ('nueva', 'actualizada')
    ) then
      v_omitidos := v_omitidos + 1;
      continue;
    end if;

    select k.o_estado, k.o_motivo into v_estado, v_motivo
      from private.clasificar_fila_archivo_ingreso(v_org, v_fila) as k;

    -- Mismo identificador dos veces en el archivo: gana la primera fila aplicada (FR-004).
    if v_estado <> 'error' and v_ext is not null and exists (
      select 1 from public.migracion_filas f
       where f.carga_id = p_carga and f.fila < v_num
         and f.identificador_externo = left(v_ext, 200)
         and f.estado in ('nueva', 'actualizada')
    ) then
      v_estado := 'error';
      v_motivo := 'El identificador está repetido en el archivo';
    end if;

    if v_estado <> 'error' then
      insert into dominio.archivo_ingresos_mercaderia (
        organizacion_id, id_externo, fecha, producto, cantidad, proveedor, operador, carga_id
      ) values (
        v_org, v_ext, private.fecha_archivo_ingreso(v_fila ->> 'fecha'), btrim(v_fila ->> 'producto'),
        (btrim(v_fila ->> 'cantidad'))::integer, nullif(btrim(v_fila ->> 'proveedor'), ''),
        nullif(btrim(v_fila ->> 'operador'), ''), p_carga
      )
      on conflict (organizacion_id, id_externo) do update
        set fecha = excluded.fecha,
            producto = excluded.producto,
            cantidad = excluded.cantidad,
            proveedor = coalesce(excluded.proveedor, dominio.archivo_ingresos_mercaderia.proveedor),
            operador = coalesce(excluded.operador, dominio.archivo_ingresos_mercaderia.operador),
            carga_id = excluded.carga_id;
      v_resultado := v_estado;
    end if;

    if v_resultado = 'nueva' then
      v_nuevos := v_nuevos + 1;
    elsif v_resultado = 'actualizada' then
      v_actualizados := v_actualizados + 1;
    else
      v_errores := v_errores || jsonb_build_object('fila', v_num, 'motivo', v_motivo);
    end if;

    insert into public.migracion_filas (carga_id, lote, fila, estado, identificador_externo, motivo)
    values (p_carga, p_lote, v_num, coalesce(v_resultado, 'error'), left(v_ext, 200), left(v_motivo, 300))
    on conflict (carga_id, fila) do update
      set lote = excluded.lote,
          estado = excluded.estado,
          identificador_externo = excluded.identificador_externo,
          motivo = excluded.motivo;
  end loop;

  return jsonb_build_object(
    'nuevos', v_nuevos,
    'actualizados', v_actualizados,
    'omitidos', v_omitidos,
    'errores', v_errores
  );
end;
$$;

comment on function public.aplicar_lote_archivo_ingresos(uuid, integer, jsonb) is
  'F-MIG-03: aplica un lote (hasta 500 filas) al archivo de ingresos de mercadería. Upsert por id_externo dentro de la organización; atómico por lote e idempotente por (carga, fila). No toca stock ni ingresos vivos. Solo Administrador.';

revoke execute on function public.aplicar_lote_archivo_ingresos(uuid, integer, jsonb) from public, anon;
grant execute on function public.aplicar_lote_archivo_ingresos(uuid, integer, jsonb) to authenticated;
