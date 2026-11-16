-- F-PRE-07 (MSF-172, épica MSF-114): guardar la regla de precio de una empresa.
-- Esquema: sin tablas nuevas (RPC en `public`, disparador de actividad; Principio VII).
--
-- `public.guardar_regla_precio_empresa` es SECURITY INVOKER: rigen las políticas del llamador.
-- Bloqueo optimista: el llamador envía el `updated_at` que leyó (null si la empresa no tenía
-- regla); si la fila cambió desde entonces se rechaza con 40001. Es idempotente: pedir lo que
-- ya está guardado devuelve la fila sin conflicto, sin tocar `updated_at` ni generar evento.
--
-- Errores: 42501 sin permiso · 23514 base o ajuste inválidos · P0002 empresa inexistente ·
-- 40001 conflicto de edición · 22003 ajuste fuera de rango.
--
-- El evento `empresa.regla_precio_actualizada` lo registra un disparador SECURITY DEFINER
-- (`private.insertar_actividad` no es ejecutable por el llamador), solo ante un cambio real.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.guardar_regla_precio_empresa(uuid, text, numeric, timestamptz);
--   drop trigger precios_empresa_registrar on dominio.precios_empresa;
--   drop function private.registrar_regla_precio_empresa();
--   drop function private.describir_regla_precio(text, numeric);

create or replace function private.describir_regla_precio(p_base text, p_ajuste numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_base = 'central_ajuste' then
      'Central con ajuste '
      || case when p_ajuste > 0 then '+' else '' end
      || replace(trim_scale(p_ajuste)::text, '.', ',') || ' %'
    else 'Igual al central'
  end;
$$;

revoke execute on function private.describir_regla_precio(text, numeric) from public, anon, authenticated;

create or replace function private.registrar_regla_precio_empresa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_antes text := case when tg_op = 'UPDATE' then private.describir_regla_precio(old.base, old.ajuste_pct)
                       else private.describir_regla_precio('central', 0) end;
  v_despues text := private.describir_regla_precio(new.base, new.ajuste_pct);
  v_nombre text;
begin
  if v_actor is null or v_antes = v_despues then
    return new;
  end if;
  select e.nombre into v_nombre from dominio.empresas e where e.id = new.empresa_id;
  perform private.insertar_actividad(
    new.organizacion_id, v_actor, 'empresa.regla_precio_actualizada',
    format('Cambió la regla de precio de %s: %s → %s', coalesce(v_nombre, 'la empresa'), v_antes, v_despues),
    new.empresa_id
  );
  return new;
end;
$$;

revoke execute on function private.registrar_regla_precio_empresa() from public, anon, authenticated;

create trigger precios_empresa_registrar
  after insert or update on dominio.precios_empresa
  for each row execute function private.registrar_regla_precio_empresa();

create or replace function public.guardar_regla_precio_empresa(
  p_empresa uuid,
  p_base text,
  p_ajuste_pct numeric default 0,
  p_updated_at timestamptz default null
)
returns dominio.precios_empresa
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_ajuste numeric;
  v_actual dominio.precios_empresa;
  v_fila dominio.precios_empresa;
begin
  if v_organizacion is null or (select private.nivel_seccion('empresas')) <> 'edicion' then
    raise exception 'Tu rol no puede editar los precios de la empresa' using errcode = '42501';
  end if;
  if p_base is null or p_base not in ('central', 'central_ajuste') then
    raise exception 'Elegí una base de precio válida' using errcode = '23514';
  end if;
  -- Con «Igual al central» el ajuste no rige: se guarda en 0 (resultado determinista).
  v_ajuste := case when p_base = 'central' then 0 else p_ajuste_pct end;
  if v_ajuste is null or v_ajuste <= -100 or v_ajuste <> round(v_ajuste, 3) then
    raise exception 'El ajuste debe ser mayor a −100 %% y tener hasta 3 decimales' using errcode = '23514';
  end if;
  if abs(v_ajuste) >= 10000 then
    raise exception 'El ajuste es demasiado grande' using errcode = '22003';
  end if;

  if not exists (
    select 1 from dominio.empresas e where e.id = p_empresa and e.organizacion_id = v_organizacion
  ) then
    raise exception 'La empresa no existe en tu organización' using errcode = 'P0002';
  end if;

  select * into v_actual from dominio.precios_empresa r where r.empresa_id = p_empresa for update;

  if not found then
    if p_updated_at is not null then
      raise exception 'La regla de precio fue modificada por otra persona' using errcode = '40001';
    end if;
    begin
      insert into dominio.precios_empresa (empresa_id, organizacion_id, base, ajuste_pct)
      values (p_empresa, v_organizacion, p_base, v_ajuste)
      returning * into v_fila;
    exception when unique_violation then
      -- Otra persona creó la regla entre la lectura y este insert.
      raise exception 'La regla de precio fue modificada por otra persona' using errcode = '40001';
    end;
    return v_fila;
  end if;

  -- Idempotente: lo pedido ya está guardado.
  if (v_actual.base, v_actual.ajuste_pct) is not distinct from (p_base, v_ajuste) then
    return v_actual;
  end if;
  if p_updated_at is null or v_actual.updated_at <> p_updated_at then
    raise exception 'La regla de precio fue modificada por otra persona' using errcode = '40001';
  end if;

  update dominio.precios_empresa
     set base = p_base, ajuste_pct = v_ajuste
   where empresa_id = p_empresa
  returning * into v_fila;
  return v_fila;
end;
$$;

comment on function public.guardar_regla_precio_empresa(uuid, text, numeric, timestamptz) is
  'F-PRE-07: guarda la regla de precio neto de una empresa (solo Administrador). 42501 sin permiso, 23514 inválido, P0002 empresa inexistente, 40001 conflicto de edición.';

revoke execute on function public.guardar_regla_precio_empresa(uuid, text, numeric, timestamptz) from public, anon;
grant execute on function public.guardar_regla_precio_empresa(uuid, text, numeric, timestamptz) to authenticated;
