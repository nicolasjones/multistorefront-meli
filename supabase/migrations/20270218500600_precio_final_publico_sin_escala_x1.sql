-- MSF-352 (revisión de F-PRE-15, hallazgo MEDIO de QA): código muerto en `private.precio_final_publico`.
-- La función hacía `left join dominio.producto_precios_escala s ... s.escala = 'x1'` y usaba `coalesce(s.precio,
-- p.precio_lista)`, pero `producto_precios_escala` tiene `check (escala in ('x5', 'x10', 'x50'))` (20261022150000): no puede
-- existir una fila 'x1', `s.precio` es siempre nulo y el hueco «x1 con escala manual» es inalcanzable. Se saca el join:
-- el resultado es idéntico (la lista es el precio de x1). En `precio_final_publico_escala` y `precio_para` la condición
-- `p_escala = 'x1'` es redundante con `s.precio is null` y se deja tal cual (no cambia ningún resultado).
-- Un precio de escala x5/x10/x50 cargado a mano SIGUE ganando sobre el precio propio (documentado en
-- 20270213200002; cubierto por pgTAP `precio_propio_escala_manual`).
--
-- Esquema (Principio VII): sin tablas. Migración aditiva (create or replace, misma firma y grants). Reversión: restaurar la
-- función al cuerpo de 20270213200002.

create or replace function private.precio_final_publico(p_producto uuid, p_empresa uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when coalesce(r.mostrar_con_iva, false)
             then private.aplicar_iva(x.neto, al.porcentaje, coalesce(al.exento, false))
           else x.neto
         end
    from dominio.productos p
    join dominio.empresas e on e.id = p_empresa and e.organizacion_id = p.organizacion_id
    join dominio.producto_empresa pe
      on pe.producto_id = p.id and pe.empresa_id = e.id and pe.organizacion_id = p.organizacion_id
    left join dominio.precios_empresa r on r.empresa_id = e.id and r.organizacion_id = e.organizacion_id
    left join dominio.categorias c on c.id = p.categoria_id and c.organizacion_id = p.organizacion_id
    left join dominio.alicuotas_iva al
      on al.id = coalesce(p.alicuota_iva_id, c.alicuota_iva_id) and al.organizacion_id = p.organizacion_id
    left join dominio.precios_propios_empresa pp
      on pp.producto_id = p.id and pp.empresa_id = e.id and pp.organizacion_id = p.organizacion_id
    cross join lateral (
      select case
               when pp.moneda is not null
                 then private.neto_precio_propio(pp.moneda, pp.importe, p.organizacion_id, e.id)
               else private.aplicar_regla_precio(
                      private.a_pesos(p.precio_lista, p.moneda, p.organizacion_id, e.id),
                      coalesce(r.base, 'central'), coalesce(r.ajuste_pct, 0), coalesce(r.redondeo_pesos, 10))
             end as neto
    ) x
   where p.id = p_producto;
$$;

revoke execute on function private.precio_final_publico(uuid, uuid) from public, anon, authenticated;
