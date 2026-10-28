-- F-VTA-18 (MSF-201, épica MSF-135, spec 20261024-130000-ventas-despacho-y-faltantes, FR-041 y FR-042):
-- `public.registrar_faltantes_despacho` (registrar los faltantes de una factura y pasarla a Incompleto) y el
-- disparador que resuelve los faltantes cuando el armado se reanuda.
--
-- Esquema (Principio VII): sin tablas nuevas. Escribe `dominio.faltantes_venta` (dominio, registro de negocio,
-- T028) y `dominio.comprobantes_venta` (dominio, documento de venta) y, por `private.registrar_actividad`,
-- `public.registro_actividad` (plataforma). Nada se escribe directo desde el navegador: solo por esta RPC.
--
-- Reglas de `registrar_faltantes_despacho`:
--   · La factura tiene que estar `armando` o `incompleto` (FR-041). Con `armando` la llamada la deja en
--     `incompleto`; con `incompleto` sigue en `incompleto` y solo ajusta el faltante abierto de la línea:
--     es el escenario 2 de US4 («un faltante ya abierto de esa línea, se vuelve a registrar → se actualiza la
--     cantidad, no se duplica»), que solo puede ocurrir con la factura ya Incompleta.
--   · Cada cantidad va entre 1 y lo pedido en esa línea (FR-041).
--   · Un faltante por línea: si la línea ya tiene un faltante abierto, se ACTUALIZA (la cantidad registrada
--     pasa a ser la nueva) y no se duplica (FR-040, FR-041).
--   · La misma línea dos veces en la misma llamada se rechaza: si no, la cantidad guardada sería la última de
--     las dos y la persona creería que se guardó otra.
--   · La factura pasa a `incompleto` en la MISMA transacción: todo o nada (FR-041). Si una línea está mal, no
--     queda ningún faltante registrado y la factura sigue como estaba.
--   · Permiso: la acción `despachar` de Ventas en la EMPRESA del comprobante (no en la empresa activa), la
--     misma regla de `cambiar_estado_despacho` (F-VTA-15, FR-008).
--   · Bloqueo optimista por `p_actualizado_en` (40001) y fila `for update`: dos registros simultáneos no se pisan.
--   · Actividad `despacho.faltante_registrado` con las líneas y las cantidades (FR-041). Cada llamada
--     exitosa queda registrada: volver a registrar la misma línea es una gestión nueva, no un reintento.
--
-- Un faltante NO mueve stock: registrarlo no descuenta ni devuelve existencias (spec, *Stock*: corregir el
-- stock es de Stock · toma de inventario).
--
-- Errores: 42501 permiso · 22023 dato inválido · P0002 no existe · 55000 la factura no está en Armando ni en
-- Incompleto · 40001 conflicto de `p_actualizado_en`.
--
-- Migración aditiva. Reversión (migración posterior; los faltantes registrados NO se deshacen solos: la factura
-- queda en `incompleto` y hay que corregirla desde el despacho):
--   drop trigger if exists comprobantes_venta_resolver_faltantes on dominio.comprobantes_venta;
--   drop function if exists private.resolver_faltantes_al_reanudar();
--   drop function public.registrar_faltantes_despacho(uuid, jsonb, timestamptz);

create or replace function public.registrar_faltantes_despacho(
  p_id uuid,
  p_faltantes jsonb,
  p_actualizado_en timestamptz
)
returns dominio.comprobantes_venta
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_c dominio.comprobantes_venta;
  v_fila dominio.comprobantes_venta;
  v_linea dominio.comprobantes_venta_lineas;
  v_elem jsonb;
  v_texto text;
  v_orden integer;
  v_cantidad integer;
  v_ordenes integer[] := '{}';
  v_detalle text := '';
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para registrar faltantes' using errcode = '42501';
  end if;

  -- La lista de faltantes: al menos una línea.
  if p_faltantes is null or jsonb_typeof(p_faltantes) <> 'array' or jsonb_array_length(p_faltantes) = 0 then
    raise exception 'Elegí al menos una línea faltante' using errcode = '22023';
  end if;
  -- El mismo tope que las líneas del comprobante: nadie registra 200 faltantes de un pedido.
  if jsonb_array_length(p_faltantes) > 200 then
    raise exception 'Una factura admite hasta 200 líneas' using errcode = '22023';
  end if;

  -- La fila se toma `for update`: dos registros simultáneos se serializan.
  select * into v_c
    from dominio.comprobantes_venta c
   where c.id = p_id and c.organizacion_id = v_org
   for update;
  if not found or v_c.empresa_id is null then
    raise exception 'El comprobante no existe' using errcode = 'P0002';
  end if;
  if v_c.tipo <> 'factura' then
    raise exception 'Solo las facturas registran faltantes' using errcode = '22023';
  end if;
  if v_c.estado <> 'confirmada' then
    raise exception 'Solo las facturas confirmadas registran faltantes' using errcode = '55000';
  end if;
  if v_c.estado_despacho is null then
    raise exception 'Esta factura todavía no tiene estado de despacho' using errcode = '55000';
  end if;
  if v_c.estado_despacho not in ('armando', 'incompleto') then
    raise exception 'Los faltantes se registran con la factura en Armando o Incompleto: ahora está en %',
      private.etiqueta_estado_despacho(v_c.estado_despacho)
      using errcode = '55000';
  end if;

  -- Permisos: la acción `despachar` de Ventas en la tienda DEL COMPROBANTE (no en la activa).
  if not (select private.puede_despachar_en_empresa(v_c.empresa_id)) then
    raise exception 'Tu rol no puede registrar faltantes en esta tienda' using errcode = '42501';
  end if;

  -- Bloqueo optimista (FR-041).
  if p_actualizado_en is distinct from v_c.updated_at then
    raise exception 'Alguien modificó este comprobante mientras lo mirabas: recargalo y volvé a intentar' using errcode = '40001';
  end if;

  for v_elem in select value from jsonb_array_elements(p_faltantes) loop
    -- La línea del faltante: un entero positivo.
    v_texto := btrim(coalesce(v_elem ->> 'linea_orden', ''));
    if v_texto !~ '^[0-9]{1,7}$' then
      raise exception 'La línea del faltante no es válida' using errcode = '22023';
    end if;
    v_orden := v_texto::integer;
    if v_orden = any (v_ordenes) then
      raise exception 'La línea % está repetida: registrale una sola cantidad' , v_orden using errcode = '22023';
    end if;
    v_ordenes := array_append(v_ordenes, v_orden);

    -- La cantidad faltante: un entero positivo.
    v_texto := btrim(coalesce(v_elem ->> 'cantidad', ''));
    if v_texto !~ '^[0-9]{1,7}$' then
      raise exception 'La cantidad faltante de la línea % tiene que ser un número entero', v_orden using errcode = '22023';
    end if;
    v_cantidad := v_texto::integer;

    -- La línea tiene que ser de esta factura (y de esta organización).
    select * into v_linea
      from dominio.comprobantes_venta_lineas l
     where l.comprobante_id = v_c.id
       and l.organizacion_id = v_org
       and l.orden = v_orden;
    if not found then
      raise exception 'La línea % no es de esta factura', v_orden using errcode = '22023';
    end if;

    -- La cantidad va entre 1 y lo pedido de la línea (FR-041).
    if v_cantidad < 1 or v_cantidad > v_linea.cantidad then
      raise exception 'La cantidad faltante de la línea % tiene que estar entre 1 y %',
        v_orden, v_linea.cantidad
        using errcode = '22023';
    end if;

    -- Un faltante por línea: si ya hay uno abierto, se actualiza con la cantidad nueva (no se duplica).
    insert into dominio.faltantes_venta
      (organizacion_id, empresa_id, comprobante_id, linea_orden, producto_id, deposito_id,
       cantidad_faltante, estado, registrado_por)
    values
      (v_org, v_c.empresa_id, v_c.id, v_orden, v_linea.producto_id, v_linea.deposito_id,
       v_cantidad, 'abierto', v_actor)
    on conflict (comprobante_id, linea_orden) where estado = 'abierto'
    do update
      set cantidad_faltante = excluded.cantidad_faltante,
          registrado_por = excluded.registrado_por;

    v_detalle := v_detalle
      || case when v_detalle = '' then '' else '; ' end
      || format('línea %s: %s unidades', v_orden, v_cantidad);
  end loop;

  -- La factura queda en Incompleto en la misma transacción (todo o nada).
  update dominio.comprobantes_venta
     set estado_despacho = 'incompleto',
         updated_at = clock_timestamp()
   where id = v_c.id
  returning * into v_fila;

  perform private.registrar_actividad(
    'despacho.faltante_registrado',
    format('Faltantes en la factura %s: %s', v_fila.numero, v_detalle),
    v_fila.empresa_id
  );

  return v_fila;
end;
$$;

comment on function public.registrar_faltantes_despacho(uuid, jsonb, timestamptz) is
  'Registra los faltantes de una factura en Armando o Incompleto (cantidad entre 1 y lo pedido por línea, un faltante abierto por línea) y la deja en Incompleto, todo o nada. Exige la acción `despachar` de Ventas en la empresa del comprobante.';

revoke execute on function public.registrar_faltantes_despacho(uuid, jsonb, timestamptz) from public, anon;
grant execute on function public.registrar_faltantes_despacho(uuid, jsonb, timestamptz) to authenticated;

-- ============================================================================
-- FR-042 · Al reanudar el armado, los faltantes abiertos se resuelven
-- ============================================================================
-- El disparador corre al pasar la factura de `incompleto` a `armando`: reanudar el armado significa que la
-- mercadería volvió y el faltante se cierra (Decisión abierta 3 de la spec). Va en un disparador y no dentro de
-- `cambiar_estado_despacho` para que valga desde cualquier camino y no dependa de que la RPC que reanuda se
-- acuerde de tocar los faltantes.
--
-- Solo se cierran los faltantes ABIERTOS de esa factura: los ya resueltos quedan como historial. `resuelto_en`
-- queda con el momento del cierre. El disparador no toca el stock ni el estado de la factura.

create or replace function private.resolver_faltantes_al_reanudar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Solo el paso de Incompleto a Armando resuelve faltantes.
  if old.estado_despacho is distinct from 'incompleto' or new.estado_despacho is distinct from 'armando' then
    return new;
  end if;

  update dominio.faltantes_venta
     set estado = 'resuelto',
         resuelto_en = now()
   where comprobante_id = new.id
     and organizacion_id = new.organizacion_id
     and estado = 'abierto';

  return new;
end;
$$;

comment on function private.resolver_faltantes_al_reanudar() is
  'Cierra los faltantes abiertos de una factura que vuelve de Incompleto a Armando (F-VTA-18, FR-042). Solo el disparador la llama.';

revoke execute on function private.resolver_faltantes_al_reanudar() from public, anon, authenticated;

drop trigger if exists comprobantes_venta_resolver_faltantes on dominio.comprobantes_venta;
create trigger comprobantes_venta_resolver_faltantes
  after update of estado_despacho on dominio.comprobantes_venta
  for each row
  when (old.estado_despacho = 'incompleto' and new.estado_despacho = 'armando')
  execute function private.resolver_faltantes_al_reanudar();
