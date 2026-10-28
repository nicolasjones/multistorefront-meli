-- F-VTA-17 (MSF-183, épica MSF-135, spec 20261024-130000-ventas-despacho-y-faltantes, FR-030):
-- `public.listar_despacho`, la lectura paginada del tablero «Ventas · Despacho».
--
-- Esquema (Principio VII), verificado tabla por tabla:
--   dominio.comprobantes_venta  dominio (existente)       las facturas y su estado de despacho (F-VTA-15/16).
--   dominio.empresas            dominio (existente)       la tienda de la factura.
--   dominio.transportes         dominio (existente)       el nombre del transporte (F-VTA-16).
--   public.clientes             plataforma (existente)    el cliente de la factura.
--   public.perfiles_usuario     plataforma (existente)    el nombre de quien armó, controló y entregó.
--   auth.users                  plataforma (autenticación) solo lectura: el correo cuando no hay perfil.
-- Ninguna tabla se crea ni se altera: esta migración es solo la RPC de lectura.
--
-- Reglas (FR-030):
--   · Entran las FACTURAS CONFIRMADAS que no están anuladas: tienen `estado_despacho` (lo fija el disparador
--     al confirmar, F-VTA-15) y `estado <> 'anulada'`. Los presupuestos, las notas de crédito y los borradores
--     no tienen estado de despacho y quedan fuera.
--   · Búsqueda por cliente o número, sin mayúsculas ni tildes y con el texto literal (se escapan \ % _),
--     como `listar_comprobantes` (F-VTA-09).
--   · Filtro de estado (`sin_armar`, `armando`, `incompleto`, `listo_para_despachar`, `entregado`) y de empresa.
--   · `conteos` es un jsonb `{ estado_despacho: cantidad }` calculado DENTRO de la empresa y la búsqueda, pero
--     SIN el filtro de estado, para que los conteos de las píldoras no se vacíen al elegir una. Cuando la
--     página no tiene filas (filtro sin resultados o página fuera de rango) la función devuelve UNA fila con
--     `id` nulo que solo lleva `filas = 0` y los `conteos`: así la pantalla sigue mostrando los conteos y
--     distingue «sin resultados» de «sin datos». El resto de las filas siempre trae `id`.
--   · `puede_despachar` por fila: la acción `despachar` resuelta en la EMPRESA del comprobante
--     (`private.puede_despachar_en_empresa`), no en la empresa activa de la barra superior (Principio VIII).
--   · Solo de las empresas donde la persona tiene Ventas en `lectura` o `edicion` en esa misma empresa
--     (`private.nivel_ventas_en_empresa`); una empresa ajena devuelve cero filas, no un error que delate que
--     existe. Sin Ventas en ninguna empresa (`ninguno`) el resultado es vacío.
--   · La organización y el actor salen de la sesión (JWT), nunca de un argumento.
--   · Paginación en el servidor: `p_pagina` y `p_tamano` (tope 200) y `filas` con el total del filtro actual.
--   · Orden estable: fecha descendente, número descendente y el id como desempate.
--
-- Errores: 42501 sin sesión con organización · 22023 estado de filtro desconocido.
--
-- Migración aditiva. Reversión (en una migración posterior; la RPC no guarda datos):
--   drop function public.listar_despacho(text, text, uuid, integer, integer);
--   drop index if exists dominio.comprobantes_venta_despacho_listado_idx;

-- Índice del tablero: facturas con despacho de una organización, de la más reciente a la más vieja.
create index if not exists comprobantes_venta_despacho_listado_idx
  on dominio.comprobantes_venta (organizacion_id, fecha desc, numero_entero desc)
  where tipo = 'factura' and estado_despacho is not null;

create or replace function public.listar_despacho(
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
  estado_despacho text,
  armo text,
  controlo text,
  entrego text,
  transporte text,
  guia text,
  fecha_envio date,
  puede_despachar boolean,
  filas bigint,
  conteos jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_empresas uuid[];
  v_texto text := btrim(coalesce(p_busqueda, ''));
  v_patron text;
  v_estado text := nullif(btrim(coalesce(p_estado, '')), '');
  v_limite integer := least(greatest(coalesce(p_tamano, 10), 1), 200);
  v_pagina integer := least(greatest(coalesce(p_pagina, 1), 1), 100000);
begin
  if v_org is null or (select auth.uid()) is null then
    raise exception 'Necesitás una sesión con organización para ver el despacho' using errcode = '42501';
  end if;
  if v_estado is not null and v_estado not in
     ('sin_armar', 'armando', 'incompleto', 'listo_para_despachar', 'entregado') then
    raise exception 'El estado de despacho % no existe', v_estado using errcode = '22023';
  end if;
  if v_texto <> '' then
    v_patron := '%' || replace(replace(replace(translate(lower(v_texto), 'áéíóúü', 'aeiouu'), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  -- Las empresas visibles: las de la organización donde la persona tiene Ventas en lectura o edición. El
  -- permiso se resuelve por empresa, no contra la empresa activa.
  select coalesce(array_agg(e.id), '{}') into v_empresas
    from dominio.empresas e
   where e.organizacion_id = v_org
     and (select private.nivel_ventas_en_empresa(e.id)) in ('lectura', 'edicion');

  return query
  with base as (
    select c.id, c.numero, c.numero_entero, c.empresa_id, e.nombre as empresa, c.fecha, cl.nombre as cliente,
           c.estado_despacho,
           coalesce(nullif(btrim(concat_ws(' ', pa.nombre, pa.apellido)), ''), ua.email::text) as armo,
           coalesce(nullif(btrim(concat_ws(' ', pc.nombre, pc.apellido)), ''), uc.email::text) as controlo,
           coalesce(nullif(btrim(concat_ws(' ', pe.nombre, pe.apellido)), ''), ue.email::text) as entrego,
           t.nombre as transporte, c.guia, c.fecha_envio
      from dominio.comprobantes_venta c
      join dominio.empresas e on e.id = c.empresa_id and e.organizacion_id = c.organizacion_id
      join public.clientes cl on cl.id = c.cliente_id and cl.organizacion_id = c.organizacion_id
      left join dominio.transportes t on t.id = c.transporte_id and t.organizacion_id = c.organizacion_id
      left join auth.users ua on ua.id = c.armo_id
      left join public.perfiles_usuario pa on pa.user_id = c.armo_id
      left join auth.users uc on uc.id = c.controlo_id
      left join public.perfiles_usuario pc on pc.user_id = c.controlo_id
      left join auth.users ue on ue.id = c.entrego_id
      left join public.perfiles_usuario pe on pe.user_id = c.entrego_id
     where c.organizacion_id = v_org
       and c.tipo = 'factura'
       and c.estado_despacho is not null
       and c.estado <> 'anulada'
       and c.empresa_id = any (v_empresas)
       and (p_empresa_id is null or c.empresa_id = p_empresa_id)
       and (v_patron is null
            or translate(lower(cl.nombre), 'áéíóúü', 'aeiouu') like v_patron
            or lower(c.numero) like v_patron
            or coalesce(c.numero_entero::text, '') like v_patron)
  ),
  conteo as (
    select coalesce(jsonb_object_agg(x.estado_despacho, x.n), '{}'::jsonb) as j
      from (select b.estado_despacho, count(*) as n from base b group by b.estado_despacho) x
  ),
  filtrada as (
    select b.* from base b where v_estado is null or b.estado_despacho = v_estado
  ),
  pagina as (
    select f.*, count(*) over () as total,
           row_number() over (order by f.fecha desc, f.numero_entero desc nulls last, f.id) as orden
      from filtrada f
     order by f.fecha desc, f.numero_entero desc nulls last, f.id
     limit v_limite
    offset (v_pagina - 1) * v_limite
  )
  select p.id, p.numero, p.empresa_id, p.empresa, p.fecha, p.cliente, p.estado_despacho,
         p.armo, p.controlo, p.entrego, p.transporte, p.guia, p.fecha_envio,
         case when p.id is null then null
              else (select private.puede_despachar_en_empresa(p.empresa_id)) end as puede_despachar,
         coalesce(p.total, (select count(*) from filtrada)) as filas,
         (select j from conteo) as conteos
    from (select 1) uno
    left join pagina p on true
   order by p.orden;
end;
$$;

comment on function public.listar_despacho(text, text, uuid, integer, integer) is
  'Facturas confirmadas no anuladas con su estado de despacho, responsables, transporte y guía, filtrables por estado, búsqueda y empresa, paginadas, con conteo por estado. Solo de las empresas donde la persona tiene Ventas en lectura o edición; `puede_despachar` se resuelve en la empresa de cada factura (F-VTA-17, FR-030). Sin filas en la página: una fila con id nulo que lleva solo los conteos.';

revoke execute on function public.listar_despacho(text, text, uuid, integer, integer) from public, anon;
grant execute on function public.listar_despacho(text, text, uuid, integer, integer) to authenticated;
