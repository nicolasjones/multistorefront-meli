-- MSF-594 (épica MSF-585, BUG-312): `dominio.clientes.condicion_iva` no tenía ninguna vía de carga.
-- La columna (texto libre, ≤ 60) la creó `20261211120050` para la factura interna, pero ningún grant de
-- INSERT/UPDATE la alcanzaba para `authenticated` y la importación de clientes (`aplicar_lote_clientes`)
-- no la leía: quedaba siempre vacía.
--
-- Esta migración abre las dos vías de base de datos:
--   1. API (PostgREST): `grant insert/update (condicion_iva)` a `authenticated`; la RLS de la tabla sigue
--      mandando (organización y nivel de la sección `clientes`), y el check `clientes_condicion_iva_largo_ck`
--      sigue limitando el largo.
--   2. Importación: `private.validar_fila_cliente_migracion` valida el largo de `condicion_iva` y
--      `public.aplicar_lote_clientes` la inserta/actualiza. Como el resto de las columnas de la carga, una
--      celda vacía NO borra el dato existente.
-- La interfaz (campo en el formulario de cliente y columna en «Importar clientes») queda pendiente: el
-- prototipo (`ClienteFicha.dc.html`, `Clientes.dc.html`) no trae ese campo; ver docs/clientes.md.
--
-- Partida de las definiciones VIGENTES: ambas funciones son las de `20261201100000_migracion_cargas.sql`
-- con `public.clientes` ya trasladada a `dominio.clientes` (`20270418000401`); no hubo otra redefinición.
-- `aplicar_lote_clientes` conserva `security definer`, `set search_path = ''`, el `revoke ... from public, anon`
-- y el `grant execute ... to authenticated`.
--
-- Migración aditiva. Reversión (migración posterior):
--   revoke insert (condicion_iva), update (condicion_iva) on dominio.clientes from authenticated;
--   y volver a crear las dos funciones sin `condicion_iva` (las de `20261201100000` con `dominio.clientes`).

grant insert (condicion_iva) on dominio.clientes to authenticated;
grant update (condicion_iva) on dominio.clientes to authenticated;

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
      ('expreso_preferido', 'El expreso preferido', 120),
      ('condicion_iva', 'La condición de IVA', 60)
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

      -- El mismo identificador DOS VECES EN EL ARCHIVO (en cualquier lote): la primera fila
      -- aplicada gana (FR-004). Se compara contra las filas de ESTA carga ya aplicadas
      -- (migracion_filas), no contra datos previos: reimportar un identificador de otra carga
      -- sigue siendo un upsert (FR-005).
      if v_estado <> 'error' and v_ext is not null and exists (
        select 1 from public.migracion_filas f
         where f.carga_id = p_carga and f.fila <> v_num
           and f.identificador_externo = left(v_ext, 200)
           and f.estado in ('nueva', 'actualizada')
           and f.fila < v_num
      ) then
        v_estado := 'error';
        v_motivo := 'El identificador está repetido en el archivo';
      end if;

      if v_estado = 'actualizada' then
        -- Solo se pisan las columnas que el archivo trae con valor: las no mapeadas y las celdas
        -- vacías dejan el dato existente como está (nunca se borra un dato por reimportar).
        update dominio.clientes c set
          nombre = btrim(v_fila ->> 'nombre'),
          documento = coalesce(nullif(btrim(v_fila ->> 'documento'), ''), c.documento),
          correo = coalesce(nullif(btrim(v_fila ->> 'correo'), ''), c.correo),
          telefono = coalesce(nullif(btrim(v_fila ->> 'telefono'), ''), c.telefono),
          celular = coalesce(nullif(btrim(v_fila ->> 'celular'), ''), c.celular),
          direccion = coalesce(nullif(btrim(v_fila ->> 'direccion'), ''), c.direccion),
          codigo_postal = coalesce(nullif(btrim(v_fila ->> 'codigo_postal'), ''), c.codigo_postal),
          localidad = coalesce(nullif(btrim(v_fila ->> 'localidad'), ''), c.localidad),
          provincia = coalesce(nullif(btrim(v_fila ->> 'provincia'), ''), c.provincia),
          expreso_preferido = coalesce(nullif(btrim(v_fila ->> 'expreso_preferido'), ''), c.expreso_preferido),
          condicion_iva = coalesce(nullif(btrim(v_fila ->> 'condicion_iva'), ''), c.condicion_iva),
          tipo = coalesce(nullif(lower(btrim(v_fila ->> 'tipo')), ''), c.tipo)
        where c.id = v_cliente and c.organizacion_id = v_org;
        if found then
          v_resultado := 'actualizada';
        else
          v_motivo := 'El cliente ya no existe';
        end if;
      elsif v_estado = 'nueva' then
        insert into dominio.clientes (
          organizacion_id, nombre, documento, correo, telefono, celular, direccion,
          codigo_postal, localidad, provincia, expreso_preferido, condicion_iva, tipo
        ) values (
          v_org, btrim(v_fila ->> 'nombre'), nullif(btrim(v_fila ->> 'documento'), ''),
          nullif(btrim(v_fila ->> 'correo'), ''), nullif(btrim(v_fila ->> 'telefono'), ''),
          nullif(btrim(v_fila ->> 'celular'), ''), nullif(btrim(v_fila ->> 'direccion'), ''),
          nullif(btrim(v_fila ->> 'codigo_postal'), ''), nullif(btrim(v_fila ->> 'localidad'), ''),
          nullif(btrim(v_fila ->> 'provincia'), ''),
          nullif(btrim(v_fila ->> 'expreso_preferido'), ''),
          nullif(btrim(v_fila ->> 'condicion_iva'), ''),
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
          else 'El identificador ya está en uso'
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
