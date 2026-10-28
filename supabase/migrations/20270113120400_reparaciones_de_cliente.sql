-- F-SVC-15 (MSF-429, épica MSF-232): reparaciones de un cliente para la pestaña de su ficha.
-- Esquema: sin tablas nuevas (Principio VII); lee `dominio.reparaciones` y sus catálogos, apoyada en
-- `reparaciones_cliente_idx`.
--
-- `public.reparaciones_de_cliente(cliente, empresa, pagina, tamano)` devuelve `{ total_filas, filas[] }`.
-- Es SECURITY DEFINER (igual que `listar_reparaciones`): el rol de Service puede no tener la sección
-- Clientes y la RLS de `public.clientes` ocultaría el cliente. Aplica a mano el límite de la RLS de
-- `reparaciones`: organización del llamador, al menos `lectura` en `service_tecnico` y tiendas de
-- `private.empresas_accesibles()`. Nunca devuelve costos internos.
-- Orden: ingreso descendente, luego número descendente. Página 1-based, tamaño 1…200 (25 por defecto).
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.reparaciones_de_cliente(uuid, uuid, integer, integer);

create or replace function public.reparaciones_de_cliente(
  p_cliente uuid,
  p_empresa uuid default null,
  p_pagina integer default 1,
  p_tamano integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_tamano integer := least(greatest(coalesce(p_tamano, 25), 1), 200);
  v_pagina integer := least(greatest(coalesce(p_pagina, 1), 1), 100000);
  v_resultado jsonb;
begin
  if v_org is null or (select private.nivel_seccion('service_tecnico')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver reparaciones' using errcode = '42501';
  end if;

  with filtradas as (
    select r.*
      from dominio.reparaciones r
     where r.organizacion_id = v_org
       and r.cliente_id = p_cliente
       and r.empresa_id in (select private.empresas_accesibles())
       and (p_empresa is null or r.empresa_id = p_empresa)
  )
  select jsonb_build_object(
    'total_filas', (select count(*) from filtradas),
    'filas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id,
        'numero', private.codigo_reparacion(f.numero),
        'empresa', e.nombre,
        'equipo', m.equipo,
        'modelo', m.modelo,
        'estado', s.nombre,
        'estado_tono', s.tono,
        'ingreso_en', f.ingreso_en,
        'entrega_prevista', f.entrega_prevista,
        'total', f.total_mano_obra + f.total_repuestos
      ) order by f.ingreso_en desc, f.numero desc, f.id)
      from (
        select * from filtradas order by ingreso_en desc, numero desc, id
        limit v_tamano offset (v_pagina - 1) * v_tamano
      ) f
      left join dominio.empresas e on e.id = f.empresa_id
      left join dominio.modelos_equipo m on m.id = f.modelo_id and m.organizacion_id = f.organizacion_id
      left join dominio.estados_reparacion s on s.id = f.estado_id and s.organizacion_id = f.organizacion_id
    ), '[]'::jsonb)
  ) into v_resultado;

  return v_resultado;
end;
$$;

comment on function public.reparaciones_de_cliente(uuid, uuid, integer, integer) is
  'F-SVC-15: reparaciones de un cliente (pestaña de la ficha), paginadas, por tienda accesible. Sin costos internos.';

revoke execute on function public.reparaciones_de_cliente(uuid, uuid, integer, integer) from public, anon;
grant execute on function public.reparaciones_de_cliente(uuid, uuid, integer, integer) to authenticated;
