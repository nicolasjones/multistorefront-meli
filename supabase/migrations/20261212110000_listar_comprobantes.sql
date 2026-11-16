-- F-VTA-09 (MSF-346, épica MSF-177, spec 20261024-130000-ventas-listado-estados-y-anulacion, FR-001, FR-002, FR-003):
-- `listar_comprobantes` (la pantalla Comprobantes paginada en el servidor) y `operadores_de_comprobantes`
-- (opciones del filtro Operador). Ambas, y la exportación (20261212110100), comparten UNA sola consulta:
-- `private.comprobantes_consulta`, para que lo que se ve y lo que se exporta nunca difieran.
--
-- Esquema (Principio VII): sin tablas nuevas; solo funciones y un índice sobre `dominio.comprobantes_venta`
-- (dominio, existente). Lee `dominio.empresas`, `dominio.formas_pago`, `dominio.formas_envio` (dominio),
-- `public.clientes` y `public.perfiles_usuario` (plataforma; nombre del operador).
--
-- Seguridad: las RPC públicas de lectura son `security invoker` con `search_path = ''`; delegan en
-- `private.comprobantes_consulta_sesion` / `private.operadores_de_comprobantes_sesion`, que son `security definer`
-- porque leen `public.perfiles_usuario` (su RLS no deja ver el nombre del operador a todos), pero NO reciben la
-- organización ni las empresas: las derivan del JWT. La organización y el actor salen de la sesión, nunca de un
-- argumento. Solo entran las empresas donde el usuario tiene `ventas` en `lectura` o `edicion`
-- (`private.nivel_ventas_en_empresa`): una empresa ajena devuelve cero filas, no un error que delate su existencia.
-- `private.comprobantes_consulta` NO tiene grant a `authenticated`: recibe la organización y las empresas ya
-- resueltas por quien la llama (la RPC con la sesión, o el worker de exportación con las empresas guardadas al solicitar).
--
-- Reglas:
--   · Listado: `factura` y `nota_credito` (los presupuestos tienen su pestaña). Total con signo: la nota de crédito resta.
--   · Búsqueda por cliente o número, sin mayúsculas ni tildes, con el texto literal (se escapan \ % _) y sin espacios sobrantes.
--   · Estado: `pendiente` y `confirmada` son lo mismo (cómo el panel muestra `confirmada`); `vencido` de un presupuesto se
--     deriva de `valido_hasta` < hoy, como en `listar_presupuestos`.
--   · Orden estable: fecha desc, número desc, id. Tope 200 por página; una página fuera de rango no devuelve filas.
--   · `filas` es el total del filtro actual (para la paginación y para elegir la vía de exportación).
--
-- Errores: 42501 sin sesión con organización · 22023 estado de filtro desconocido.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.operadores_de_comprobantes(uuid);
--   drop function public.listar_comprobantes(text, text, uuid, uuid, uuid, uuid, integer, integer);
--   drop function private.operadores_de_comprobantes_sesion(uuid);
--   drop function private.comprobantes_consulta_sesion(text[], text, text, uuid, uuid, uuid, uuid, integer, integer);
--   drop function private.comprobantes_consulta(uuid, uuid[], text[], text, text, uuid, uuid, uuid, uuid, integer, integer);
--   drop index dominio.comprobantes_venta_listado_idx;

create index if not exists comprobantes_venta_listado_idx
  on dominio.comprobantes_venta (organizacion_id, tipo, fecha desc, numero_entero desc);

create or replace function private.comprobantes_consulta(
  p_organizacion_id uuid,
  p_empresas uuid[],
  p_tipos text[],
  p_busqueda text,
  p_estado text,
  p_pago_id uuid,
  p_envio_id uuid,
  p_operador_id uuid,
  p_empresa_id uuid,
  p_limite integer,
  p_desde integer
)
returns table (
  id uuid,
  numero text,
  tipo text,
  empresa_id uuid,
  empresa text,
  fecha date,
  cliente text,
  operador_id uuid,
  operador text,
  estado text,
  estado_etiqueta text,
  forma_pago text,
  envio text,
  total numeric,
  filas bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_texto text := btrim(coalesce(p_busqueda, ''));
  v_patron text;
  v_estado text := nullif(btrim(coalesce(p_estado, '')), '');
  v_hoy date := (select private.hoy_argentina());
begin
  if v_estado is not null and v_estado not in
     ('borrador', 'confirmada', 'pendiente', 'aceptado', 'cobrado', 'en_proceso', 'deuda', 'armando', 'incompleto',
      'anulada', 'vencido', 'convertido') then
    raise exception 'El estado % no existe', v_estado using errcode = '22023', hint = 'estado';
  end if;
  if v_estado = 'confirmada' then v_estado := 'pendiente'; end if;
  if v_texto <> '' then
    v_patron := '%' || replace(replace(replace(translate(lower(v_texto), 'áéíóúü', 'aeiouu'), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return query
  with base as (
    select c.id, c.numero, c.numero_entero, c.tipo, c.empresa_id, e.nombre as empresa, c.fecha,
           cl.nombre as cliente, c.operador_id,
           coalesce(nullif(btrim(concat_ws(' ', p.nombre, p.apellido)), ''), 'Usuario sin nombre') as operador,
           case when c.tipo = 'presupuesto' and c.estado = 'pendiente' and c.valido_hasta is not null
                     and c.valido_hasta < v_hoy then 'vencido' else c.estado end as estado,
           fp.nombre as forma_pago, fe.nombre as envio,
           case when c.tipo = 'nota_credito' then -c.total_con_iva else c.total_con_iva end as total
      from dominio.comprobantes_venta c
      join dominio.empresas e on e.id = c.empresa_id and e.organizacion_id = c.organizacion_id
      join public.clientes cl on cl.id = c.cliente_id and cl.organizacion_id = c.organizacion_id
      left join public.perfiles_usuario p on p.user_id = c.operador_id
      left join dominio.formas_pago fp on fp.id = c.forma_pago_id and fp.organizacion_id = c.organizacion_id
      left join dominio.formas_envio fe on fe.id = c.envio_id and fe.organizacion_id = c.organizacion_id
     where c.organizacion_id = p_organizacion_id
       and c.empresa_id = any (p_empresas)
       and c.tipo = any (p_tipos)
       and (p_empresa_id is null or c.empresa_id = p_empresa_id)
       and (p_pago_id is null or c.forma_pago_id = p_pago_id)
       and (p_envio_id is null or c.envio_id = p_envio_id)
       and (p_operador_id is null or c.operador_id = p_operador_id)
       and (v_patron is null
            or translate(lower(cl.nombre), 'áéíóúü', 'aeiouu') like v_patron
            or lower(c.numero) like v_patron
            or coalesce(c.numero_entero::text, '') like v_patron)
  )
  select b.id, b.numero, b.tipo, b.empresa_id, b.empresa, b.fecha, b.cliente, b.operador_id, b.operador,
         b.estado, private.etiqueta_estado_comprobante(b.estado), b.forma_pago, b.envio, b.total,
         count(*) over () as filas
    from base b
   where v_estado is null or (case when b.estado = 'confirmada' then 'pendiente' else b.estado end) = v_estado
   order by b.fecha desc, b.numero_entero desc nulls last, b.id
   limit p_limite
  offset p_desde;
end;
$$;

revoke execute on function private.comprobantes_consulta(uuid, uuid[], text[], text, text, uuid, uuid, uuid, uuid, integer, integer)
  from public, anon, authenticated;

comment on function private.comprobantes_consulta(uuid, uuid[], text[], text, text, uuid, uuid, uuid, uuid, integer, integer) is
  'F-VTA-09: consulta única de comprobantes/presupuestos con filtros; la usan listar_comprobantes, exportar_comprobantes y el worker de exportación. Sin grant a authenticated: el llamador resuelve organización y empresas.';

-- Resuelve la organización y las empresas visibles DE LA SESIÓN y delega en la consulta única. Es
-- `security definer` para leer `public.perfiles_usuario`, pero NO recibe organización ni empresas: las deriva
-- del JWT, así que no puede usarse para mirar datos ajenos. Las RPC de lectura son `security invoker` y la
-- llaman; `authenticated` solo puede ejecutar esta versión acotada, nunca `private.comprobantes_consulta`.
create or replace function private.comprobantes_consulta_sesion(
  p_tipos text[],
  p_busqueda text,
  p_estado text,
  p_pago_id uuid,
  p_envio_id uuid,
  p_operador_id uuid,
  p_empresa_id uuid,
  p_limite integer,
  p_desde integer
)
returns table (
  id uuid,
  numero text,
  tipo text,
  empresa_id uuid,
  empresa text,
  fecha date,
  cliente text,
  operador_id uuid,
  operador text,
  estado text,
  estado_etiqueta text,
  forma_pago text,
  envio text,
  total numeric,
  filas bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_empresas uuid[];
begin
  if v_org is null or (select auth.uid()) is null then
    raise exception 'Necesitás una sesión con organización para ver comprobantes' using errcode = '42501';
  end if;

  select coalesce(array_agg(e.id), '{}') into v_empresas
    from dominio.empresas e
   where e.organizacion_id = v_org
     and (select private.nivel_ventas_en_empresa(e.id)) in ('lectura', 'edicion');

  return query
  select q.id, q.numero, q.tipo, q.empresa_id, q.empresa, q.fecha, q.cliente, q.operador_id, q.operador,
         q.estado, q.estado_etiqueta, q.forma_pago, q.envio, q.total, q.filas
    from private.comprobantes_consulta(
           v_org, v_empresas, p_tipos, p_busqueda, p_estado, p_pago_id, p_envio_id, p_operador_id,
           p_empresa_id, p_limite, p_desde
         ) q;
end;
$$;

revoke execute on function private.comprobantes_consulta_sesion(text[], text, text, uuid, uuid, uuid, uuid, integer, integer)
  from public, anon;
grant execute on function private.comprobantes_consulta_sesion(text[], text, text, uuid, uuid, uuid, uuid, integer, integer)
  to authenticated;

comment on function private.comprobantes_consulta_sesion(text[], text, text, uuid, uuid, uuid, uuid, integer, integer) is
  'F-VTA-09: misma consulta del listado con organización y empresas resueltas de la sesión. Puente de las RPC security invoker; no acepta organización ni empresas por argumento.';

create or replace function public.listar_comprobantes(
  p_busqueda text default null,
  p_estado text default null,
  p_pago_id uuid default null,
  p_envio_id uuid default null,
  p_operador_id uuid default null,
  p_empresa_id uuid default null,
  p_pagina integer default 1,
  p_tamano integer default 10
)
returns table (
  id uuid,
  numero text,
  tipo text,
  empresa_id uuid,
  empresa text,
  fecha date,
  cliente text,
  operador text,
  estado text,
  forma_pago text,
  envio text,
  total numeric,
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
  select q.id, q.numero, q.tipo, q.empresa_id, q.empresa, q.fecha, q.cliente, q.operador, q.estado,
         q.forma_pago, q.envio, q.total, q.filas
    from private.comprobantes_consulta_sesion(
           array['factura', 'nota_credito'], p_busqueda, p_estado,
           p_pago_id, p_envio_id, p_operador_id, p_empresa_id, v_tamano, (v_pagina - 1) * v_tamano
         ) q;
end;
$$;

revoke execute on function public.listar_comprobantes(text, text, uuid, uuid, uuid, uuid, integer, integer) from public, anon;
grant execute on function public.listar_comprobantes(text, text, uuid, uuid, uuid, uuid, integer, integer) to authenticated;

comment on function public.listar_comprobantes(text, text, uuid, uuid, uuid, uuid, integer, integer) is
  'Facturas y notas de crédito paginadas con búsqueda y filtros Operador/Estado/Pago/Envío/tienda; total con signo. Security invoker; la sesión y las empresas visibles las resuelve private.comprobantes_consulta_sesion (F-VTA-09, FR-001/002/003).';

create or replace function private.operadores_de_comprobantes_sesion(p_empresa_id uuid)
returns table (id uuid, nombre text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
begin
  if v_org is null or (select auth.uid()) is null then
    raise exception 'Necesitás una sesión con organización para ver comprobantes' using errcode = '42501';
  end if;

  return query
  select distinct c.operador_id,
         coalesce(nullif(btrim(concat_ws(' ', p.nombre, p.apellido)), ''), 'Usuario sin nombre')
    from dominio.comprobantes_venta c
    join dominio.empresas e on e.id = c.empresa_id and e.organizacion_id = c.organizacion_id
    left join public.perfiles_usuario p on p.user_id = c.operador_id
   where c.organizacion_id = v_org
     and c.operador_id is not null
     and c.tipo in ('factura', 'nota_credito')
     and (select private.nivel_ventas_en_empresa(c.empresa_id)) in ('lectura', 'edicion')
     and (p_empresa_id is null or c.empresa_id = p_empresa_id)
   order by 2, 1;
end;
$$;

revoke execute on function private.operadores_de_comprobantes_sesion(uuid) from public, anon;
grant execute on function private.operadores_de_comprobantes_sesion(uuid) to authenticated;

comment on function private.operadores_de_comprobantes_sesion(uuid) is
  'F-VTA-09: opciones del filtro Operador de la sesión (empresas visibles, acotadas por tienda). Security definer sin organización por argumento.';

create or replace function public.operadores_de_comprobantes(p_empresa_id uuid default null)
returns table (id uuid, nombre text)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.operadores_de_comprobantes_sesion(p_empresa_id);
$$;

revoke execute on function public.operadores_de_comprobantes(uuid) from public, anon;
grant execute on function public.operadores_de_comprobantes(uuid) to authenticated;

comment on function public.operadores_de_comprobantes(uuid) is
  'Opciones del filtro Operador: quienes emitieron comprobantes en empresas visibles para el usuario, acotadas por tienda si se pide (F-VTA-09, FR-003). Security invoker.';
