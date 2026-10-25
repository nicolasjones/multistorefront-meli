-- F-CLI-07 (MSF-432, épica MSF-237, spec 20261024-051500-cuenta-web-del-cliente): precio final público de un
-- producto para una escala. FR-033.
--
-- Esquemas (Principio VII, re-verificado): no se crea ni altera ninguna tabla.
--   * private.precio_final_publico_escala -> `private` (función interna; la usan las funciones de `publico`).
--
-- Misma fórmula que private.precio_final_publico (x1) pero eligiendo la escala: precio de la escala (o de
-- lista si esa escala no tiene precio ⇒ x1, igual que private.precio_para) -> a_pesos -> regla de la
-- empresa (aplicar_regla_precio) -> IVA según el interruptor de la empresa (aplicar_iva). Reutiliza las
-- fórmulas únicas de Precios; no las duplica. Escala fuera de x1/x5/x10/x50 => 22023.
-- Sin `grant` a anon/authenticated: el aislamiento lo da quien la llama.
--
-- Migración aditiva. Reversión (migración posterior; no se ejecuta en el mismo PR):
--   drop function private.precio_final_publico_escala(uuid, uuid, text);

create or replace function private.precio_final_publico_escala(p_producto uuid, p_empresa uuid, p_escala text)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_final numeric;
begin
  if p_escala is null or p_escala not in ('x1', 'x5', 'x10', 'x50') then
    raise exception 'La escala % no existe: usá x1, x5, x10 o x50', coalesce(p_escala, '(vacía)')
      using errcode = '22023';
  end if;

  select case
           when coalesce(r.mostrar_con_iva, false)
             then private.aplicar_iva(x.neto, al.porcentaje, coalesce(al.exento, false))
           else x.neto
         end
    into v_final
    from dominio.productos p
    join dominio.empresas e on e.id = p_empresa and e.organizacion_id = p.organizacion_id
    join dominio.producto_empresa pe
      on pe.producto_id = p.id and pe.empresa_id = e.id and pe.organizacion_id = p.organizacion_id
    left join dominio.precios_empresa r on r.empresa_id = e.id and r.organizacion_id = e.organizacion_id
    left join dominio.producto_precios_escala s
      on s.producto_id = p.id and s.organizacion_id = p.organizacion_id and s.escala = p_escala
    left join dominio.categorias c on c.id = p.categoria_id and c.organizacion_id = p.organizacion_id
    left join dominio.alicuotas_iva al
      on al.id = coalesce(p.alicuota_iva_id, c.alicuota_iva_id) and al.organizacion_id = p.organizacion_id
    cross join lateral (
      select private.aplicar_regla_precio(
               private.a_pesos(coalesce(s.precio, p.precio_lista), p.moneda, p.organizacion_id),
               coalesce(r.base, 'central'), coalesce(r.ajuste_pct, 0), coalesce(r.redondeo_pesos, 10)
             ) as neto
    ) x
   where p.id = p_producto;

  return v_final;
end;
$$;

comment on function private.precio_final_publico_escala(uuid, uuid, text) is
  'F-CLI-07: precio final en pesos enteros de un producto para una empresa y una escala (x1/x5/x10/x50): regla de la empresa + IVA según su interruptor, con las fórmulas únicas de Precios. Escala sin precio ⇒ lista (x1). null si no es calculable; escala inexistente ⇒ 22023. Sin acceso para anon/authenticated.';

revoke execute on function private.precio_final_publico_escala(uuid, uuid, text) from public, anon, authenticated;
