-- F-VTA-30 (MSF-320, épica MSF-178, FR-023): `listar_rma` devuelve también el vínculo de la resolución: la nota de crédito
-- asociada (`nota_credito_id`, `nota_credito_numero`) y si el stock fue reingresado (`stock_reingresado`).
--
-- Esquema (Principio VII): sin tablas nuevas; solo funciones. Lee las mismas tablas que la versión anterior y suma
-- `dominio.comprobantes_venta` (la nota, por `nota_credito_id`).
-- Seguridad: idéntica a la versión anterior (`security invoker` + puente `security definer` que deriva organización y
-- empresas del JWT, `revoke … from public, anon`, `grant … to authenticated`).
--
-- Cambiar las columnas de retorno obliga a recrear las funciones: `drop function` de las dos y `create` (no se toca ninguna
-- tabla ni columna). Migración sin pérdida de datos. Reversión (migración posterior): recrear ambas funciones con la
-- definición de 20270113110100_listar_rma_actualizado_en.sql.

drop function if exists public.listar_rma(text, text, text, uuid, integer, integer);
drop function if exists private.listar_rma_sesion(text, text, text, uuid, integer, integer);

create or replace function private.listar_rma_sesion(
  p_busqueda text,
  p_forma_rma text,
  p_estado text,
  p_empresa_id uuid,
  p_limite integer,
  p_desde integer
)
returns table (
  id uuid,
  numero text,
  creado_en timestamptz,
  actualizado_en timestamptz,
  nota_credito_id uuid,
  nota_credito_numero text,
  stock_reingresado boolean,
  empresa_id uuid,
  empresa text,
  comprobante_id uuid,
  comprobante_numero text,
  cliente text,
  producto text,
  cantidad bigint,
  forma_rma text,
  motivo text,
  operador text,
  estado text,
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
  v_forma text := nullif(btrim(coalesce(p_forma_rma, '')), '');
  v_estado text := nullif(btrim(coalesce(p_estado, '')), '');
  v_empresas uuid[];
begin
  if v_org is null or (select auth.uid()) is null then
    raise exception 'Necesitás una sesión con organización para ver devoluciones' using errcode = '42501';
  end if;
  if v_forma is not null
     and v_forma not in ('cambio_directo', 'enviado_a_proveedor', 'faltante_envio', 'reclamo_faltante', 'devolucion_importe') then
    raise exception 'La forma de RMA % no existe', v_forma using errcode = '22023', hint = 'forma_rma';
  end if;
  if v_estado is not null and v_estado not in ('abierto', 'en_gestion', 'cerrado') then
    raise exception 'El estado % no existe', v_estado using errcode = '22023', hint = 'estado';
  end if;
  if v_texto <> '' then
    v_patron := '%' || replace(replace(replace(translate(lower(v_texto), 'áéíóúü', 'aeiouu'), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  select coalesce(array_agg(e.id), '{}') into v_empresas
    from dominio.empresas e
   where e.organizacion_id = v_org
     and (select private.nivel_ventas_en_empresa(e.id)) in ('lectura', 'edicion');

  return query
  select r.id, r.numero, r.creado_en, r.actualizado_en, r.nota_credito_id, nc.numero, r.stock_reingresado_en is not null, r.empresa_id, e.nombre, r.comprobante_id, c.numero, cl.nombre,
         case when it.n > 1 then it.primero || ' +' || (it.n - 1) || ' más' else it.primero end,
         it.cantidad, r.forma_rma, r.motivo,
         coalesce(nullif(btrim(concat_ws(' ', p.nombre, p.apellido)), ''), 'Usuario sin nombre'),
         r.estado, count(*) over ()
    from dominio.rma r
    join dominio.empresas e on e.id = r.empresa_id and e.organizacion_id = r.organizacion_id
    join dominio.comprobantes_venta c on c.id = r.comprobante_id and c.organizacion_id = r.organizacion_id
    left join dominio.comprobantes_venta nc on nc.id = r.nota_credito_id and nc.organizacion_id = r.organizacion_id
    join public.clientes cl on cl.id = c.cliente_id and cl.organizacion_id = c.organizacion_id
    left join public.perfiles_usuario p on p.user_id = r.operador_id
    cross join lateral (
      select (array_agg(l.descripcion order by l.orden))[1] as primero, count(*) as n, coalesce(sum(i.cantidad), 0) as cantidad
        from dominio.rma_items i
        join dominio.comprobantes_venta_lineas l on l.id = i.comprobante_linea_id and l.organizacion_id = i.organizacion_id
       where i.rma_id = r.id and i.organizacion_id = r.organizacion_id
    ) it
   where r.organizacion_id = v_org
     and r.empresa_id = any (v_empresas)
     and (p_empresa_id is null or r.empresa_id = p_empresa_id)
     and (v_forma is null or r.forma_rma = v_forma)
     and (v_estado is null or r.estado = v_estado)
     and (v_patron is null
          or lower(r.numero) like v_patron
          or lower(c.numero) like v_patron
          or translate(lower(cl.nombre), 'áéíóúü', 'aeiouu') like v_patron
          or exists (
            select 1
              from dominio.rma_items i2
              join dominio.comprobantes_venta_lineas l2 on l2.id = i2.comprobante_linea_id and l2.organizacion_id = i2.organizacion_id
             where i2.rma_id = r.id and i2.organizacion_id = r.organizacion_id
               and translate(lower(l2.descripcion), 'áéíóúü', 'aeiouu') like v_patron
          ))
   order by r.creado_en desc, r.numero desc, r.id
   limit p_limite
  offset p_desde;
end;
$$;

revoke execute on function private.listar_rma_sesion(text, text, text, uuid, integer, integer) from public, anon;
grant execute on function private.listar_rma_sesion(text, text, text, uuid, integer, integer) to authenticated;

comment on function private.listar_rma_sesion(text, text, text, uuid, integer, integer) is
  'F-VTA-28/29/30: consulta del listado de RMA con organización y empresas resueltas de la sesión. Puente de la RPC security invoker; no acepta organización ni empresas por argumento.';

create or replace function public.listar_rma(
  p_busqueda text default null,
  p_forma_rma text default null,
  p_estado text default null,
  p_empresa_id uuid default null,
  p_pagina integer default 1,
  p_tamano integer default 10
)
returns table (
  id uuid,
  numero text,
  creado_en timestamptz,
  actualizado_en timestamptz,
  nota_credito_id uuid,
  nota_credito_numero text,
  stock_reingresado boolean,
  empresa_id uuid,
  empresa text,
  comprobante_id uuid,
  comprobante_numero text,
  cliente text,
  producto text,
  cantidad bigint,
  forma_rma text,
  motivo text,
  operador text,
  estado text,
  filas bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tamano integer := least(greatest(coalesce(p_tamano, 10), 1), 200);
  v_pagina integer := least(greatest(coalesce(p_pagina, 1), 1), 100000);
begin
  return query
  select q.id, q.numero, q.creado_en, q.actualizado_en, q.nota_credito_id, q.nota_credito_numero, q.stock_reingresado, q.empresa_id, q.empresa, q.comprobante_id, q.comprobante_numero, q.cliente,
         q.producto, q.cantidad, q.forma_rma, q.motivo, q.operador, q.estado, q.filas
    from private.listar_rma_sesion(p_busqueda, p_forma_rma, p_estado, p_empresa_id, v_tamano, (v_pagina - 1) * v_tamano) q;
end;
$$;

revoke execute on function public.listar_rma(text, text, text, uuid, integer, integer) from public, anon;
grant execute on function public.listar_rma(text, text, text, uuid, integer, integer) to authenticated;

comment on function public.listar_rma(text, text, text, uuid, integer, integer) is
  'Devoluciones (RMA) paginadas con búsqueda y filtros de forma, estado y tienda (F-VTA-28, FR-006). Security invoker; la sesión y las empresas visibles las resuelve private.listar_rma_sesion.';
