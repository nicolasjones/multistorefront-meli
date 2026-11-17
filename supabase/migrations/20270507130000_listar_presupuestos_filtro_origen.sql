-- MSF-942 · Filtro por canal (panel / tienda online) en Ventas › Presupuestos. Seguimiento de MSF-176 (T063).
--
-- `public.listar_presupuestos` suma un sexto parámetro `p_origen text default null`: `null` = todos; `'panel'` = presupuestos que NO tienen el vínculo con una cuenta de la tienda;
-- `'tienda'` = los que sí lo tienen (`dominio.presupuestos_tienda`, que solo escribe `publico.crear_presupuesto_tienda`). Se filtra por el VÍNCULO real y no por `canal` ni por
-- un operador nulo (misma razón que M-1 de `20270322100500`). El filtro entra en el CTE `base`, ANTES de `count(*) over ()`: `filas` y la paginación cuentan solo lo filtrado.
-- Otro valor falla con 22023 (hint 'origen'), igual que un estado desconocido.
--
-- Cambio de firma: no se puede usar `create or replace` (agregar un parámetro crea una sobrecarga y una llamada con los cinco argumentos de siempre quedaría ambigua). Se quita la de
-- cinco parámetros y se crea la de seis; los clientes llaman por nombre (`p_busqueda`, `p_estado`, `p_empresa_id`, `p_pagina`, `p_tamano`), así que las llamadas existentes siguen
-- valiendo. Cuerpo = el de `20270322100500` (la definición vigente) más el filtro; mismas columnas, mismos grants (`revoke … from public, anon`; `grant … to authenticated`).
--
-- Esquema (Principio VII): sin tablas. Migración con reversión: crear de nuevo la función de cinco parámetros con el cuerpo de `20270322100500_listar_presupuestos_origen_tienda.sql`
-- y quitar la de seis (`drop function public.listar_presupuestos(text, text, uuid, integer, integer, text)`).

drop function if exists public.listar_presupuestos(text, text, uuid, integer, integer);

create function public.listar_presupuestos(
  p_busqueda text default null,
  p_estado text default null,
  p_empresa_id uuid default null,
  p_pagina integer default 1,
  p_tamano integer default 10,
  p_origen text default null
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
  v_origen text := nullif(btrim(coalesce(p_origen, '')), '');
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
  if v_origen is not null and v_origen not in ('panel', 'tienda') then
    raise exception 'El origen % no existe: usá panel o tienda', v_origen using errcode = '22023', hint = 'origen';
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
           case when exists (select 1 from dominio.presupuestos_tienda pt where pt.comprobante_id = c.id and pt.organizacion_id = c.organizacion_id)
                then 'Tienda online (cliente)'
                else coalesce(nullif(btrim(concat_ws(' ', p.nombre, p.apellido)), ''), 'Usuario sin nombre') end as operador,
           c.valido_hasta,
           case when c.estado = 'pendiente' and c.valido_hasta is not null and c.valido_hasta < v_hoy
                then 'vencido' else c.estado end as estado,
           c.total_con_iva as total,
           v.nivel = 'edicion' as puede_editar
      from dominio.comprobantes_venta c
      join visibles v on v.id = c.empresa_id and v.nivel in ('lectura', 'edicion')
      join dominio.clientes cl on cl.id = c.cliente_id and cl.organizacion_id = c.organizacion_id
      left join public.perfiles_usuario p on p.user_id = c.operador_id
     where c.organizacion_id = v_org
       and c.tipo = 'presupuesto'
       and (p_empresa_id is null or c.empresa_id = p_empresa_id)
       and (v_origen is null
            or (v_origen = 'tienda' and exists (select 1 from dominio.presupuestos_tienda pt where pt.comprobante_id = c.id and pt.organizacion_id = c.organizacion_id))
            or (v_origen = 'panel' and not exists (select 1 from dominio.presupuestos_tienda pt where pt.comprobante_id = c.id and pt.organizacion_id = c.organizacion_id)))
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

revoke execute on function public.listar_presupuestos(text, text, uuid, integer, integer, text) from public, anon;
grant execute on function public.listar_presupuestos(text, text, uuid, integer, integer, text) to authenticated;

comment on function public.listar_presupuestos(text, text, uuid, integer, integer, text) is
  'Presupuestos paginados con búsqueda, filtro de estado, de tienda y de origen (p_origen: null = todos, panel o tienda, según el vínculo dominio.presupuestos_tienda); vencido derivado de valido_hasta (F-VTA-08, FR-053/FR-055; MSF-942). Solo empresas con ventas en lectura o edición.';
