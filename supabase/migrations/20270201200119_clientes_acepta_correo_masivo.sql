-- F-CLI-11 (MSF-357, épica MSF-155, spec 20261028-100000-correo-masivo-a-clientes): destinatarios del correo masivo.
-- FR-001, FR-004, FR-006.
--
-- Esquemas (Principio VII, re-verificado): no se crea ninguna tabla. `public.clientes` es preexistente y vive en
-- `public` por excepción documentada (docs/clientes.md); mover la tabla no es aditivo, así que solo se le suma una
-- columna. Las dos funciones nuevas son de lectura (`security invoker`): heredan la RLS de `clientes`,
-- `clientes_empresas` y `cuentas_cliente` (organización + sección `clientes`).
--
-- Aditiva: `acepta_correo_masivo boolean not null default false`. Los clientes existentes quedan SIN aceptación
-- hasta que se los marque (sin consentimiento previo); el alta nueva nace encendida desde el formulario (prototipo).
--
-- Elegibles (FR-004): clientes activos (no archivados, y nunca el Consumidor final del mostrador), con aceptación y con un correo válido (una sola
-- dirección: se rechazan `,` y `;` para no escribirle a más de una persona por campo).
-- El resumen reparte a los clientes activos que cumplen los filtros en tres grupos que suman el total:
-- `sin_correo` (sin correo válido, acepte o no), `no_aceptan` (con correo válido pero sin aceptación) y `elegibles`.
--
-- Armar destinatarios exige edición en `clientes` (FR-006): con lectura la función rechaza con 42501.
--
-- Reversión (en una migración posterior, no en este PR):
--   drop function public.resumen_destinatarios_correo_masivo(text, text, uuid, boolean, uuid[]);
--   drop function public.listar_destinatarios_correo_masivo(text, text, uuid, boolean, uuid[], integer, integer);
--   drop function private.clientes_para_correo_masivo(text, text, uuid, boolean, uuid[]);
--   alter table public.clientes drop column acepta_correo_masivo;

alter table public.clientes
  add column if not exists acepta_correo_masivo boolean not null default false;

comment on column public.clientes.acepta_correo_masivo is
  'El cliente acepta recibir el correo masivo (F-CLI-11). Falso por defecto; la baja desde el correo (F-CLI-12) lo apaga.';

grant insert (acepta_correo_masivo) on public.clientes to authenticated;
grant update (acepta_correo_masivo) on public.clientes to authenticated;

-- ============================================================================
-- Filtros del grupo: los mismos del listado de Clientes (búsqueda, tipo, empresa,
-- «con cuenta web») más la selección manual (`p_clientes`). Solo clientes activos;
-- la elegibilidad (aceptación y correo) la aplican las funciones públicas.
-- ============================================================================

create or replace function private.clientes_para_correo_masivo(
  p_texto text,
  p_tipo text,
  p_empresa uuid,
  p_con_cuenta_web boolean,
  p_clientes uuid[]
)
returns setof public.clientes
language sql
stable
security invoker
set search_path = ''
as $$
  select c.*
    from public.clientes c
   where c.organizacion_id = (select private.organizacion_id())
     and c.archivado_en is null
     -- El Consumidor final es del mostrador, no una persona a quien escribirle.
     and not c.es_consumidor_final
     and (p_tipo is null or c.tipo = p_tipo)
     and (p_clientes is null or c.id = any (p_clientes))
     and (p_empresa is null or exists (
           select 1 from public.clientes_empresas ce
            where ce.cliente_id = c.id and ce.empresa_id = p_empresa))
     and (not coalesce(p_con_cuenta_web, false) or exists (
           select 1 from public.cuentas_cliente cc
            where cc.cliente_id = c.id and cc.estado = 'activa'
              and (p_empresa is null or cc.empresa_id = p_empresa)
              and exists (
                select 1 from public.clientes_empresas ce
                 where ce.cliente_id = c.id and ce.empresa_id = cc.empresa_id)))
     -- Mismo texto que `buscar_clientes`: se busca literal (se escapan \ % _).
     and (btrim(coalesce(p_texto, '')) = '' or lower(coalesce(c.nombre, '') || ' ' || coalesce(c.documento, '') || ' '
          || coalesce(c.correo, '') || ' ' || coalesce(c.telefono, '') || ' ' || coalesce(c.celular, '') || ' '
          || coalesce(c.localidad, '') || ' ' || coalesce(c.expreso_preferido, '') || ' ' || c.numero::text)
          like '%' || replace(replace(replace(lower(btrim(p_texto)), '\', '\\'), '%', '\%'), '_', '\_') || '%')
$$;

comment on function private.clientes_para_correo_masivo(text, text, uuid, boolean, uuid[]) is
  'Clientes activos que cumplen los filtros del correo masivo (F-CLI-11). Sin chequear aceptación ni correo. Security invoker: hereda la RLS.';

revoke execute on function private.clientes_para_correo_masivo(text, text, uuid, boolean, uuid[]) from public, anon;
grant execute on function private.clientes_para_correo_masivo(text, text, uuid, boolean, uuid[]) to authenticated;

-- ============================================================================
-- Lista paginada de destinatarios elegibles.
-- ============================================================================

create or replace function public.listar_destinatarios_correo_masivo(
  p_texto text default null,
  p_tipo text default null,
  p_empresa uuid default null,
  p_con_cuenta_web boolean default false,
  p_clientes uuid[] default null,
  p_pagina integer default 1,
  p_tamano integer default 25
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tamano integer := least(greatest(coalesce(p_tamano, 25), 1), 100);
  v_pagina integer := least(greatest(coalesce(p_pagina, 1), 1), 100000);
  v_total bigint;
  v_filas jsonb;
begin
  if (select private.nivel_seccion('clientes')) <> 'edicion' then
    raise exception 'Tu rol no puede armar el correo masivo' using errcode = '42501';
  end if;

  select count(*) into v_total
    from private.clientes_para_correo_masivo(p_texto, p_tipo, p_empresa, p_con_cuenta_web, p_clientes) c
   where c.acepta_correo_masivo
     and c.correo ~ '^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$';

  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'numero', f.numero, 'nombre', f.nombre, 'correo', f.correo)
                            order by lower(f.nombre), f.id), '[]'::jsonb)
    into v_filas
    from (
      select c.id, c.numero, c.nombre, c.correo
        from private.clientes_para_correo_masivo(p_texto, p_tipo, p_empresa, p_con_cuenta_web, p_clientes) c
       where c.acepta_correo_masivo
         and c.correo ~ '^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$'
       order by lower(c.nombre), c.id
       limit v_tamano offset (v_pagina - 1) * v_tamano
    ) f;

  return jsonb_build_object('total', v_total, 'filas', v_filas);
end;
$$;

comment on function public.listar_destinatarios_correo_masivo(text, text, uuid, boolean, uuid[], integer, integer) is
  'Destinatarios elegibles del correo masivo (F-CLI-11): activos, con aceptación y con correo válido, con los filtros del listado de Clientes. Exige edición en clientes. Devuelve {total, filas:[{id, numero, nombre, correo}]}.';

revoke execute on function public.listar_destinatarios_correo_masivo(text, text, uuid, boolean, uuid[], integer, integer) from public, anon;
grant execute on function public.listar_destinatarios_correo_masivo(text, text, uuid, boolean, uuid[], integer, integer) to authenticated;

-- ============================================================================
-- Resumen: cuántos quedan y cuántos quedan afuera, y por qué.
-- ============================================================================

create or replace function public.resumen_destinatarios_correo_masivo(
  p_texto text default null,
  p_tipo text default null,
  p_empresa uuid default null,
  p_con_cuenta_web boolean default false,
  p_clientes uuid[] default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_resultado jsonb;
begin
  if (select private.nivel_seccion('clientes')) <> 'edicion' then
    raise exception 'Tu rol no puede armar el correo masivo' using errcode = '42501';
  end if;

  select jsonb_build_object(
           'elegibles', count(*) filter (where tiene_correo and c.acepta_correo_masivo),
           'sin_correo', count(*) filter (where not tiene_correo),
           'no_aceptan', count(*) filter (where tiene_correo and not c.acepta_correo_masivo))
    into v_resultado
    from private.clientes_para_correo_masivo(p_texto, p_tipo, p_empresa, p_con_cuenta_web, p_clientes) c
   cross join lateral (select coalesce(c.correo ~ '^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$', false) as tiene_correo) t;

  return v_resultado;
end;
$$;

comment on function public.resumen_destinatarios_correo_masivo(text, text, uuid, boolean, uuid[]) is
  'Resumen del grupo del correo masivo (F-CLI-11): {elegibles, sin_correo, no_aceptan} sobre los clientes activos que cumplen los filtros; los tres suman el total. Exige edición en clientes.';

revoke execute on function public.resumen_destinatarios_correo_masivo(text, text, uuid, boolean, uuid[]) from public, anon;
grant execute on function public.resumen_destinatarios_correo_masivo(text, text, uuid, boolean, uuid[]) to authenticated;
