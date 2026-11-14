-- MSF-932 (S1 de la épica MSF-816, spec 20261113-120000-precio-promocional-en-pos-y-comprobantes, hallazgo 7, Decisión 7 de
-- MSF-363): la tienda con sesión de cliente aplica las promociones.
--
-- Defecto: `publico.precios_cliente_por_dominio` (F-CLI-07, escalas x1…x50 del mayorista y x1 del minorista) calculaba cada
-- escala con `private.precio_final_publico_escala` y NO miraba la promoción: un mayorista con cantidad 1-4 veía en la tienda su
-- precio x1 sin promoción y en el local (`private.precio_linea_venta`) pagaba la promoción. Esta migración alinea la tienda con la
-- misma regla del local y de `private.precio_referencia_pedido` (lista de pedido): GANA EL MÁS BAJO, SIN ACUMULAR.
--   * por producto se lee UNA vez `private.promocion_vigente(producto, empresa, now())` (la lectura de la promoción de la tienda,
--     que ya devuelve null con la bandera `promociones_precio` APAGADA);
--   * por escala, la promoción (con la alícuota y el interruptor «Precios que ve el cliente»: `private.precio_con_iva_visible`)
--     reemplaza al precio de la escala solo si es ESTRICTAMENTE menor; entonces `final` es el precio promocional y la escala
--     suma `precio_anterior` (el precio de la escala, para el tachado). Si no es menor (promoción mayor o igual, o escala más
--     barata, p. ej. x10 contra una promoción de x1), la escala queda exactamente como antes y SIN la clave `precio_anterior`;
--   * el descuento de la ficha del cliente no entra (igual que antes: solo aparece en la cotización de B2).
-- Bandera apagada o sin promoción vigente: la respuesta es BYTE A BYTE la de antes (el pgTAP lo compara). La lista blanca solo
-- suma `precio_anterior`, y solo en las escalas donde gana la promoción. `private.promocion_vigente` no se toca (si S5 =
-- MSF-936 está en la base, ya ignora una promoción >= precio normal x1; la comparación por escala de acá es propia y vale con o
-- sin S5).
-- Mismos grants, `security definer`, `search_path = ''`, mismo tope de 50 productos y mismas respuestas null.
--
-- Esquema (Principio VII): sin tablas nuevas (`publico` sigue sin tablas). Migración aditiva e idempotente (`create or replace`).
-- Reversión (migración posterior): restaurar `publico.precios_cliente_por_dominio` de 20261211110100.

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
  v_ahora timestamptz := now();
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
                            'final', case when p.gana then p.promocion else p.normal end
                          ) || case when p.gana then jsonb_build_object('precio_anterior', p.normal) else '{}'::jsonb end
                          order by t.desde)
                   from (values ('x1', 1, 4), ('x5', 5, 9), ('x10', 10, 49), ('x50', 50, null::int))
                        as t (escala, desde, hasta)
                  -- Gana el más bajo, sin acumular (igual que el local y que `private.precio_referencia_pedido`): la
                  -- promoción reemplaza al precio de la escala SOLO si, visto como lo ve el cliente (alícuota e
                  -- interruptor de IVA), es estrictamente menor.
                  cross join lateral (
                    select n.v as normal,
                           case when pr.precio is null then null
                                else private.precio_con_iva_visible(x.producto_id, v_empresa, pr.precio) end as promocion,
                           coalesce(private.precio_con_iva_visible(x.producto_id, v_empresa, pr.precio) < n.v, false) as gana
                      from (select private.precio_final_publico_escala(x.producto_id, v_empresa, t.escala) as v) n
                  ) p
                  where t.escala = 'x1' or v_tipo = 'mayorista'
               )
             ) order by x.producto_id), '[]'::jsonb)
         )
    into v_resultado
    from private.catalogo_tienda_efectivo(v_empresa) x
    -- MSF-932 (S1): la promoción vigente de la tienda (ya null con la bandera `promociones_precio` apagada).
    cross join lateral (select private.promocion_vigente(x.producto_id, v_empresa, v_ahora) as precio) pr
   where x.efectivo and x.producto_id = any (coalesce(productos, '{}'::uuid[]));

  return v_resultado;
end;
$$;

revoke execute on function publico.precios_cliente_por_dominio(text, uuid[]) from public, anon;
grant execute on function publico.precios_cliente_por_dominio(text, uuid[]) to authenticated;

comment on function publico.precios_cliente_por_dominio(text, uuid[]) is
  'F-CLI-07: precio final por escala de los productos visibles pedidos, según el tipo del cliente con cuenta activa y habilitada en la tienda del host (minorista: x1; mayorista: x1/x5/x10/x50 con rango). Lista blanca; null idéntico si no hay cuenta activa habilitada, host desconocido o empresa desactivada. Máx. 50 productos por llamada (22023). MSF-932: con una promoción vigente de la tienda menor al precio de la escala (gana el más bajo, sin acumular), la escala trae el precio promocional en final y el de la escala en precio_anterior.';
