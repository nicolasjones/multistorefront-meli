-- F-VTA-11 (MSF-377, épica MSF-177, FR-047, BREAKING interno): lo facturado pasa a ser NETO de notas de crédito.
--
-- Esquema (Principio VII): sin tablas; solo reemplaza funciones de `private` y `public` (mismos grants: `create or
-- replace` los conserva). Lee `dominio.comprobantes_venta` (`dominio`).
--
-- Cambios:
--   · `private.signo_comprobante(tipo)`: -1 para `nota_credito`, 1 para el resto. Las notas se guardan POSITIVAS; el
--     signo lo da el tipo, y todas las lecturas lo aplican.
--   · BREAKING: `private.comprobante_cuenta_como_facturado(tipo, estado)` pasa a devolver verdadero también para una
--     `nota_credito` emitida (antes solo facturas no `borrador` ni `anulada`). Es el predicado interno del ranking de
--     clientes (F-CLI-08) y de las compras del cliente (F-CLI-10); las lecturas que lo usan RESTAN el importe de las
--     notas (`signo_comprobante`) y el ranking cuenta como «comprobantes» solo las facturas, no las notas.
--   · `public.ranking_clientes` y `public.compras_de_cliente` se redefinen con la misma firma: facturado neto y, en las
--     compras, el total de cada nota con signo negativo. Cuerpo idéntico al de 20261021160600 y 20261021160400 salvo
--     lo dicho.
--
-- La cuenta corriente y los cobros que afecta la nota son de MSF-195 (FUERA de esta épica).
--
-- Migración aditiva. Reversión (migración posterior): restaurar el predicado de 20261204140100
--   (`select p_tipo = 'factura' and p_estado not in ('borrador', 'anulada')`), los cuerpos de `ranking_clientes`
--   (20261021160600) y `compras_de_cliente` (20261021160400) y `drop function private.signo_comprobante(text)`.

create or replace function private.signo_comprobante(p_tipo text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when p_tipo = 'nota_credito' then -1 else 1 end
$$;

revoke execute on function private.signo_comprobante(text) from public, anon, authenticated;

create or replace function private.comprobante_cuenta_como_facturado(p_tipo text, p_estado text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_tipo in ('factura', 'nota_credito') and p_estado not in ('borrador', 'anulada')
$$;

create or replace function public.ranking_clientes(
  p_desde date,
  p_hasta date,
  p_tipo text default null,
  p_incluir_consumidor_final boolean default false,
  p_con_iva boolean default false,
  p_pagina integer default 1,
  p_tamano integer default 25,
  p_empresa_id uuid default null
)
returns table (
  posicion bigint,
  cliente_id uuid,
  numero integer,
  nombre text,
  tipo text,
  comprobantes bigint,
  facturado numeric,
  participacion numeric,
  total_filas bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.organizacion_id();
begin
  if v_org is null or private.nivel_seccion('clientes') not in ('lectura', 'edicion') then
    raise exception 'Sin permiso para ver el ranking de clientes.' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null then
    raise exception 'Indicá las fechas Desde y Hasta.' using errcode = '22023';
  end if;
  if p_desde > p_hasta then
    raise exception 'Hasta no puede ser anterior a Desde.' using errcode = '22023';
  end if;
  if p_hasta > (p_desde + interval '5 years')::date then
    raise exception 'El rango máximo es de 5 años.' using errcode = '22023';
  end if;
  if p_tipo is not null and p_tipo not in ('minorista', 'mayorista') then
    raise exception 'Tipo de cliente inválido.' using errcode = '22023';
  end if;
  if p_pagina is null or p_pagina < 1 or p_pagina > 1000000 then
    raise exception 'La página debe estar entre 1 y 1.000.000.' using errcode = '22023';
  end if;
  if p_tamano is null or p_tamano < 1 or p_tamano > 1000 then
    raise exception 'El tamaño de página debe estar entre 1 y 1000.' using errcode = '22023';
  end if;

  return query
  with agregado as (
    select c.id as cid, c.numero as cnumero, c.nombre as cnombre, c.tipo as ctipo,
           -- El conteo es de facturas; la nota de crédito resta del importe pero no suma un comprobante.
           count(*) filter (where v.tipo = 'factura') as ncomp,
           sum(private.signo_comprobante(v.tipo) * case when p_con_iva then v.total_con_iva else v.total_sin_iva end) as total
      from dominio.comprobantes_venta v
      join public.clientes c
        on c.id = v.cliente_id and c.organizacion_id = v.organizacion_id
     where v.organizacion_id = v_org
       and v.fecha between p_desde and p_hasta
       and private.comprobante_cuenta_como_facturado(v.tipo, v.estado)
       and (p_tipo is null or c.tipo = p_tipo)
       and (coalesce(p_incluir_consumidor_final, false) or not c.es_consumidor_final)
       -- Filtro por tienda (F-CLI-11): solo los clientes habilitados en la elegida.
       and (p_empresa_id is null or exists (
             select 1 from public.clientes_empresas ce
              where ce.cliente_id = c.id and ce.empresa_id = p_empresa_id and ce.organizacion_id = v_org))
     group by c.id, c.numero, c.nombre, c.tipo
  ), calculado as (
    select a.*,
           sum(a.total) over () as gran_total,
           count(*) over () as filas,
           row_number() over (order by a.total desc, lower(a.cnombre), a.cnumero) as pos
      from agregado a
  )
  select k.pos, k.cid, k.cnumero, k.cnombre, k.ctipo, k.ncomp, k.total,
         -- Porcentaje (0–100) sin redondear: la pantalla lo muestra con una decimal y
         -- así la suma de todas las filas del ranking es 100 (FR-006).
         case when k.gran_total = 0 then 0::numeric
              else k.total * 100 / k.gran_total end,
         k.filas
    from calculado k
   order by k.pos
   limit p_tamano
  offset (p_pagina - 1) * p_tamano;
end;
$$;

create or replace function public.compras_de_cliente(
  p_cliente_id uuid,
  p_pagina integer default 1,
  p_tamano integer default 10
)
returns table (
  facturado_anio numeric,
  numero text,
  fecha date,
  tipo text,
  estado text,
  total_sin_iva numeric,
  total_filas bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.organizacion_id();
  v_hoy date;
  v_inicio date;
  v_total numeric;
  v_cantidad bigint;
begin
  if v_org is null or private.nivel_seccion('clientes') not in ('lectura', 'edicion') then
    raise exception 'Sin permiso para ver las compras del cliente.' using errcode = '42501';
  end if;
  if p_cliente_id is null then
    raise exception 'Indicá el cliente.' using errcode = '22023';
  end if;
  if p_pagina is null or p_pagina < 1 or p_pagina > 1000000 then
    raise exception 'La página debe estar entre 1 y 1.000.000.' using errcode = '22023';
  end if;
  if p_tamano is null or p_tamano < 1 or p_tamano > 100 then
    raise exception 'El tamaño de página debe estar entre 1 y 100.' using errcode = '22023';
  end if;

  -- Cliente ajeno o inexistente: sin filas (no revela si existe en otra organización).
  if not exists (
    select 1 from public.clientes c where c.id = p_cliente_id and c.organizacion_id = v_org
  ) then
    return;
  end if;

  select (now() at time zone o.zona_horaria)::date
    into v_hoy
    from public.organizaciones o
   where o.id = v_org;
  v_hoy := coalesce(v_hoy, current_date);
  v_inicio := date_trunc('year', v_hoy)::date;

  select coalesce(sum(private.signo_comprobante(v.tipo) * v.total_sin_iva), 0)
    into v_total
    from dominio.comprobantes_venta v
   where v.organizacion_id = v_org
     and v.cliente_id = p_cliente_id
     and v.fecha between v_inicio and v_hoy
     and private.comprobante_cuenta_como_facturado(v.tipo, v.estado);

  return query
  select v_total, k.cnumero, k.cfecha, k.ctipo, k.cestado, k.ctotal, k.filas
    from (
      select v.numero as cnumero, v.fecha as cfecha, v.tipo as ctipo, v.estado as cestado,
             private.signo_comprobante(v.tipo) * v.total_sin_iva as ctotal, count(*) over () as filas
        from dominio.comprobantes_venta v
       where v.organizacion_id = v_org
         and v.cliente_id = p_cliente_id
       order by v.fecha desc, v.numero desc, v.tipo
       limit p_tamano
      offset (p_pagina - 1) * p_tamano
    ) k
   order by k.cfecha desc, k.cnumero desc, k.ctipo;

  -- Sin filas en esta página (cliente sin comprobantes, o página más allá del final):
  -- centinela con el total del año y la cantidad real de comprobantes.
  if not found then
    select count(*) into v_cantidad
      from dominio.comprobantes_venta v
     where v.organizacion_id = v_org and v.cliente_id = p_cliente_id;
    return query select v_total, null::text, null::date, null::text, null::text, null::numeric, v_cantidad;
  end if;
end;
$$;
