-- Actividad: `empresa.creada` al crear una empresa (F-EMP-03 + F-AUD-01/02).
-- `public.crear_empresa` registra el evento en la MISMA transacción del alta con
-- `private.insertar_actividad` (si el alta revierte, el evento también). Detalle legible, sin UUID
-- visibles; tipo no sensible en el catálogo `public.tipos_evento_actividad`.
-- Esquema (Principio VII): sin tablas nuevas; la función es de plataforma/acceso (`public`).
-- Migración aditiva (solo `create or replace` y una fila de catálogo). Reversión:
--   volver a aplicar `crear_empresa` de 20261015110000_alta_de_empresas.sql y
--   delete from public.tipos_evento_actividad where tipo = 'empresa.creada';  -- solo si no quedan eventos

insert into public.tipos_evento_actividad (tipo, sensible, descripcion)
values ('empresa.creada', false, 'Empresa creada')
on conflict (tipo) do nothing;

create or replace function public.crear_empresa(p_nombre text, p_copiar_de uuid default null)
returns dominio.empresas
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion_id uuid := (select private.organizacion_id());
  v_nombre text := btrim(coalesce(p_nombre, ''));
  v_fila dominio.empresas;
  v_origen text;
begin
  if v_organizacion_id is null or not (select private.puede_escribir()) then
    raise exception 'Solo un administrador puede crear empresas' using errcode = '42501';
  end if;

  if v_nombre = '' then
    raise exception 'El nombre de la empresa es obligatorio' using errcode = '22023';
  end if;
  if char_length(v_nombre) > 120 then
    raise exception 'El nombre no puede superar los 120 caracteres' using errcode = '22023';
  end if;

  if p_copiar_de is not null then
    select e.nombre into v_origen
      from dominio.empresas e
     where e.id = p_copiar_de and e.organizacion_id = v_organizacion_id;
    if not found then
      raise exception 'La empresa de origen no es válida' using errcode = '22023';
    end if;
  end if;

  begin
    insert into dominio.empresas (organizacion_id, nombre)
    values (v_organizacion_id, v_nombre)
    returning * into v_fila;
  exception when unique_violation then
    raise exception 'Ya existe una empresa con ese nombre' using errcode = '23505';
  end;

  if p_copiar_de is not null then
    perform private.copiar_configuracion_empresa(p_copiar_de, v_fila.id);
  end if;

  perform private.insertar_actividad(
    v_organizacion_id, (select auth.uid()), 'empresa.creada',
    case when v_origen is null
      then format('Creó la empresa «%s»', v_nombre)
      else format('Creó la empresa «%s» copiando la configuración de «%s»', v_nombre, v_origen) end,
    v_fila.id);

  return v_fila;
end;
$$;

comment on function public.crear_empresa(text, uuid) is
  'F-EMP-03: el administrador activo crea una empresa en SU organización, opcionalmente copiando la configuración de otra de la misma organización (atómico) y registra `empresa.creada`. Único camino de alta.';

revoke execute on function public.crear_empresa(text, uuid) from public, anon;
grant execute on function public.crear_empresa(text, uuid) to authenticated;
