-- F-SVC-06 (MSF-362, épica MSF-199): la lectura de la reparación devuelve los ítems y los totales.
-- Esquema: sin tablas nuevas (Principio VII).
--
-- `obtener_reparacion` (y las RPC de escritura de F-SVC-02/03/06, que devuelven el mismo documento)
-- arman su JSON con `private.reparacion_json`; se reemplaza ahí, de forma aditiva, para que todas las
-- respuestas incluyan: `items` (orden de carga), `total_mano_obra`, `total_repuestos`, `total_cliente`
-- (suma de ambos) y `ganancia_estimada` (total al cliente − costos internos), esta última `null` sin la
-- acción `ver_costos` (igual que los costos de MSF-182). Las claves vigentes no cambian.
-- Los ítems no llevan datos de costo del producto: solo SKU y nombre.
--
-- Migración aditiva (`create or replace`). Reversión (migración posterior): restaurar
-- `private.reparacion_json(uuid)` de 20261020110300_reparacion_historial_crear.sql.

create or replace function private.reparacion_json(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id,
    'numero', r.numero,
    'codigo', private.codigo_reparacion(r.numero),
    'empresa_id', r.empresa_id,
    'empresa', e.nombre,
    'cliente_id', r.cliente_id,
    'cliente', c.nombre,
    'contacto', r.contacto,
    'modelo_id', r.modelo_id,
    'equipo', m.equipo,
    'modelo', m.modelo,
    'estado_id', r.estado_id,
    'estado', s.nombre,
    'estado_cierra', s.cierra,
    'estado_tono', s.tono,
    'numero_serie', r.numero_serie,
    'accesorios', r.accesorios,
    'falla', r.falla,
    'puede_ver_costos', v.ver,
    'costo_mano_obra', case when v.ver then r.costo_mano_obra end,
    'costo_repuestos', case when v.ver then r.costo_repuestos end,
    'tecnico_id', r.tecnico_id,
    'ingreso_en', r.ingreso_en,
    'entrega_prevista', r.entrega_prevista,
    'entrega_real', r.entrega_real,
    'entregado_por', r.entregado_por,
    'anulada_en', r.anulada_en,
    'anulada_motivo', r.anulada_motivo,
    'updated_at', r.updated_at,
    'total_mano_obra', r.total_mano_obra,
    'total_repuestos', r.total_repuestos,
    'total_cliente', r.total_mano_obra + r.total_repuestos,
    'ganancia_estimada', case when v.ver
      then r.total_mano_obra + r.total_repuestos - r.costo_mano_obra - r.costo_repuestos end,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'tipo', i.tipo,
        'descripcion', i.descripcion,
        'producto_id', i.producto_id,
        'sku', p.sku,
        'cantidad', i.cantidad,
        'precio_unitario', i.precio_unitario,
        'subtotal', i.subtotal
      ) order by i.creado_en, i.id)
      from dominio.reparacion_items i
      left join dominio.productos p on p.id = i.producto_id and p.organizacion_id = i.organizacion_id
      where i.reparacion_id = r.id
    ), '[]'::jsonb)
  )
  from dominio.reparaciones r
  join dominio.empresas e on e.id = r.empresa_id
  join public.clientes c on c.id = r.cliente_id and c.organizacion_id = r.organizacion_id
  join dominio.modelos_equipo m on m.id = r.modelo_id and m.organizacion_id = r.organizacion_id
  join dominio.estados_reparacion s on s.id = r.estado_id and s.organizacion_id = r.organizacion_id
  cross join (select private.puede_accion('service_tecnico', 'ver_costos') as ver) v
  where r.id = p_id
    and r.organizacion_id = (select private.organizacion_id());
$$;

revoke execute on function private.reparacion_json(uuid) from public, anon, authenticated;
