-- F-REN-08 (MSF-209): RPC de costos adicionales. Esquema: `public` (superficie de ejecución; no
-- almacena datos). Son la ÚNICA vía de escritura de `dominio.costos_adicionales_canal`.
--
-- `security definer` + `search_path = ''`: la tabla no tiene políticas de escritura, así que cada RPC
-- valida ella misma la sesión: organización, sección `rentabilidad` (la lista pide lectura; guardar y
-- baja piden edición) y empresa accesible. Errores con código estable: 42501 permiso, 23514 dato
-- inválido, 23505 nombre repetido, P0002 no existe.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.dar_baja_costo_adicional(uuid);
--   drop function public.guardar_costo_adicional(uuid, uuid, text, text, numeric);
--   drop function public.listar_costos_adicionales(uuid);

create or replace function public.listar_costos_adicionales(p_empresa_id uuid default null)
returns table (
  id uuid,
  empresa_id uuid,
  empresa_nombre text,
  nombre text,
  tipo text,
  valor numeric,
  creado_en timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
begin
  if v_organizacion is null or (select private.nivel_seccion('rentabilidad')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver los costos adicionales' using errcode = '42501';
  end if;
  return query
    select c.id, c.empresa_id, e.nombre, c.nombre, c.tipo, c.valor, c.creado_en
      from dominio.costos_adicionales_canal c
      join dominio.empresas e on e.id = c.empresa_id
     where c.organizacion_id = v_organizacion
       and c.activo
       and c.empresa_id in (select private.empresas_accesibles())
       and (p_empresa_id is null or c.empresa_id = p_empresa_id)
     order by e.nombre, lower(c.nombre), c.id;
end;
$$;

comment on function public.listar_costos_adicionales(uuid) is
  'F-REN-08: costos adicionales activos de las empresas accesibles (o de una). 42501 sin la sección rentabilidad.';

create or replace function public.guardar_costo_adicional(
  p_id uuid,
  p_empresa_id uuid,
  p_nombre text,
  p_tipo text,
  p_valor numeric
)
returns dominio.costos_adicionales_canal
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_nombre text := btrim(coalesce(p_nombre, ''));
  v_actual dominio.costos_adicionales_canal;
  v_fila dominio.costos_adicionales_canal;
  v_empresa text;
begin
  if v_organizacion is null or (select private.nivel_seccion('rentabilidad')) <> 'edicion' then
    raise exception 'Tu rol no puede editar los costos adicionales' using errcode = '42501';
  end if;
  if p_empresa_id is null or p_empresa_id not in (select private.empresas_accesibles()) then
    raise exception 'No podés cargar costos para esa empresa' using errcode = '42501';
  end if;
  if v_nombre = '' or char_length(v_nombre) > 80 then
    raise exception 'El nombre es obligatorio y admite hasta 80 caracteres' using errcode = '23514';
  end if;
  if p_tipo is null or p_tipo not in ('porcentaje', 'monto') then
    raise exception 'Elegí si el costo es un porcentaje o un monto por unidad' using errcode = '23514';
  end if;
  if p_valor is null or p_valor < 0 then
    raise exception 'El valor no puede ser negativo' using errcode = '23514';
  end if;
  if p_tipo = 'porcentaje' and p_valor > 100 then
    raise exception 'El porcentaje debe estar entre 0 y 100' using errcode = '23514';
  end if;
  if p_valor <> round(p_valor, 4) then
    raise exception 'El valor admite hasta 4 decimales' using errcode = '23514';
  end if;
  if p_valor >= 1000000000 then
    raise exception 'El valor es demasiado grande' using errcode = '23514';
  end if;

  select e.nombre into v_empresa from dominio.empresas e where e.id = p_empresa_id;

  begin
    if p_id is null then
      insert into dominio.costos_adicionales_canal (organizacion_id, empresa_id, nombre, tipo, valor)
      values (v_organizacion, p_empresa_id, v_nombre, p_tipo, p_valor)
      returning * into v_fila;
    else
      select * into v_actual from dominio.costos_adicionales_canal c
       where c.id = p_id and c.organizacion_id = v_organizacion and c.activo for update;
      if not found then
        raise exception 'El costo adicional no existe o ya fue dado de baja' using errcode = 'P0002';
      end if;
      if v_actual.empresa_id <> p_empresa_id then
        raise exception 'Un costo no puede cambiar de empresa' using errcode = '23514';
      end if;
      update dominio.costos_adicionales_canal
         set nombre = v_nombre, tipo = p_tipo, valor = p_valor
       where id = p_id
      returning * into v_fila;
    end if;
  exception when unique_violation then
    raise exception 'Ya hay un costo con ese nombre en %', v_empresa using errcode = '23505';
  end;

  perform private.insertar_actividad(
    v_organizacion, (select auth.uid()), 'rentabilidad.costo_guardado',
    format('%s el costo adicional «%s» de %s', case when p_id is null then 'Creó' else 'Editó' end, v_nombre, v_empresa),
    p_empresa_id
  );
  return v_fila;
end;
$$;

comment on function public.guardar_costo_adicional(uuid, uuid, text, text, numeric) is
  'F-REN-08: alta (p_id null) o edición de un costo adicional (solo edición en rentabilidad). 42501, 23514, 23505, P0002.';

create or replace function public.dar_baja_costo_adicional(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_fila dominio.costos_adicionales_canal;
begin
  if v_organizacion is null or (select private.nivel_seccion('rentabilidad')) <> 'edicion' then
    raise exception 'Tu rol no puede editar los costos adicionales' using errcode = '42501';
  end if;
  select * into v_fila from dominio.costos_adicionales_canal c
   where c.id = p_id and c.organizacion_id = v_organizacion for update;
  if not found then
    raise exception 'El costo adicional no existe' using errcode = 'P0002';
  end if;
  if v_fila.empresa_id not in (select private.empresas_accesibles()) then
    raise exception 'No podés editar costos de esa empresa' using errcode = '42501';
  end if;
  -- Idempotente: dar de baja uno ya dado de baja no hace nada.
  if not v_fila.activo then
    return;
  end if;
  update dominio.costos_adicionales_canal set activo = false where id = p_id;
  perform private.insertar_actividad(
    v_organizacion, (select auth.uid()), 'rentabilidad.costo_baja',
    format('Dio de baja el costo adicional «%s»', v_fila.nombre),
    v_fila.empresa_id
  );
end;
$$;

comment on function public.dar_baja_costo_adicional(uuid) is
  'F-REN-08: da de baja (activo = false) un costo adicional; idempotente. 42501 sin edición, P0002 si no existe.';

revoke execute on function public.listar_costos_adicionales(uuid) from public, anon;
revoke execute on function public.guardar_costo_adicional(uuid, uuid, text, text, numeric) from public, anon;
revoke execute on function public.dar_baja_costo_adicional(uuid) from public, anon;
grant execute on function public.listar_costos_adicionales(uuid) to authenticated;
grant execute on function public.guardar_costo_adicional(uuid, uuid, text, text, numeric) to authenticated;
grant execute on function public.dar_baja_costo_adicional(uuid) to authenticated;
