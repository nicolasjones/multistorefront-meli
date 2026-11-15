-- F-VTA-23 (MSF-358, épica MSF-338, spec 20270104-100000-ventas-reportes-basicos, FR-009, SC-004,
-- SC-005): RPC de lectura del ranking de clientes para la exportación a Excel.
--
-- Esquema (Principio VII): función en `public` (RPC de la app). SIN tablas nuevas: lee la vista
-- `analitica.ventas_ranking_clientes` (la creó T007), que es la MISMA fuente que el tablero
-- embebido de Superset: el Excel y la pantalla no pueden discrepar.
--
-- Por qué `security definer`: las vistas de `analitica` están cerradas para `authenticated` (las lee
-- solo el rol `superset_analitica`, como en «Más vendidos» y en Rentabilidad). Para que el navegador
-- lea el ranking con la misma agregación y el mismo orden que el tablero, la función corre con los
-- privilegios de su dueño y hace la autorización ADENTRO:
--   · exige la organización activa (`private.organizacion_id()`) y lectura o edición en la sección
--     `reportes` (42501 si no): el servidor rechaza la exportación sin permiso (SC-005), no alcanza
--     con ocultar el botón;
--   · acota las filas a esa organización y a las empresas accesibles del usuario
--     (`private.empresas_accesibles()`, las mismas que acotan la cláusula `rls` del guest token);
--   · `p_empresa_id` acota a una tienda y NUNCA amplía el alcance (una empresa ajena devuelve 0 filas).
--
-- Cálculo (misma fórmula que el tablero, contrato `contracts/analitica-ventas-reportes.md`):
-- la vista tiene grano empresa × cliente × fecha, así que la RPC agrega por cliente (la suma de la
-- tabla del tablero), ordena por facturación neta descendente con el desempate del ranking
-- (nombre y número) y recalcula la posición y la participación SOBRE EL RESULTADO FILTRADO (por
-- período, por empresa y por «Consumidor final»), que es lo que hace el tablero con sus métricas.
-- El predicado y el signo NO se reimplementan: los pone la vista (FR-002/FR-006).
--
-- «Consumidor final» (FR-006/FR-008): la vista no excluye a nadie; acá la exclusión es opcional y
-- se decide con `p_incluir_consumidor_final` (por defecto EXCLUIDO, el valor inicial de la
-- pantalla). El interruptor de la pantalla viaja como ese parámetro.
--
-- Lotes (FR-009): la RPC devuelve una página (`p_pagina`, `p_tamano`) y el total de filas del
-- alcance (`total_filas`), para que la exportación baje el ranking completo por lotes sin traerlo
-- todo de una vez. `p_tamano` tiene un tope de 5.000 filas por pedido.
--
-- Migración aditiva. Reversión (migración posterior; la función no guarda datos):
--   drop function public.leer_ranking_ventas(date, date, boolean, uuid, integer, integer);

create or replace function public.leer_ranking_ventas(
  p_desde date,
  p_hasta date,
  p_incluir_consumidor_final boolean default false,
  p_empresa_id uuid default null,
  p_pagina integer default 1,
  p_tamano integer default 1000
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
  ultimo_comprador date,
  total_filas bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
begin
  if v_organizacion is null or (select private.nivel_seccion('reportes')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver los reportes de ventas' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or p_desde > p_hasta then
    raise exception 'El rango de fechas no es válido' using errcode = '22023';
  end if;
  if p_pagina is null or p_pagina < 1 then
    raise exception 'La página no es válida' using errcode = '22023';
  end if;
  if p_tamano is null or p_tamano < 1 or p_tamano > 5000 then
    raise exception 'El tamaño del lote no es válido' using errcode = '22023';
  end if;

  -- Cada columna se califica con el alias de su CTE: los nombres de salida de la función
  -- (`posicion`, `nombre`, …) son variables de plpgsql y sin el alias serían ambiguos.
  return query
  with alcance as (
    select
      v.cliente_id,
      v.numero,
      v.nombre,
      v.tipo,
      sum(v.comprobantes)::bigint as comprobantes,
      sum(v.facturado)::numeric as facturado,
      max(v.ultimo_comprador) as ultimo_comprador
    from analitica.ventas_ranking_clientes v
    where v.organizacion_id = v_organizacion
      and v.empresa_id = any (select private.empresas_accesibles())
      and (p_empresa_id is null or v.empresa_id = p_empresa_id)
      and v.fecha between p_desde and p_hasta
      and (p_incluir_consumidor_final or not v.consumidor_final)
    group by v.cliente_id, v.numero, v.nombre, v.tipo
  ),
  totales as (
    select
      count(*)::bigint as total_filas,
      coalesce(sum(a.facturado), 0)::numeric as facturado_total
    from alcance a
  ),
  posicionado as (
    select
      a.cliente_id,
      a.numero,
      a.nombre,
      a.tipo,
      a.comprobantes,
      a.facturado,
      a.ultimo_comprador,
      row_number() over (order by a.facturado desc, lower(a.nombre), a.numero) as posicion,
      case
        when t.facturado_total = 0 then 0::numeric
        else a.facturado * 100 / t.facturado_total
      end as participacion
    from alcance a
    cross join totales t
  )
  select
    p.posicion,
    p.cliente_id,
    p.numero,
    p.nombre,
    p.tipo,
    p.comprobantes,
    p.facturado,
    p.participacion,
    p.ultimo_comprador,
    t.total_filas
  from posicionado p
  cross join totales t
  order by p.facturado desc, lower(p.nombre), p.numero
  limit p_tamano
  offset (p_pagina - 1) * p_tamano;
end;
$$;

comment on function public.leer_ranking_ventas(date, date, boolean, uuid, integer, integer) is
  'F-VTA-23: ranking de clientes por facturación neta para la exportación a Excel. Lee la misma vista que el tablero (analitica.ventas_ranking_clientes), acotada a la organización y a las empresas accesibles del usuario, con lectura o edición en la sección reportes (42501 si no). Devuelve una página del ranking y el total de filas del alcance.';

revoke execute on function public.leer_ranking_ventas(date, date, boolean, uuid, integer, integer) from public, anon;
grant execute on function public.leer_ranking_ventas(date, date, boolean, uuid, integer, integer) to authenticated;
