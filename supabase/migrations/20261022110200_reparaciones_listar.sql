-- F-SVC-04 (MSF-342, épica MSF-199): listado paginado de reparaciones con filtros.
-- Esquema: sin tablas nuevas (Principio VII); lee `dominio.reparaciones` y sus catálogos.
--
-- `public.listar_reparaciones(empresa, periodo, serie, tecnico, pagina, tamano)` devuelve
-- `{ total_filas, filas[] }`. Es SECURITY DEFINER (igual que `obtener_reparacion`) y no `invoker`: el
-- cliente vive en `public.clientes`, cuya RLS exige la sección Clientes, que un rol de Service puede no
-- tener; con `invoker` esas filas desaparecerían del listado. En su lugar la función aplica a mano
-- exactamente el límite de la RLS de `reparaciones`: organización del llamador, al menos `lectura` en
-- `service_tecnico` y tiendas de `private.empresas_accesibles()`. Nunca devuelve costos internos.
--
-- Período (sobre la entrega prevista; «hoy» en zona Argentina):
--   hoy    = entrega_prevista = hoy
--   semana = hoy … hoy + 6
--   mes    = mes calendario en curso, MÁS las reparaciones sin entrega prevista
-- La búsqueda por N.º de serie (parcial, sin distinguir mayúsculas) ignora el período.
-- Orden: ingreso descendente, luego número descendente. Página 1-based, tamaño 1…200 (25 por defecto).
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.listar_reparaciones(uuid, text, text, uuid, integer, integer);

create or replace function public.listar_reparaciones(
  p_empresa uuid default null,
  p_periodo text default 'mes',
  p_serie text default null,
  p_tecnico uuid default null,
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
  v_serie text := nullif(btrim(coalesce(p_serie, '')), '');
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_desde date;
  v_hasta date;
  v_con_sin_fecha boolean := false;
  v_resultado jsonb;
begin
  if v_org is null or (select private.nivel_seccion('service_tecnico')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver reparaciones' using errcode = '42501';
  end if;
  if p_periodo is null or p_periodo not in ('hoy', 'semana', 'mes') then
    raise exception 'Elegí un período: hoy, semana o mes.' using errcode = '22023', hint = 'periodo';
  end if;

  if p_periodo = 'hoy' then
    v_desde := v_hoy;
    v_hasta := v_hoy;
  elsif p_periodo = 'semana' then
    v_desde := v_hoy;
    v_hasta := v_hoy + 6;
  else
    v_desde := date_trunc('month', v_hoy)::date;
    v_hasta := (date_trunc('month', v_hoy) + interval '1 month - 1 day')::date;
    v_con_sin_fecha := true;
  end if;

  with filtradas as (
    select r.*
      from dominio.reparaciones r
     where r.organizacion_id = v_org
       and r.empresa_id in (select private.empresas_accesibles())
       and (p_empresa is null or r.empresa_id = p_empresa)
       and (p_tecnico is null or r.tecnico_id = p_tecnico)
       and (
         case
           when v_serie is not null then
             lower(r.numero_serie) like '%' || replace(replace(replace(lower(v_serie), '\', '\\'), '%', '\%'), '_', '\_') || '%'
           else
             (r.entrega_prevista between v_desde and v_hasta)
             or (v_con_sin_fecha and r.entrega_prevista is null)
         end
       )
  )
  select jsonb_build_object(
    'total_filas', (select count(*) from filtradas),
    'filas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id,
        'numero', f.numero,
        'codigo', private.codigo_reparacion(f.numero),
        'ingreso_en', f.ingreso_en,
        'empresa_id', f.empresa_id,
        'empresa', e.nombre,
        'cliente', c.nombre,
        'equipo', m.equipo,
        'modelo', m.modelo,
        'numero_serie', f.numero_serie,
        'estado', s.nombre,
        'estado_tono', s.tono,
        'tecnico_id', f.tecnico_id,
        'tecnico', case when f.tecnico_id is null then null
          else coalesce(nullif(btrim(concat_ws(' ', p.nombre, p.apellido)), ''), 'Técnico sin nombre') end,
        'entrega_prevista', f.entrega_prevista,
        'total_cliente', f.total_mano_obra + f.total_repuestos
      ) order by f.ingreso_en desc, f.numero desc, f.id)
      from (
        select * from filtradas order by ingreso_en desc, numero desc, id
        limit v_tamano offset (v_pagina - 1) * v_tamano
      ) f
      left join dominio.empresas e on e.id = f.empresa_id
      left join public.clientes c on c.id = f.cliente_id and c.organizacion_id = f.organizacion_id
      left join dominio.modelos_equipo m on m.id = f.modelo_id and m.organizacion_id = f.organizacion_id
      left join dominio.estados_reparacion s on s.id = f.estado_id and s.organizacion_id = f.organizacion_id
      left join public.perfiles_usuario p on p.user_id = f.tecnico_id
    ), '[]'::jsonb)
  ) into v_resultado;

  return v_resultado;
end;
$$;

comment on function public.listar_reparaciones(uuid, text, text, uuid, integer, integer) is
  'F-SVC-04: reparaciones paginadas con filtros (tienda, período sobre la entrega prevista, N.º de serie, técnico). Sin costos internos.';

revoke execute on function public.listar_reparaciones(uuid, text, text, uuid, integer, integer) from public, anon;
grant execute on function public.listar_reparaciones(uuid, text, text, uuid, integer, integer) to authenticated;
