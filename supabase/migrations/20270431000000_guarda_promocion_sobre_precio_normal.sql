-- MSF-816 / F-3 (seguimiento S7, hallazgo de la revisión retroactiva de #944/#957/#950): la guarda de confirmación
-- (`private.lineas_con_promocion_desactualizada`) también recalcula la línea cuya promoción guardada SIGUE vigente
-- con el mismo precio y rechaza la confirmación si la promoción dejó de ser ESTRICTAMENTE menor al precio normal.
--
-- Qué había: la guarda no recalculaba el precio normal de una línea con la misma promoción vigente al mismo precio. Si
-- el precio normal bajaba por DEBAJO de la promoción (baja de lista, de escala, de cotización, de la lista de precios
-- del cliente o del descuento del cliente) se cobraba la promoción, que pasaba a ser MAYOR que el precio normal: un
-- sobrecobro al cliente (el motor de precios «gana el más bajo» y esa línea ya no lo cumplía). Estaba documentado como
-- decisión S7 por el costo del recálculo (`precio_para` con la compuerta de la sesión cuesta ≈ 6–8 ms por línea).
--
-- Qué hace ahora (misma firma, mismo dueño, mismo `security definer` con `search_path` vacío, mismos permisos):
--   1. Es candidata TODA línea con promoción (guardada o vigente), no solo las que cambiaron de promoción. La guarda
--      recalcula con `private.precio_linea_venta_calculo` (el mismo cálculo que `precio_linea_venta`, sin repetir la
--      compuerta de la sesión por línea. Es seguro: `confirmar_comprobante` ya validó `nivel_ventas_en_empresa = 'edicion'` (y la
--      pertenencia del comprobante a la organización) ANTES de llamar a la guarda, y esta función es
--      `security definer` sin `execute` para la API; ≈ 1,3–2,5 ms por línea la guarda completa, medido, en lugar de ≈ 6–8 ms). Las líneas sin promoción
--      guardada ni vigente siguen sin recalcularse (un cambio solo del precio normal no se rechaza: no hay promoción
--      que cobrar de más).
--   2. Si la promoción guardada es la que sigue vigente y el cálculo ya no la deja ganar (el precio normal quedó igual o
--      por debajo), rechaza con el MISMO contrato que las demás causas (`40001`, hint `precios_cambiaron`) y
--      `detail = 'promocion_no_menor_al_normal'`. La pantalla lo trata como cualquier `precios_cambiaron`: pide guardar
--      de nuevo las líneas, que repreciaron al precio normal. Una promoción que SIGUE ganando no se rechaza aunque haya
--      cambiado el precio normal (el cliente paga lo que vio y es menor al normal).
--   3. Lee el cliente de `dominio.clientes` (traslado de MSF-505; el cuerpo vigente ya lo nombraba así).
-- El resto (bandera apagada, líneas manuales, `sin_stock`, sin precio calculable, lista de precios F-CLI-21) no cambia.
--
-- Costo (FR-024): medido en dev dentro de `begin…rollback`; ver «Guarda de precios al confirmar» en
-- docs/ventas-comprobantes.md y la medición de 200 líneas de ventas_precio_promocional_ciclo.test.sql.
--
-- Migración aditiva (reemplaza el cuerpo de una función; sin DDL de datos). Pasa `verificar-migraciones.mjs --estricto`.
-- Reversión (migración posterior): volver a crear la función con el cuerpo de 20270348000200_ventas_usan_lista_precios.sql
-- (leyendo `dominio.clientes`).

create or replace function private.lineas_con_promocion_desactualizada(
  p_comprobante uuid,
  p_ahora timestamptz default now()
)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_c record;
  v_tipo_cliente text;
  v_descuento numeric := 0;
  v_promos boolean := private.bandera_activa('promociones_precio');
  v_lista_id uuid;
  v_lista_pct numeric;
  v_n integer;
  v_n_lista integer;
  v_n_sobre integer;
begin
  -- Con las dos banderas apagadas no hay nada que vigilar (idéntico al comportamiento anterior).
  if not v_promos and not private.bandera_activa('listas_precios') and not exists (
    select 1 from dominio.comprobantes_venta_lineas l where l.comprobante_id = p_comprobante and l.lista_precio_id is not null
  ) then
    return 0;
  end if;

  select c.organizacion_id, c.empresa_id, c.cliente_id into v_c
    from dominio.comprobantes_venta c
   where c.id = p_comprobante;
  if not found or v_c.empresa_id is null then
    return 0;
  end if;

  -- Mismo origen del tipo y del descuento que `guardar_lineas_comprobante`.
  select cl.tipo, coalesce(cl.descuento, 0) into v_tipo_cliente, v_descuento
    from dominio.clientes cl
   where cl.id = v_c.cliente_id and cl.organizacion_id = v_c.organizacion_id;
  v_descuento := coalesce(v_descuento, 0);

  -- F-CLI-21: la lista que rige HOY para el cliente (nula con la bandera apagada, sin lista o lista archivada).
  select ls.lista_id, ls.ajuste_pct into v_lista_id, v_lista_pct
    from private.lista_precios_cliente(v_c.cliente_id, v_c.organizacion_id) ls;

  -- FR-024: el cálculo completo (escala, propio, lista, cotización) cuesta más que una búsqueda indexada. Por línea se
  -- mira primero solo la promoción vigente (`promocion_vigente_fila`, índice de MSF-363); pasan al cálculo completo
  -- (`precio_linea_venta_calculo`, que decide con la misma regla del guardado) las líneas CON promoción, guardada o vigente
  -- (la guardada puede haber vencido, haber sido sustituida, haber cambiado de precio o haber dejado de ser menor al
  -- precio normal: este último caso era el hueco S7). Una línea sin promoción guardada ni vigente no se recalcula por
  -- la promoción. F-CLI-21: además es candidata la línea cuyo snapshot de lista ya no coincide con la lista que rige
  -- hoy (porcentaje cambiado, lista reasignada o quitada, bandera apagada) y, si el cliente tiene lista hoy, la que no
  -- guardó ninguna (la recalcula el motor: una con precio propio o escala sigue sin lista y no cuenta). Un
  -- `cross join lateral` sin fila (precio no calculable) omite la línea, y `neto_unitario` nulo también.
  with candidatas as materialized (
    select l.producto_id, l.cantidad, l.promocion_id, l.precio_unitario, l.lista_precio_id, l.lista_ajuste_pct,
           f.promocion_id as vigente_id
      from dominio.comprobantes_venta_lineas l
      left join lateral private.promocion_vigente_fila(l.producto_id, v_c.empresa_id, p_ahora) f on true
     where l.comprobante_id = p_comprobante
       and l.organizacion_id = v_c.organizacion_id
       and not l.precio_manual
       and not l.sin_stock
       and l.producto_id is not null
       and ((v_promos and (f.promocion_id is not null or l.promocion_id is not null))
            or (l.lista_precio_id is not null
                and (v_lista_id is null or l.lista_precio_id <> v_lista_id or l.lista_ajuste_pct <> v_lista_pct))
            or (l.lista_precio_id is null and v_lista_id is not null))
  )
  select count(*) filter (where v_promos and (p.promocion_id is distinct from c.promocion_id
                                              or (p.promocion_id is not null and abs(p.neto_unitario - c.precio_unitario) > 0.005)))::int,
         count(*) filter (where p.lista_precio_id is distinct from c.lista_precio_id
                            or p.lista_ajuste_pct is distinct from c.lista_ajuste_pct)::int,
         -- La promoción guardada sigue vigente pero ya no gana: el precio normal quedó igual o por debajo (sobrecobro).
         count(*) filter (where v_promos and c.promocion_id is not null and c.vigente_id = c.promocion_id
                            and p.promocion_id is null)::int
    into v_n, v_n_lista, v_n_sobre
    from candidatas c
   cross join lateral private.precio_linea_venta_calculo(
           c.producto_id, v_c.empresa_id, v_tipo_cliente, c.cantidad, v_descuento, p_ahora, true,
           case when v_lista_id is null then null else v_c.cliente_id end) p
   where p.neto_unitario is not null;
  -- (El cliente solo entra al cálculo para resolver su lista de precios: sin lista hoy, `null` da el mismo resultado y se
  -- ahorra una búsqueda de lista por línea.)

  -- Mismo contrato público que `confirmar_comprobante` (40001, hint `precios_cambiaron`); `detail` dice qué cambió: la lista
  -- (la pantalla muestra «El precio de la lista cambió») o que la promoción guardada ya no es menor al precio normal. La promoción
  -- cambiada o vencida sigue devolviendo la cantidad (la RPC rechaza sin detail).
  if v_n_lista > 0 then
    raise exception 'Los precios cambiaron: la lista de precios del cliente ya no es la que se usó al guardar las líneas'
      using errcode = '40001', hint = 'precios_cambiaron', detail = 'lista_precios';
  end if;
  if v_n_sobre > 0 then
    raise exception 'Los precios cambiaron: el precio normal bajó y la promoción guardada ya no es menor'
      using errcode = '40001', hint = 'precios_cambiaron', detail = 'promocion_no_menor_al_normal';
  end if;
  return coalesce(v_n, 0);
end;
$$;

revoke execute on function private.lineas_con_promocion_desactualizada(uuid, timestamptz)
  from public, anon, authenticated, service_role;

comment on function private.lineas_con_promocion_desactualizada(uuid, timestamptz) is
  'MSF-816: cuenta las líneas de un comprobante cuya promoción (o precio promocional) ya no es la que se cobraría ahora. Omite precio manual, sin_stock y líneas sin precio calculable; con la bandera promociones_precio apagada devuelve 0. La usa confirmar_comprobante. F-CLI-21: recalcula con la lista de precios del cliente del comprobante y también cuenta la línea cuyo snapshot de lista (id o porcentaje) ya no coincide con el motor. Hueco S7 cerrado: recalcula también la línea cuya promoción sigue vigente al mismo precio y rechaza (40001, hint precios_cambiaron, detail promocion_no_menor_al_normal) si la promoción dejó de ser estrictamente menor al precio normal. Recalcula con precio_linea_venta_calculo (sin la compuerta de la sesión por línea).';
