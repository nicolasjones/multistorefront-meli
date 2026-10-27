-- F-CLI-07 (MSF-432, épica MSF-237, spec 20261024-051500-cuenta-web-del-cliente): precios de la tienda según
-- el tipo de cliente. FR-033, FR-034.
--
-- Esquemas (Principio VII, re-verificado): no se crea ni altera ninguna tabla.
--   * publico.precios_cliente_por_dominio -> `publico` (función de lectura por Host); `publico` sigue SIN tablas.
--
-- Responde SOLO a una cuenta web ACTIVA y habilitada en la tienda del host (reutiliza el estado efectivo de
-- publico.acceso_cliente_por_dominio, que se consulta en cada llamada: la suspensión o el cambio de tipo rigen
-- en la próxima carga). Cualquier otro caso (visitante, suspendida, sin cuenta, no habilitada, host
-- desconocido, empresa desactivada) devuelve null, idéntico.
-- El tipo sale de la base, nunca del llamador: no se puede pedir la escala de otro tipo. Minorista => solo x1;
-- mayorista => x1, x5, x10, x50 con su rango de unidades (D3: 1-4, 5-9, 10-49, 50 o más). Escala sin
-- precio => valor de x1.
-- Lista blanca: producto_id, escala, desde, hasta, final. Nunca costos, margen, existencias ni organizacion_id.
-- Solo productos efectivamente visibles en la tienda (private.catalogo_tienda_efectivo); los demás se omiten.
-- Máximo de productos por llamada: 50 (22023 si se excede).
--
-- Migración aditiva. Reversión (migración posterior; no se ejecuta en el mismo PR):
--   drop function publico.precios_cliente_por_dominio(text, uuid[]);

create or replace function publico.precios_cliente_por_dominio(host text, productos uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  v_max constant int := 50;
  v_acceso jsonb;
  v_tipo text;
  v_empresa uuid;
  v_resultado jsonb;
begin
  if productos is not null and cardinality(productos) > v_max then
    raise exception 'Se pueden pedir hasta % productos por llamada', v_max using errcode = '22023';
  end if;

  v_acceso := publico.acceso_cliente_por_dominio(host);
  if v_acceso is null or v_acceso ->> 'estado' is distinct from 'activa' then
    return null;
  end if;
  v_tipo := v_acceso ->> 'tipo';
  if v_tipo is null or v_tipo not in ('minorista', 'mayorista') then
    return null;
  end if;

  select e.id into v_empresa
    from dominio.tiendas ti
    join dominio.empresas e on e.id = ti.empresa_id and e.organizacion_id = ti.organizacion_id
   where ti.dominio = private.normalizar_host(host) and e.activa;
  if v_empresa is null then
    return null;
  end if;

  select jsonb_build_object(
           'tipo', v_tipo,
           'precios', coalesce(jsonb_agg(
             jsonb_build_object(
               'producto_id', x.producto_id,
               'escalas', (
                 select jsonb_agg(
                          jsonb_build_object(
                            'escala', t.escala, 'desde', t.desde, 'hasta', t.hasta,
                            'final', private.precio_final_publico_escala(x.producto_id, v_empresa, t.escala)
                          ) order by t.desde)
                   from (values ('x1', 1, 4), ('x5', 5, 9), ('x10', 10, 49), ('x50', 50, null::int))
                        as t (escala, desde, hasta)
                  where t.escala = 'x1' or v_tipo = 'mayorista'
               )
             ) order by x.producto_id), '[]'::jsonb)
         )
    into v_resultado
    from private.catalogo_tienda_efectivo(v_empresa) x
   where x.efectivo and x.producto_id = any (coalesce(productos, '{}'::uuid[]));

  return v_resultado;
end;
$$;

revoke execute on function publico.precios_cliente_por_dominio(text, uuid[]) from public, anon;
grant execute on function publico.precios_cliente_por_dominio(text, uuid[]) to authenticated;

comment on function publico.precios_cliente_por_dominio(text, uuid[]) is
  'F-CLI-07: precio final por escala de los productos visibles pedidos, según el tipo del cliente con cuenta activa y habilitada en la tienda del host (minorista: x1; mayorista: x1/x5/x10/x50 con rango). Lista blanca; null idéntico si no hay cuenta activa habilitada, host desconocido o empresa desactivada. Máx. 50 productos por llamada (22023).';
