-- F-MIG-02 (MSF-313, épica MSF-142): importador de proveedores y vínculo con productos.
-- Spec: specs/20261023-120000-migracion-inicial-de-datos/ (FR-020…FR-024).
--
-- Esquemas (Principio VII), verificados tabla por tabla:
--   dominio.proveedores  dominio  (alterada)  entidad de negocio del producto; se le agrega
--                                              `id_externo` (identificador del panel actual).
--   dominio.productos    dominio  (existente)  sin cambios de esquema; la RPC de vínculos solo
--                                              actualiza `proveedor_id` y `codigo_proveedor`.
--   public.migracion_cargas / public.migracion_filas: existentes (F-MIG-01); se reutilizan.
-- No se crea ninguna tabla, así que no hay RLS nueva: la RLS de las tablas tocadas no cambia y las
-- RPC (`security definer`, `search_path = ''`) validan rol Administrador y organización de la sesión.
-- `anon` no ejecuta nada (revoke ... from public, anon; grant ... to authenticated).
--
-- Conciliación de proveedores por `dominio.proveedores.id_externo` (nullable, único por organización
-- cuando tiene valor): existe => actualiza, no existe => crea. Las mismas validaciones que Proveedores
-- (MSF-205): razón social obligatoria, CUIT con dígito verificador y único por organización.
-- Vínculos: SKU del producto + identificador externo del proveedor + código del proveedor. Un SKU que
-- no existe o un proveedor no cargado es error de fila (los productos los migra Catálogo; no se crean).
--
-- Migración aditiva (columna nullable, índice y funciones nuevas). Reversión (en una migración
-- posterior, no en este PR; los datos cargados se revierten con el listado de la carga):
--   drop function public.aplicar_lote_vinculos_proveedor_producto(uuid, integer, jsonb);
--   drop function public.previsualizar_lote_vinculos_proveedor_producto(jsonb);
--   drop function public.aplicar_lote_proveedores(uuid, integer, jsonb);
--   drop function public.previsualizar_lote_proveedores(jsonb);
--   drop function private.clasificar_fila_vinculo_proveedor(uuid, jsonb);
--   drop function private.clasificar_fila_proveedor(uuid, jsonb);
--   drop function private.validar_fila_vinculo_migracion(jsonb);
--   drop function private.validar_fila_proveedor_migracion(jsonb);
--   drop index dominio.proveedores_org_id_externo_uidx;
--   alter table dominio.proveedores drop column id_externo;

-- ============================================================================
-- dominio.proveedores.id_externo
-- ============================================================================

alter table dominio.proveedores
  add column if not exists id_externo text
    check (id_externo is null or (btrim(id_externo) <> '' and length(id_externo) <= 200));

comment on column dominio.proveedores.id_externo is
  'F-MIG-02: identificador del proveedor en el panel actual. Clave de conciliación de la migración inicial; nullable (los proveedores cargados a mano no lo tienen). Único por organización cuando tiene valor.';

create unique index if not exists proveedores_org_id_externo_uidx
  on dominio.proveedores (organizacion_id, id_externo)
  where id_externo is not null;

-- ============================================================================
-- Validación de una fila de proveedor (las mismas reglas del alta, MSF-205).
-- Devuelve el motivo en castellano, o null si la fila es válida.
-- ============================================================================

create or replace function private.validar_fila_proveedor_migracion(p_fila jsonb)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_campo record;
  v_correo text := nullif(btrim(p_fila ->> 'correo'), '');
  v_cuit text;
begin
  if nullif(btrim(p_fila ->> 'id_externo'), '') is null then
    return 'Falta el identificador del panel actual';
  end if;
  if char_length(btrim(p_fila ->> 'id_externo')) > 200 then
    return 'El identificador del panel actual supera 200 caracteres';
  end if;
  if nullif(btrim(p_fila ->> 'razon_social'), '') is null then
    return 'Falta la razón social';
  end if;
  for v_campo in
    select * from (values
      ('razon_social', 'La razón social', 200),
      ('persona_contacto', 'La persona de contacto', 200),
      ('correo', 'El correo', 254),
      ('telefono', 'El teléfono', 50),
      ('direccion', 'La dirección', 300),
      ('observaciones', 'Las observaciones', 2000)
    ) as t (campo, etiqueta, maximo)
  loop
    if char_length(btrim(coalesce(p_fila ->> v_campo.campo, ''))) > v_campo.maximo then
      return format('%s supera %s caracteres', v_campo.etiqueta, v_campo.maximo);
    end if;
  end loop;

  if nullif(btrim(p_fila ->> 'cuit'), '') is null then
    return 'Falta el CUIT';
  end if;
  if (p_fila ->> 'cuit') ~ '[^0-9\s.\-]' then
    return 'El CUIT solo admite números (con o sin guiones)';
  end if;
  v_cuit := regexp_replace(p_fila ->> 'cuit', '[\s.\-]', '', 'g');
  if length(v_cuit) <> 11 then
    return 'El CUIT debe tener 11 dígitos';
  end if;
  if not private.cuit_valido(v_cuit) then
    return 'El CUIT no es válido: revisá el dígito verificador';
  end if;

  if v_correo is not null and v_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return 'El correo no tiene un formato válido';
  end if;
  return null;
end;
$$;

revoke execute on function private.validar_fila_proveedor_migracion(jsonb) from public, anon, authenticated;

-- ============================================================================
-- Clasificación de una fila de proveedor: nueva / actualizada / error. Solo lee:
-- la usan la vista previa y el aplicado para que ambos digan lo mismo.
-- ============================================================================

create or replace function private.clasificar_fila_proveedor(
  p_org uuid,
  p_fila jsonb,
  out o_estado text,
  out o_proveedor uuid,
  out o_motivo text
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_cuit text;
begin
  o_motivo := private.validar_fila_proveedor_migracion(p_fila);
  if o_motivo is not null then
    o_estado := 'error';
    return;
  end if;

  v_cuit := regexp_replace(p_fila ->> 'cuit', '[\s.\-]', '', 'g');

  select p.id into o_proveedor
    from dominio.proveedores p
   where p.organizacion_id = p_org
     and p.id_externo = btrim(p_fila ->> 'id_externo');

  -- CUIT único por organización (incluye inactivos), igual que el alta.
  if exists (
    select 1 from dominio.proveedores p
     where p.organizacion_id = p_org
       and p.cuit = v_cuit
       and p.id is distinct from o_proveedor
  ) then
    o_estado := 'error';
    o_proveedor := null;
    o_motivo := 'Ya existe un proveedor con ese CUIT';
    return;
  end if;

  o_estado := case when o_proveedor is null then 'nueva' else 'actualizada' end;
end;
$$;

revoke execute on function private.clasificar_fila_proveedor(uuid, jsonb) from public, anon, authenticated;

-- ============================================================================
-- RPC · previsualizar_lote_proveedores (solo lee; mismas reglas que el aplicado)
-- ============================================================================

create or replace function public.previsualizar_lote_proveedores(p_filas jsonb)
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
      cross join lateral private.clasificar_fila_proveedor(v_org, f.value) as k
  ), '[]'::jsonb);
end;
$$;

comment on function public.previsualizar_lote_proveedores(jsonb) is
  'F-MIG-02: clasifica filas de proveedores (nueva / actualizada / error + motivo) sin escribir nada. Solo Administrador; lote de hasta 500 filas.';

revoke execute on function public.previsualizar_lote_proveedores(jsonb) from public, anon;
grant execute on function public.previsualizar_lote_proveedores(jsonb) to authenticated;

-- ============================================================================
-- RPC · aplicar_lote_proveedores
-- Lote atómico; los errores de datos de una fila se registran y siguen las demás.
-- Idempotente por (carga, fila) y por dominio.proveedores.id_externo.
-- ============================================================================

create or replace function public.aplicar_lote_proveedores(
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
  v_proveedor uuid;
  v_motivo text;
  v_resultado text;
  v_cuit text;
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
  if v_carga.entidad <> 'proveedores' then
    raise exception 'La carga no es de proveedores' using errcode = '22023';
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
      select k.o_estado, k.o_proveedor, k.o_motivo
        into v_estado, v_proveedor, v_motivo
        from private.clasificar_fila_proveedor(v_org, v_fila) as k;

      -- Mismo identificador dos veces en el archivo: la primera fila aplicada gana.
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
        v_cuit := regexp_replace(v_fila ->> 'cuit', '[\s.\-]', '', 'g');
      end if;

      if v_estado = 'actualizada' then
        -- Solo se pisan las columnas que el archivo trae con valor: las celdas vacías dejan el dato
        -- existente como está (nunca se borra un dato por reimportar).
        update dominio.proveedores p set
          razon_social = btrim(v_fila ->> 'razon_social'),
          cuit = v_cuit,
          persona_contacto = coalesce(nullif(btrim(v_fila ->> 'persona_contacto'), ''), p.persona_contacto),
          correo = coalesce(nullif(btrim(v_fila ->> 'correo'), ''), p.correo),
          telefono = coalesce(nullif(btrim(v_fila ->> 'telefono'), ''), p.telefono),
          direccion = coalesce(nullif(btrim(v_fila ->> 'direccion'), ''), p.direccion),
          observaciones = coalesce(nullif(btrim(v_fila ->> 'observaciones'), ''), p.observaciones)
        where p.id = v_proveedor and p.organizacion_id = v_org;
        if found then
          v_resultado := 'actualizada';
        else
          v_motivo := 'El proveedor ya no existe';
        end if;
      elsif v_estado = 'nueva' then
        insert into dominio.proveedores (
          organizacion_id, razon_social, cuit, persona_contacto, correo, telefono,
          direccion, observaciones, id_externo
        ) values (
          v_org, btrim(v_fila ->> 'razon_social'), v_cuit,
          nullif(btrim(v_fila ->> 'persona_contacto'), ''), nullif(btrim(v_fila ->> 'correo'), ''),
          nullif(btrim(v_fila ->> 'telefono'), ''), nullif(btrim(v_fila ->> 'direccion'), ''),
          nullif(btrim(v_fila ->> 'observaciones'), ''), v_ext
        );
        v_resultado := 'nueva';
      end if;
    exception
      when unique_violation then
        v_resultado := null;
        v_motivo := case
          when sqlerrm like '%proveedores_org_id_externo_uidx%' then 'El identificador ya está en uso'
          else 'Ya existe un proveedor con ese CUIT'
        end;
      when check_violation or invalid_parameter_value then
        v_resultado := null;
        v_motivo := 'La fila no pasó la validación de proveedores';
      when insufficient_privilege then
        v_resultado := null;
        v_motivo := 'Este proveedor no se puede modificar';
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

comment on function public.aplicar_lote_proveedores(uuid, integer, jsonb) is
  'F-MIG-02: aplica un lote (hasta 500 filas) de proveedores del panel actual. Upsert por dominio.proveedores.id_externo, con las validaciones de Proveedores (CUIT con dígito verificador, único por organización). Atómico por lote, idempotente por (carga, fila). Solo Administrador.';

revoke execute on function public.aplicar_lote_proveedores(uuid, integer, jsonb) from public, anon;
grant execute on function public.aplicar_lote_proveedores(uuid, integer, jsonb) to authenticated;

-- ============================================================================
-- Vínculos proveedor ↔ producto
-- Fila: sku (producto) + proveedor_id_externo (proveedor cargado) + codigo_proveedor.
-- El identificador de conciliación de la fila es el SKU (un producto, un proveedor).
-- ============================================================================

create or replace function private.validar_fila_vinculo_migracion(p_fila jsonb)
returns text
language plpgsql
stable
set search_path = ''
as $$
begin
  if nullif(btrim(p_fila ->> 'sku'), '') is null then
    return 'Falta el SKU del producto';
  end if;
  if char_length(btrim(p_fila ->> 'sku')) > 80 then
    return 'El SKU supera 80 caracteres';
  end if;
  if nullif(btrim(p_fila ->> 'proveedor_id_externo'), '') is null then
    return 'Falta el identificador del proveedor en el panel actual';
  end if;
  if char_length(btrim(p_fila ->> 'proveedor_id_externo')) > 200 then
    return 'El identificador del proveedor supera 200 caracteres';
  end if;
  if char_length(btrim(coalesce(p_fila ->> 'codigo_proveedor', ''))) > 80 then
    return 'El código del proveedor supera 80 caracteres';
  end if;
  return null;
end;
$$;

revoke execute on function private.validar_fila_vinculo_migracion(jsonb) from public, anon, authenticated;

create or replace function private.clasificar_fila_vinculo_proveedor(
  p_org uuid,
  p_fila jsonb,
  out o_estado text,
  out o_producto uuid,
  out o_proveedor uuid,
  out o_motivo text
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_actual uuid;
  v_activo boolean;
begin
  o_motivo := private.validar_fila_vinculo_migracion(p_fila);
  if o_motivo is not null then
    o_estado := 'error';
    return;
  end if;

  select p.id, p.proveedor_id into o_producto, v_actual
    from dominio.productos p
   where p.organizacion_id = p_org
     and lower(btrim(p.sku)) = lower(btrim(p_fila ->> 'sku'));
  if o_producto is null then
    o_estado := 'error';
    o_motivo := 'El SKU no existe en el catálogo';
    return;
  end if;

  select p.id, p.activo into o_proveedor, v_activo
    from dominio.proveedores p
   where p.organizacion_id = p_org
     and p.id_externo = btrim(p_fila ->> 'proveedor_id_externo');
  if o_proveedor is null then
    o_estado := 'error';
    o_producto := null;
    o_motivo := 'El proveedor no está cargado';
    return;
  end if;
  if not v_activo then
    o_estado := 'error';
    o_producto := null;
    o_proveedor := null;
    o_motivo := 'El proveedor está desactivado';
    return;
  end if;

  o_estado := case when v_actual is null then 'nueva' else 'actualizada' end;
end;
$$;

revoke execute on function private.clasificar_fila_vinculo_proveedor(uuid, jsonb) from public, anon, authenticated;

create or replace function public.previsualizar_lote_vinculos_proveedor_producto(p_filas jsonb)
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
      cross join lateral private.clasificar_fila_vinculo_proveedor(v_org, f.value) as k
  ), '[]'::jsonb);
end;
$$;

comment on function public.previsualizar_lote_vinculos_proveedor_producto(jsonb) is
  'F-MIG-02: clasifica filas de vínculos proveedor↔producto (nueva / actualizada / error + motivo) sin escribir nada. Solo Administrador; lote de hasta 500 filas.';

revoke execute on function public.previsualizar_lote_vinculos_proveedor_producto(jsonb) from public, anon;
grant execute on function public.previsualizar_lote_vinculos_proveedor_producto(jsonb) to authenticated;

create or replace function public.aplicar_lote_vinculos_proveedor_producto(
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
  v_sku text;
  v_estado text;
  v_producto uuid;
  v_proveedor uuid;
  v_motivo text;
  v_resultado text;
  v_codigo text;
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
  if v_carga.entidad <> 'vinculos_proveedor_producto' then
    raise exception 'La carga no es de vínculos proveedor-producto' using errcode = '22023';
  end if;

  for v_fila in select e.value from jsonb_array_elements(p_filas) as e (value) loop
    if jsonb_typeof(v_fila -> 'fila') is distinct from 'number' then
      raise exception 'Cada fila debe traer su número de fila' using errcode = '22023';
    end if;
    v_num := (v_fila ->> 'fila')::integer;
    v_sku := nullif(btrim(v_fila ->> 'sku'), '');
    v_resultado := null;
    v_motivo := null;

    if exists (
      select 1 from public.migracion_filas f
       where f.carga_id = p_carga and f.fila = v_num and f.estado in ('nueva', 'actualizada')
    ) then
      v_omitidos := v_omitidos + 1;
      continue;
    end if;

    begin
      select k.o_estado, k.o_producto, k.o_proveedor, k.o_motivo
        into v_estado, v_producto, v_proveedor, v_motivo
        from private.clasificar_fila_vinculo_proveedor(v_org, v_fila) as k;

      -- Mismo SKU dos veces en el archivo: la primera fila aplicada gana (un producto, un proveedor).
      if v_estado <> 'error' and v_sku is not null and exists (
        select 1 from public.migracion_filas f
         where f.carga_id = p_carga and f.fila < v_num
           and lower(f.identificador_externo) = lower(left(v_sku, 200))
           and f.estado in ('nueva', 'actualizada')
      ) then
        v_estado := 'error';
        v_motivo := 'El SKU está repetido en el archivo';
      end if;

      if v_estado <> 'error' then
        v_codigo := nullif(btrim(v_fila ->> 'codigo_proveedor'), '');
        -- Celda vacía: conserva el código solo si el proveedor no cambia; con otro proveedor el
        -- código anterior ya no corresponde y se limpia.
        update dominio.productos p set
          proveedor_id = v_proveedor,
          codigo_proveedor = coalesce(v_codigo, case when p.proveedor_id = v_proveedor then p.codigo_proveedor end)
        where p.id = v_producto and p.organizacion_id = v_org;
        if found then
          v_resultado := v_estado;
        else
          v_motivo := 'El producto ya no existe';
        end if;
      end if;
    exception
      when check_violation or invalid_parameter_value then
        v_resultado := null;
        v_motivo := 'El proveedor no existe o está desactivado';
      when insufficient_privilege then
        v_resultado := null;
        v_motivo := 'Este producto no se puede modificar';
    end;

    if v_resultado = 'nueva' then
      v_nuevos := v_nuevos + 1;
    elsif v_resultado = 'actualizada' then
      v_actualizados := v_actualizados + 1;
    else
      v_errores := v_errores || jsonb_build_object('fila', v_num, 'motivo', v_motivo);
    end if;

    insert into public.migracion_filas (carga_id, lote, fila, estado, identificador_externo, motivo)
    values (p_carga, p_lote, v_num, coalesce(v_resultado, 'error'), left(v_sku, 200), left(v_motivo, 300))
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

comment on function public.aplicar_lote_vinculos_proveedor_producto(uuid, integer, jsonb) is
  'F-MIG-02: aplica un lote (hasta 500 filas) de vínculos: fija productos.proveedor_id y codigo_proveedor por SKU + identificador externo del proveedor. SKU inexistente o proveedor no cargado => error de fila. Atómico por lote, idempotente por (carga, fila). Solo Administrador.';

revoke execute on function public.aplicar_lote_vinculos_proveedor_producto(uuid, integer, jsonb) from public, anon;
grant execute on function public.aplicar_lote_vinculos_proveedor_producto(uuid, integer, jsonb) to authenticated;
