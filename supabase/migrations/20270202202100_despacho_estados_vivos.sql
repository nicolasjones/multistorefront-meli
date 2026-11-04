-- MSF-598 (bug, spec 20261024-130000-ventas-despacho-y-faltantes, FR-003 y FR-008): `cambiar_estado_despacho`
-- exigía `estado = 'confirmada'` y rechazaba con «Solo las facturas confirmadas se despachan» (55000) a una factura
-- que ya pasó por `registrar_cobro` (Cobrado/Deuda) o por `cambiar_estado_comprobante` (Aceptado, En proceso,
-- Armando, Incompleto): el estado documental/de cobro y el de despacho son ejes independientes, así que una factura
-- cobrada dejaba de poder armarse, controlarse y entregarse.
--
-- Decisión del producto: el despacho se permite en cualquier estado VIVO de la factura: confirmada, aceptado,
-- en_proceso, armando, incompleto, cobrado y deuda. Quedan fuera borrador, pendiente y anulada. No cambia el
-- modelo de estados de despacho ni sus transiciones.
--
-- Esquema (Principio VII): sin tablas nuevas; solo se redefine `public.cambiar_estado_despacho` con la misma firma,
-- permisos (`puede_despachar_en_empresa`) y grants. Migración aditiva. Reversión (migración posterior): reaplicar la
-- definición de `20270112100700_despacho_permiso_por_empresa.sql`.

create or replace function public.cambiar_estado_despacho(
  p_id uuid,
  p_estado text,
  p_responsable_id uuid,
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
  v_destino text := lower(btrim(coalesce(p_estado, '')));
  v_c dominio.comprobantes_venta;
  v_fila dominio.comprobantes_venta;
  v_funcion text;
  v_rol_responsable text;
  v_nombre_responsable text;
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para despachar' using errcode = '42501';
  end if;
  if v_destino not in ('armando', 'listo_para_despachar', 'entregado') then
    raise exception 'El estado "%" no es un estado de despacho', p_estado using errcode = '22023';
  end if;
  if p_responsable_id is null then
    raise exception 'Elegí quién responde por este paso del despacho' using errcode = '22023';
  end if;

  -- La fila se toma `for update`: dos despachos simultáneos se serializan.
  select * into v_c
    from dominio.comprobantes_venta c
   where c.id = p_id and c.organizacion_id = v_org
   for update;
  if not found or v_c.empresa_id is null then
    raise exception 'El comprobante no existe' using errcode = 'P0002';
  end if;
  if v_c.tipo <> 'factura' then
    raise exception 'Un presupuesto no entra al despacho: solo las facturas se arman, controlan y entregan' using errcode = '22023';
  end if;
  if v_c.estado not in ('confirmada', 'aceptado', 'en_proceso', 'armando', 'incompleto', 'cobrado', 'deuda') then
    raise exception 'Solo las facturas vigentes (no anuladas ni sin confirmar) se despachan' using errcode = '55000';
  end if;
  if v_c.estado_despacho is null then
    raise exception 'Esta factura todavía no tiene estado de despacho' using errcode = '55000';
  end if;

  -- Permisos: la acción `despachar` en la tienda DEL COMPROBANTE (no en la activa). Sin acceso a esa tienda
  -- la persona no puede avanzar su despacho.
  if not (select private.puede_despachar_en_empresa(v_c.empresa_id)) then
    raise exception 'Tu rol no puede despachar comprobantes de esta tienda' using errcode = '42501';
  end if;

  -- Idempotente (FR-003): el estado ya alcanzado devuelve el comprobante sin tocar responsables ni stock.
  if v_c.estado_despacho = v_destino then
    return v_c;
  end if;

  -- Transiciones del Flujo 1.
  if not (
       (v_c.estado_despacho in ('sin_armar', 'incompleto') and v_destino = 'armando')
    or (v_c.estado_despacho = 'armando' and v_destino = 'listo_para_despachar')
    or (v_c.estado_despacho = 'listo_para_despachar' and v_destino = 'entregado')
  ) then
    raise exception 'Una factura % no puede pasar a %',
      private.etiqueta_estado_despacho(v_c.estado_despacho),
      private.etiqueta_estado_despacho(v_destino)
      using errcode = '55000';
  end if;

  -- Bloqueo optimista (FR-003).
  if p_actualizado_en is distinct from v_c.updated_at then
    raise exception 'Alguien modificó este comprobante mientras lo mirabas: recargalo y volvé a intentar' using errcode = '40001';
  end if;

  -- Responsable elegible para este paso (FR-004, FR-005, FR-006).
  v_funcion := case v_destino
    when 'armando' then 'armar'
    when 'listo_para_despachar' then 'controlar'
    else 'entregar'
  end;
  v_rol_responsable := (select private.rol_usuario_en_empresa(v_org, p_responsable_id, v_c.empresa_id));
  if v_rol_responsable is null
     or not (select private.responsable_despacho_habilitado(v_org, v_rol_responsable, v_funcion)) then
    raise exception 'Esa persona no puede %s esta factura: elegí a alguien con el rol que corresponde',
      case v_funcion when 'armar' then 'armar' when 'controlar' then 'controlar' else 'entregar' end
      using errcode = '42501';
  end if;
  -- Quien armó no puede controlar, salvo el Administrador (FR-005).
  if v_destino = 'listo_para_despachar'
     and v_c.armo_id is not null
     and v_c.armo_id = p_responsable_id
     and v_rol_responsable <> 'administrador' then
    raise exception 'Quien armó el pedido no puede controlarlo: elegí otra persona' using errcode = '42501';
  end if;

  -- Entregar descuenta las reservas «A pedido» en esta misma transacción (FR-007): si algo falla, no se entrega.
  if v_destino = 'entregado' then
    perform private.descontar_reservas_entrega(v_c.id);
  end if;

  update dominio.comprobantes_venta
     set estado_despacho = v_destino,
         armo_id = case when v_destino = 'armando' then p_responsable_id else armo_id end,
         controlo_id = case when v_destino = 'listo_para_despachar' then p_responsable_id else controlo_id end,
         entrego_id = case when v_destino = 'entregado' then p_responsable_id else entrego_id end,
         entregado_en = case when v_destino = 'entregado' then now() else entregado_en end,
         updated_at = clock_timestamp()
   where id = v_c.id
  returning * into v_fila;

  select coalesce(nullif(btrim(concat_ws(' ', pu.nombre, pu.apellido)), ''), au.email::text)
    into v_nombre_responsable
    from auth.users au
    left join public.perfiles_usuario pu on pu.user_id = au.id
   where au.id = p_responsable_id;

  perform private.registrar_actividad(
    'despacho.estado_cambiado',
    format('Despacho: %s → %s en la factura %s (%s)',
      private.etiqueta_estado_despacho(v_c.estado_despacho),
      private.etiqueta_estado_despacho(v_destino),
      v_fila.numero,
      coalesce(v_nombre_responsable, 'sin nombre')),
    v_fila.empresa_id
  );

  return v_fila;
end;
$$;

comment on function public.cambiar_estado_despacho(uuid, text, uuid, timestamptz) is
  'Avanza el despacho de una factura (F-VTA-15): sin_armar → armando → listo_para_despachar → entregado, con el responsable de cada paso, bloqueo optimista, idempotencia y descuento de las reservas «A pedido» al entregar. Exige la acción `despachar` de Ventas en la empresa del comprobante y una factura en estado vivo (MSF-598: confirmada, aceptado, en proceso, armando, incompleto, cobrado o deuda; no anulada).';

revoke execute on function public.cambiar_estado_despacho(uuid, text, uuid, timestamptz) from public, anon;
grant execute on function public.cambiar_estado_despacho(uuid, text, uuid, timestamptz) to authenticated;
