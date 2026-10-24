-- F-VTA-08 (MSF-331, épica MSF-159, spec 20261023-100000-ventas-comprobantes, FR-053, FR-055):
-- `listar_presupuestos`, la pantalla Presupuestos paginada en el servidor.
--
-- Esquema (Principio VII): sin tablas nuevas; función de lectura sobre `dominio.comprobantes_venta`
-- (dominio), `dominio.empresas`, `public.clientes` y `public.perfiles_usuario` (nombre del operador).
--
-- Seguridad: `security definer` (para leer el nombre del operador, que la RLS de perfiles no deja ver a
-- todos) con `search_path = ''`. La organización sale de la sesión. Solo devuelve presupuestos de empresas
-- donde el usuario tiene `ventas` en `lectura` o `edicion` (`private.nivel_ventas_en_empresa`): una
-- empresa ajena devuelve cero filas, no un error que delate su existencia. `puede_editar` indica `edicion`
-- en la empresa de la fila (la UI solo ofrece Aceptar/Copiar con él; la autoridad sigue siendo la RPC).
--
-- Estado: `vencido` se DERIVA de `valido_hasta` < hoy en `pendiente` (FR-055); no se guarda ni hay job.
-- Filtro `p_estado`: pendiente | aceptado | vencido | convertido (null = todos); `pendiente` excluye a los
-- vencidos. Búsqueda por cliente o número, sin mayúsculas ni tildes, con el texto literal (se escapan \ % _).
-- Orden estable: fecha desc, número desc, id. Tope 200 por página; una página fuera de rango no devuelve filas.
-- `filas` es el total del filtro actual (para la paginación).
--
-- Errores: 22023 estado de filtro desconocido.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.listar_presupuestos(text, text, uuid, integer, integer);

create or replace function public.listar_presupuestos(
  p_busqueda text default null,
  p_estado text default null,
  p_empresa_id uuid default null,
  p_pagina integer default 1,
  p_tamano integer default 10
)
returns table (
  id uuid,
  numero text,
  empresa_id uuid,
  empresa text,
  fecha date,
  cliente text,
  operador text,
  valido_hasta date,
  estado text,
  total numeric,
  puede_editar boolean,
  filas bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_texto text := btrim(coalesce(p_busqueda, ''));
  v_patron text;
  v_estado text := nullif(btrim(coalesce(p_estado, '')), '');
  v_hoy date := (select private.hoy_argentina());
  v_tamano integer := least(greatest(coalesce(p_tamano, 10), 1), 200);
  v_pagina integer := least(greatest(coalesce(p_pagina, 1), 1), 100000);
begin
  if v_org is null or (select auth.uid()) is null then
    raise exception 'Necesitás una sesión con organización para ver presupuestos' using errcode = '42501';
  end if;
  if v_estado is not null and v_estado not in ('pendiente', 'aceptado', 'vencido', 'convertido') then
    raise exception 'El estado % no existe: usá pendiente, aceptado, vencido o convertido', v_estado using errcode = '22023', hint = 'estado';
  end if;
  if v_texto <> '' then
    v_patron := '%' || replace(replace(replace(translate(lower(v_texto), 'áéíóúü', 'aeiouu'), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return query
  with visibles as (
    select e.id, e.nombre,
           (select private.nivel_ventas_en_empresa(e.id)) as nivel
      from dominio.empresas e
     where e.organizacion_id = v_org
  ),
  base as (
    select c.id, c.numero, c.numero_entero, c.empresa_id, v.nombre as empresa, c.fecha,
           cl.nombre as cliente,
           coalesce(nullif(btrim(concat_ws(' ', p.nombre, p.apellido)), ''), 'Usuario sin nombre') as operador,
           c.valido_hasta,
           case when c.estado = 'pendiente' and c.valido_hasta is not null and c.valido_hasta < v_hoy
                then 'vencido' else c.estado end as estado,
           c.total_con_iva as total,
           v.nivel = 'edicion' as puede_editar
      from dominio.comprobantes_venta c
      join visibles v on v.id = c.empresa_id and v.nivel in ('lectura', 'edicion')
      join public.clientes cl on cl.id = c.cliente_id and cl.organizacion_id = c.organizacion_id
      left join public.perfiles_usuario p on p.user_id = c.operador_id
     where c.organizacion_id = v_org
       and c.tipo = 'presupuesto'
       and (p_empresa_id is null or c.empresa_id = p_empresa_id)
       and (v_patron is null
            or translate(lower(cl.nombre), 'áéíóúü', 'aeiouu') like v_patron
            or lower(c.numero) like v_patron
            or coalesce(c.numero_entero::text, '') like v_patron)
  )
  select b.id, b.numero, b.empresa_id, b.empresa, b.fecha, b.cliente, b.operador, b.valido_hasta, b.estado, b.total,
         b.puede_editar, count(*) over () as filas
    from base b
   where v_estado is null or b.estado = v_estado
   order by b.fecha desc, b.numero_entero desc nulls last, b.id
   limit v_tamano
  offset (v_pagina - 1) * v_tamano;
end;
$$;

revoke execute on function public.listar_presupuestos(text, text, uuid, integer, integer) from public, anon;
grant execute on function public.listar_presupuestos(text, text, uuid, integer, integer) to authenticated;

comment on function public.listar_presupuestos(text, text, uuid, integer, integer) is
  'Presupuestos paginados con búsqueda, filtro de estado y de tienda; vencido derivado de valido_hasta (F-VTA-08, FR-053/FR-055). Solo empresas con ventas en lectura o edición.';
