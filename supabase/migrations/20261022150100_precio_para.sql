-- F-PRE-15 (MSF-220, épica MSF-114): `private.precio_para`, el precio de un producto para una
-- empresa y una escala.
-- Esquema: sin tablas nuevas (función en `private`; Principio VII).
--
-- Contrato (FR-025): precio_para(producto, empresa, escala default 'x1') devuelve
--   escala_usada  la escala cuyo precio se usó: la pedida, o 'x1' si esa escala no tiene precio cargado
--   neto          precio en pesos sin IVA: precio de la escala (o de lista) → pesos → regla de la empresa
--   alicuota_*    alícuota efectiva del producto (propia o de la categoría) y si es exenta
--   final         neto con IVA al peso entero (Exento ⇒ final = neto)
-- Reutiliza las fórmulas únicas: `a_pesos` (conversión), `aplicar_regla_precio` (regla de la empresa)
-- y `aplicar_iva` (IVA). Una escala fuera de x1/x5/x10/x50 da error claro (22023), no un precio.
-- Producto o empresa ajenos (o inexistentes) no devuelven filas; USD sin cotización devuelve neto
-- nulo (no se inventa un precio). Como `precios_empresa_neto`, devuelve filas solo con la sección
-- `empresas`, porque sin ver la regla el cálculo parecería «Igual al central» (un precio engañoso).
--
-- NO consulta `tipos_cliente`: quien la llama (Ventas, cuenta web) le pasa
-- `tipos_cliente.escala_precio` (contrato con Clientes y proveedores; ver docs/precios.md).
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function private.precio_para(uuid, uuid, text);

create or replace function private.precio_para(p_producto uuid, p_empresa uuid, p_escala text default 'x1')
returns table (
  escala_usada text,
  neto numeric,
  alicuota_id uuid,
  alicuota_nombre text,
  alicuota_porcentaje numeric,
  alicuota_exenta boolean,
  final numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_escala is null or p_escala not in ('x1', 'x5', 'x10', 'x50') then
    raise exception 'La escala % no existe: usá x1, x5, x10 o x50', coalesce(p_escala, '(vacía)')
      using errcode = '22023';
  end if;
  if (select private.nivel_seccion('empresas')) not in ('lectura', 'edicion') then
    return;
  end if;

  return query
  select
    x.usada,
    x.neto,
    al.alicuota_id,
    al.nombre,
    al.porcentaje,
    coalesce(al.exento, false),
    private.aplicar_iva(x.neto, al.porcentaje, coalesce(al.exento, false))
  from dominio.productos p
  join dominio.empresas e on e.id = p_empresa and e.organizacion_id = p.organizacion_id
  left join dominio.precios_empresa r on r.empresa_id = e.id and r.organizacion_id = e.organizacion_id
  left join dominio.producto_precios_escala s
    on s.producto_id = p.id and s.organizacion_id = p.organizacion_id and s.escala = p_escala
  cross join lateral (
    select
      case when s.precio is not null then p_escala else 'x1' end as usada,
      private.aplicar_regla_precio(
        private.a_pesos(coalesce(s.precio, p.precio_lista), p.moneda, p.organizacion_id),
        coalesce(r.base, 'central'), coalesce(r.ajuste_pct, 0), coalesce(r.redondeo_pesos, 10)
      ) as neto
  ) x
  left join lateral private.alicuota_producto(p.id) al on true
  where p.id = p_producto;
end;
$$;

comment on function private.precio_para(uuid, uuid, text) is
  'F-PRE-15: neto, alícuota y final de un producto para una empresa y una escala (x1/x5/x10/x50). Escala sin precio → lista (escala_usada = x1); escala inexistente → 22023. No consulta tipos_cliente.';

revoke execute on function private.precio_para(uuid, uuid, text) from public, anon;
grant execute on function private.precio_para(uuid, uuid, text) to authenticated;
