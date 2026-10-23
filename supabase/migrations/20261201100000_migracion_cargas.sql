-- F-MIG-01 (MSF-299, épica MSF-142): importador de clientes desde el panel actual.
-- Spec: specs/20261023-120000-migracion-inicial-de-datos/ (FR-005…FR-009, FR-011).
--
-- Esquemas (Principio VII), verificados tabla por tabla:
--   public.migracion_cargas  public  (nueva)  herramienta de plataforma transversal: lote de
--                                             importación (entidad, archivo, actor, estado, contadores).
--   public.migracion_filas   public  (nueva)  resultado por fila del lote; misma naturaleza.
--   public.clientes y public.clientes_identificadores_externos: existentes (MSF-180), sin cambios de
--   esquema; solo las escribe la RPC `aplicar_lote_clientes`.
--
-- RLS: lectura solo para el Administrador de la organización (private.puede_escribir()); sin grants de
-- escritura para `authenticated` (toda escritura pasa por las RPC security definer) y sin acceso para
-- `anon`. Las RPC fijan `set search_path = ''`, hacen `revoke ... from public, anon` y
-- `grant execute ... to authenticated`.
--
-- `clientes_identificadores_externos.sistema` es texto libre (sin FK a `sistemas_externos`): el
-- sistema 'panel_actual' NO requiere fila en el catálogo. La unicidad (sistema, identificador_externo)
-- es global, no por organización: si otra organización ya usa ese identificador, la fila se rechaza con
-- un motivo genérico (no se revela de quién es).
--
-- Migración aditiva (tablas y funciones nuevas; no toca nada existente).
-- Reversión (en una migración posterior, no en este PR):
--   drop function public.previsualizar_lote_clientes(jsonb);
--   drop function public.aplicar_lote_clientes(uuid, integer, jsonb);
--   drop function public.cerrar_carga_migracion(uuid);
--   drop function public.iniciar_carga_migracion(text, text, integer);
--   drop function private.clasificar_fila_cliente(uuid, jsonb);
--   drop function private.validar_fila_cliente_migracion(jsonb);
--   drop table public.migracion_filas, public.migracion_cargas;
-- Los clientes ya cargados NO se borran con la reversión: se revierten con el listado de la carga
-- (`migracion_filas`, estado 'nueva') antes de borrar las tablas.

-- ============================================================================
-- Tablas
-- ============================================================================

create table if not exists public.migracion_cargas (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  entidad text not null
    check (entidad in ('clientes', 'proveedores', 'vinculos_proveedor_producto', 'ingresos_archivo')),
  archivo text not null check (btrim(archivo) <> '' and char_length(archivo) <= 200),
  filas_total integer not null check (filas_total >= 0),
  estado text not null default 'en_curso' check (estado in ('en_curso', 'aplicada', 'fallida')),
  nuevos integer not null default 0,
  actualizados integer not null default 0,
  con_error integer not null default 0,
  error text,
  actor_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  cerrada_en timestamptz
);

comment on table public.migracion_cargas is
  'F-MIG-01: una ejecución de importación de datos (entidad, archivo, actor, estado y contadores). Solo la escriben las RPC de migración; la lee el Administrador de la organización.';

create index if not exists migracion_cargas_org_creada_idx on public.migracion_cargas (organizacion_id, created_at desc);
create index if not exists migracion_cargas_actor_idx on public.migracion_cargas (actor_id) where actor_id is not null;

create table if not exists public.migracion_filas (
  id uuid primary key default gen_random_uuid(),
  carga_id uuid not null references public.migracion_cargas (id) on delete cascade,
  lote integer not null,
  fila integer not null check (fila > 0),
  estado text not null check (estado in ('nueva', 'actualizada', 'error')),
  identificador_externo text,
  motivo text,
  created_at timestamptz not null default now(),
  constraint migracion_filas_carga_fila_key unique (carga_id, fila)
);

comment on table public.migracion_filas is
  'F-MIG-01: resultado por fila de una carga. `fila` es el número de fila del archivo contando el encabezado como fila 1. Es la base de la idempotencia: una fila ya aplicada en la carga se omite al reintentar.';

create index if not exists migracion_filas_identificador_idx
  on public.migracion_filas (carga_id, identificador_externo)
  where identificador_externo is not null;

-- ============================================================================
-- RLS: lectura solo del Administrador de la organización; sin escritura directa
-- ============================================================================

alter table public.migracion_cargas enable row level security;
alter table public.migracion_filas enable row level security;

create policy migracion_cargas_select on public.migracion_cargas
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.puede_escribir())
  );

create policy migracion_filas_select on public.migracion_filas
  for select to authenticated
  using (
    exists (
      select 1 from public.migracion_cargas c
      where c.id = carga_id
        and c.organizacion_id = (select private.organizacion_id())
    )
    and (select private.puede_escribir())
  );

-- auto_expose_new_tables = false: grants explícitos. Solo lectura.
revoke all on public.migracion_cargas from anon, public;
revoke all on public.migracion_filas from anon, public;
grant select on public.migracion_cargas to authenticated;
grant select on public.migracion_filas to authenticated;

-- ============================================================================
-- Validación de una fila de cliente (las mismas reglas del alta, MSF-180):
-- nombre obligatorio, correo con formato, largos de clientes_largos_ck, tipo
-- válido; además la fila exige el identificador del panel actual. Devuelve el
-- motivo en castellano, o null si la fila es válida.
-- ============================================================================

create or replace function private.validar_fila_cliente_migracion(p_fila jsonb)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_campo record;
  v_correo text := nullif(btrim(p_fila ->> 'correo'), '');
  v_tipo text := nullif(lower(btrim(p_fila ->> 'tipo')), '');
begin
  if nullif(btrim(p_fila ->> 'id_externo'), '') is null then
    return 'Falta el identificador del panel actual';
  end if;
  if char_length(btrim(p_fila ->> 'id_externo')) > 200 then
    return 'El identificador del panel actual supera 200 caracteres';
  end if;
  if nullif(btrim(p_fila ->> 'nombre'), '') is null then
    return 'Falta el nombre o la razón social';
  end if;
  for v_campo in
    select * from (values
      ('nombre', 'El nombre', 200),
      ('documento', 'El DNI/CUIT', 40),
      ('correo', 'El correo', 200),
      ('telefono', 'El teléfono', 60),
      ('celular', 'El celular', 60),
      ('direccion', 'La dirección', 200),
      ('codigo_postal', 'El CP', 20),
      ('localidad', 'La localidad', 120),
      ('provincia', 'La provincia', 120),
      ('expreso_preferido', 'El expreso preferido', 120)
    ) as t (campo, etiqueta, maximo)
  loop
    if char_length(btrim(coalesce(p_fila ->> v_campo.campo, ''))) > v_campo.maximo then
      return format('%s supera %s caracteres', v_campo.etiqueta, v_campo.maximo);
    end if;
  end loop;
  if v_correo is not null and v_correo !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    return 'El correo no tiene un formato válido';
  end if;
  if v_tipo is not null and v_tipo not in ('minorista', 'mayorista') then
    return 'El tipo de cliente debe ser minorista o mayorista';
  end if;
  return null;
end;
$$;

revoke execute on function private.validar_fila_cliente_migracion(jsonb) from public, anon, authenticated;

-- ============================================================================
-- Clasificación de una fila: nueva / actualizada / error, y el cliente que
-- actualiza. Conciliación por clientes_identificadores_externos con
-- sistema = 'panel_actual' (D1). Solo lee: la usan la vista previa y el aplicado
-- para que ambos digan lo mismo.
-- ============================================================================

create or replace function private.clasificar_fila_cliente(
  p_org uuid,
  p_fila jsonb,
  out o_estado text,
  out o_cliente uuid,
  out o_motivo text
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_org_cliente uuid;
  v_documento text;
begin
  o_motivo := private.validar_fila_cliente_migracion(p_fila);
  if o_motivo is not null then
    o_estado := 'error';
    return;
  end if;

  select v.cliente_id, c.organizacion_id
    into o_cliente, v_org_cliente
    from public.clientes_identificadores_externos v
    join public.clientes c on c.id = v.cliente_id
   where v.sistema = 'panel_actual'
     and v.identificador_externo = btrim(p_fila ->> 'id_externo');

  if o_cliente is not null and v_org_cliente <> p_org then
    o_estado := 'error';
    o_cliente := null;
    o_motivo := 'El identificador ya está en uso por otro cliente';
    return;
  end if;

  -- Unicidad de DNI/CUIT por organización (igual que el alta); solo si la fila trae el documento.
  v_documento := private.documento_normalizado(p_fila ->> 'documento');
  if v_documento is not null and exists (
    select 1 from public.clientes c
     where c.organizacion_id = p_org
       and private.documento_normalizado(c.documento) = v_documento
       and c.id is distinct from o_cliente
  ) then
    o_estado := 'error';
    o_cliente := null;
    o_motivo := 'Ya existe un cliente con ese DNI/CUIT';
    return;
  end if;

  o_estado := case when o_cliente is null then 'nueva' else 'actualizada' end;
end;
$$;

revoke execute on function private.clasificar_fila_cliente(uuid, jsonb) from public, anon, authenticated;

-- ============================================================================
-- RPC · iniciar_carga_migracion
-- ============================================================================

create or replace function public.iniciar_carga_migracion(
  p_entidad text,
  p_archivo text,
  p_filas_total integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_id uuid;
begin
  if v_org is null or not (select private.puede_escribir()) then
    raise exception 'Solo un administrador puede migrar datos' using errcode = '42501';
  end if;
  if p_entidad is null or p_entidad not in ('clientes', 'proveedores', 'vinculos_proveedor_producto', 'ingresos_archivo') then
    raise exception 'Entidad de migración desconocida' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_archivo, '')), '') is null or char_length(p_archivo) > 200 then
    raise exception 'El nombre del archivo es obligatorio y admite hasta 200 caracteres' using errcode = '22023';
  end if;
  if p_filas_total is null or p_filas_total < 0 or p_filas_total > 200000 then
    raise exception 'La cantidad de filas debe estar entre 0 y 200000' using errcode = '22023';
  end if;

  insert into public.migracion_cargas (organizacion_id, entidad, archivo, filas_total, actor_id)
  values (v_org, p_entidad, btrim(p_archivo), p_filas_total, (select auth.uid()))
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.iniciar_carga_migracion(text, text, integer) is
  'F-MIG-01: abre una carga de migración de la organización del llamador (solo Administrador). Devuelve su id.';

revoke execute on function public.iniciar_carga_migracion(text, text, integer) from public, anon;
grant execute on function public.iniciar_carga_migracion(text, text, integer) to authenticated;

-- ============================================================================
-- RPC · previsualizar_lote_clientes (solo lee; mismas reglas que el aplicado)
-- ============================================================================

create or replace function public.previsualizar_lote_clientes(p_filas jsonb)
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

  return coalesce((
    select jsonb_agg(
             jsonb_build_object('fila', (f.value ->> 'fila')::integer, 'estado', k.o_estado, 'motivo', k.o_motivo)
             order by f.ordinality
           )
      from jsonb_array_elements(p_filas) with ordinality as f (value, ordinality)
      cross join lateral private.clasificar_fila_cliente(v_org, f.value) as k
  ), '[]'::jsonb);
end;
$$;

comment on function public.previsualizar_lote_clientes(jsonb) is
  'F-MIG-01: clasifica filas de clientes (nueva / actualizada / error + motivo) sin escribir nada. Solo Administrador; lote de hasta 500 filas.';

revoke execute on function public.previsualizar_lote_clientes(jsonb) from public, anon;
grant execute on function public.previsualizar_lote_clientes(jsonb) to authenticated;

-- ============================================================================
-- RPC · aplicar_lote_clientes
-- El lote es atómico: cualquier error inesperado lo revierte entero. Los
-- errores de datos de una fila se registran como 'error' y siguen las demás.
-- Idempotente por (carga, fila): una fila ya aplicada se omite al reintentar.
-- ============================================================================

create or replace function public.aplicar_lote_clientes(
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
  v_cliente uuid;
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

  -- Bloquea la carga: serializa lotes concurrentes de la misma carga.
  select * into v_carga
    from public.migracion_cargas c
   where c.id = p_carga and c.organizacion_id = v_org
     for update;
  if not found then
    raise exception 'La carga no existe en tu organización' using errcode = 'P0002';
  end if;
  if v_carga.entidad <> 'clientes' then
    raise exception 'La carga no es de clientes' using errcode = '22023';
  end if;

  for v_fila in select e.value from jsonb_array_elements(p_filas) as e (value) loop
    if jsonb_typeof(v_fila -> 'fila') is distinct from 'number' then
      raise exception 'Cada fila debe traer su número de fila' using errcode = '22023';
    end if;
    v_num := (v_fila ->> 'fila')::integer;
    v_ext := nullif(btrim(v_fila ->> 'id_externo'), '');
    v_resultado := null;
    v_motivo := null;

    -- Ya aplicada en un intento anterior de esta carga: no se repite.
    if exists (
      select 1 from public.migracion_filas f
       where f.carga_id = p_carga and f.fila = v_num and f.estado in ('nueva', 'actualizada')
    ) then
      v_omitidos := v_omitidos + 1;
      continue;
    end if;

    begin
      select k.o_estado, k.o_cliente, k.o_motivo
        into v_estado, v_cliente, v_motivo
        from private.clasificar_fila_cliente(v_org, v_fila) as k;

      -- El mismo identificador DOS VECES EN EL MISMO LOTE: la primera gana (FR-004).
      -- Ojo: NO se compara contra toda la carga. Reenviar un identificador ya cargado en un
      -- lote anterior es un upsert (FR-005: "si el identificador existe, actualiza"), no un
      -- duplicado; la idempotencia del mismo archivo la cubre el chequeo de fila ya aplicada.
      if v_estado <> 'error' and exists (
        select 1 from jsonb_array_elements(p_filas) as o (value)
         where nullif(btrim(o.value ->> 'id_externo'), '') = v_ext
           and coalesce((o.value ->> 'fila')::integer, -1) < v_num
      ) then
        v_estado := 'error';
        v_motivo := 'El identificador está repetido en el archivo';
      end if;

      if v_estado = 'actualizada' then
        -- Solo se pisan las columnas que el archivo trae (las no mapeadas quedan como están).
        update public.clientes c set
          nombre = btrim(v_fila ->> 'nombre'),
          documento = case when v_fila ? 'documento' then v_fila ->> 'documento' else c.documento end,
          correo = case when v_fila ? 'correo' then v_fila ->> 'correo' else c.correo end,
          telefono = case when v_fila ? 'telefono' then v_fila ->> 'telefono' else c.telefono end,
          celular = case when v_fila ? 'celular' then v_fila ->> 'celular' else c.celular end,
          direccion = case when v_fila ? 'direccion' then v_fila ->> 'direccion' else c.direccion end,
          codigo_postal = case when v_fila ? 'codigo_postal' then v_fila ->> 'codigo_postal' else c.codigo_postal end,
          localidad = case when v_fila ? 'localidad' then v_fila ->> 'localidad' else c.localidad end,
          provincia = case when v_fila ? 'provincia' then v_fila ->> 'provincia' else c.provincia end,
          expreso_preferido = case when v_fila ? 'expreso_preferido' then nullif(btrim(v_fila ->> 'expreso_preferido'), '') else c.expreso_preferido end,
          tipo = coalesce(nullif(lower(btrim(v_fila ->> 'tipo')), ''), c.tipo)
        where c.id = v_cliente and c.organizacion_id = v_org;
        v_resultado := 'actualizada';
      elsif v_estado = 'nueva' then
        insert into public.clientes (
          organizacion_id, nombre, documento, correo, telefono, celular, direccion,
          codigo_postal, localidad, provincia, expreso_preferido, tipo
        ) values (
          v_org, btrim(v_fila ->> 'nombre'), v_fila ->> 'documento', v_fila ->> 'correo',
          v_fila ->> 'telefono', v_fila ->> 'celular', v_fila ->> 'direccion',
          v_fila ->> 'codigo_postal', v_fila ->> 'localidad', v_fila ->> 'provincia',
          nullif(btrim(v_fila ->> 'expreso_preferido'), ''),
          coalesce(nullif(lower(btrim(v_fila ->> 'tipo')), ''), 'minorista')
        ) returning id into v_cliente;

        insert into public.clientes_identificadores_externos (cliente_id, sistema, identificador_externo)
        values (v_cliente, 'panel_actual', v_ext);

        -- Como cualquier alta (F-CLI-05): habilitado en todas las tiendas de la organización.
        insert into public.clientes_empresas (cliente_id, empresa_id, organizacion_id)
        select v_cliente, e.id, v_org from dominio.empresas e where e.organizacion_id = v_org
        on conflict do nothing;
        v_resultado := 'nueva';
      end if;
    exception
      when unique_violation then
        v_resultado := null;
        v_motivo := case
          when sqlerrm like '%clientes_org_documento_uq%' then 'Ya existe un cliente con ese DNI/CUIT'
          else 'El identificador ya está en uso por otro cliente'
        end;
      when insufficient_privilege then
        v_resultado := null;
        v_motivo := 'Este cliente no se puede modificar';
    end;

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

comment on function public.aplicar_lote_clientes(uuid, integer, jsonb) is
  'F-MIG-01: aplica un lote (hasta 500 filas) de clientes del panel actual. Upsert por clientes_identificadores_externos (sistema panel_actual): existe => actualiza, no => crea, vincula y habilita en las tiendas. Atómico por lote, idempotente por (carga, fila). Solo Administrador.';

revoke execute on function public.aplicar_lote_clientes(uuid, integer, jsonb) from public, anon;
grant execute on function public.aplicar_lote_clientes(uuid, integer, jsonb) to authenticated;

-- ============================================================================
-- RPC · cerrar_carga_migracion: recalcula los contadores desde las filas y
-- devuelve el informe de la carga. Se puede llamar de nuevo tras un reintento.
-- ============================================================================

create or replace function public.cerrar_carga_migracion(p_carga uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_carga public.migracion_cargas;
  v_nuevos integer;
  v_actualizados integer;
  v_errores integer;
  v_estado text;
  v_error text;
begin
  if v_org is null or not (select private.puede_escribir()) then
    raise exception 'Solo un administrador puede migrar datos' using errcode = '42501';
  end if;

  select * into v_carga
    from public.migracion_cargas c
   where c.id = p_carga and c.organizacion_id = v_org
     for update;
  if not found then
    raise exception 'La carga no existe en tu organización' using errcode = 'P0002';
  end if;

  select count(*) filter (where f.estado = 'nueva'),
         count(*) filter (where f.estado = 'actualizada'),
         count(*) filter (where f.estado = 'error')
    into v_nuevos, v_actualizados, v_errores
    from public.migracion_filas f
   where f.carga_id = p_carga;

  if v_nuevos + v_actualizados + v_errores <> v_carga.filas_total then
    v_estado := 'fallida';
    v_error := format(
      'Se registraron %s de %s filas: reintentá para completar lo pendiente',
      v_nuevos + v_actualizados + v_errores, v_carga.filas_total
    );
  else
    v_estado := 'aplicada';
  end if;

  update public.migracion_cargas c
     set estado = v_estado,
         nuevos = v_nuevos,
         actualizados = v_actualizados,
         con_error = v_errores,
         error = v_error,
         cerrada_en = case when v_estado = 'aplicada' then now() else null end
   where c.id = p_carga;

  return jsonb_build_object(
    'carga', p_carga,
    'entidad', v_carga.entidad,
    'archivo', v_carga.archivo,
    'estado', v_estado,
    'error', v_error,
    'filas_total', v_carga.filas_total,
    'nuevos', v_nuevos,
    'actualizados', v_actualizados,
    'con_error', v_errores,
    'errores', coalesce((
      select jsonb_agg(jsonb_build_object('fila', x.fila, 'motivo', x.motivo) order by x.fila)
        from (
          select f.fila, f.motivo
            from public.migracion_filas f
           where f.carga_id = p_carga and f.estado = 'error'
           order by f.fila
           limit 200
        ) as x
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.cerrar_carga_migracion(uuid) is
  'F-MIG-01: cierra la carga: contadores desde migracion_filas, estado aplicada (filas completas) o fallida (faltan filas) y devuelve el informe con hasta 200 errores. Repetible. Solo Administrador.';

revoke execute on function public.cerrar_carga_migracion(uuid) from public, anon;
grant execute on function public.cerrar_carga_migracion(uuid) to authenticated;
