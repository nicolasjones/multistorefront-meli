-- MSF-621 (épica MSF-585): la nota de un movimiento de stock nacido de una reserva «a pedido» traía la
-- referencia interna del comprobante («Reserva comprobante:<uuid>:linea:1»). `public.listar_movimientos_stock`
-- ahora devuelve en la nota el número del comprobante («Reserva FAC-0005»), para el historial y su CSV.
--
-- Qué cambia: la columna `nota` y el orden de las operaciones (pagina primero, cruza después). Firma, columnas, orden, paginación y `security invoker` son los de
-- `20261023130000_stock_traslado.sql` (la definición vigente; no hubo otra redefinición). El número se busca en
-- `dominio.comprobantes_venta` de la misma organización con los permisos de quien consulta (RLS): si la
-- persona no puede ver el comprobante, o ya no existe, la nota queda como estaba y la pantalla muestra
-- «el comprobante». El libro `dominio.movimientos_stock` no se toca (es inmutable).
--
-- La referencia se reconoce igual que en `notaLegibleDeMovimiento` (apps/web/src/lib/stock.ts): sin distinguir
-- mayúsculas y sin letra ASCII, dígito ni guion bajo pegado antes de «comprobante:» (clase explícita: no depende del
-- idioma de la base). Se reemplazan todas las apariciones válidas de la referencia del primer comprobante de la
-- nota; una aparición pegada a una letra ASCII, un dígito o un guion bajo
-- («precomprobante:<uuid>») no se toca, y una letra acentuada u otro carácter no ASCII delante cuenta como separador. La pantalla, además, cambia por
-- «el comprobante» las referencias a otros comprobantes que la nota pudiera traer.
--
-- Reversión: recrear `public.listar_movimientos_stock` con la definición de
-- `20261023130000_stock_traslado.sql` (con `create or replace`, misma firma).

create or replace function public.listar_movimientos_stock(
  p_producto uuid default null,
  p_limite integer default 25,
  p_desplazamiento integer default 0
)
returns table (
  id uuid,
  fecha date,
  creado_en timestamptz,
  producto_id uuid,
  producto_nombre text,
  producto_sku text,
  tipo text,
  motivo text,
  nota text,
  cantidad integer,
  diferencia integer,
  saldo integer,
  responsable text,
  total bigint,
  deposito_id uuid,
  deposito_nombre text,
  traslado_id uuid
)
language sql
stable
security invoker
set search_path = ''
as $$
  -- Se pagina primero y recién después se cruza con productos, motivos, depósitos y comprobantes: el cruce
  -- del número corre solo para las filas de la página, no para todo el libro de la organización. El comprobante se
  -- busca con una subconsulta por fila de la página (ver el encabezado de supabase/tests/perf/movimientos_nota_comprobante.perf.sql).
  with pagina as (
    select m.*, count(*) over () as total_filas
    from dominio.movimientos_stock m
    where (p_producto is null or m.producto_id = p_producto)
    order by m.creado_en desc, m.id desc
    limit greatest(1, least(coalesce(p_limite, 25), 100))
    offset greatest(0, coalesce(p_desplazamiento, 0))
  )
  select
    m.id,
    m.fecha,
    m.creado_en,
    m.producto_id,
    p.nombre,
    p.sku,
    m.tipo,
    mo.nombre,
    case
      when cv.numero is not null then regexp_replace(
        m.nota,
        '(^|[^a-zA-Z0-9_])comprobante:' || cv.id::text || '(?::linea:[0-9]+)?',
        '\1' || replace(cv.numero, '\', '\\'),
        'gi')
      else m.nota
    end,
    m.cantidad,
    m.diferencia,
    m.saldo,
    m.actor_nombre,
    m.total_filas,
    m.deposito_id,
    dep.nombre,
    m.traslado_id
  from pagina m
  left join dominio.productos p
    on p.id = m.producto_id and p.organizacion_id = m.organizacion_id
  left join dominio.motivos_movimiento mo
    on mo.id = m.motivo_id and mo.organizacion_id = m.organizacion_id
  left join dominio.depositos dep
    on dep.id = m.deposito_id and dep.organizacion_id = m.organizacion_id
  left join lateral (
    select
      (regexp_match(m.nota, '(?:^|[^a-zA-Z0-9_])comprobante:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', 'i'))[1]::uuid as comprobante_id
  ) ref on true
  left join lateral (
    select
      ref.comprobante_id as id,
      (select c.numero
         from dominio.comprobantes_venta c
        where c.id = ref.comprobante_id and c.organizacion_id = m.organizacion_id) as numero
  ) cv on true
  order by m.creado_en desc, m.id desc;
$$;

comment on function public.listar_movimientos_stock(uuid, integer, integer) is
  'Historial de movimientos de stock (F-STK-03, + depósito en F-STK-14, + traslado_id en F-STK-15). Solo lectura, security invoker (RLS), paginado con tope 100 y total. La nota de una reserva a pedido trae el número del comprobante en lugar de su referencia interna.';

revoke execute on function public.listar_movimientos_stock(uuid, integer, integer) from public, anon;
grant execute on function public.listar_movimientos_stock(uuid, integer, integer) to authenticated;
