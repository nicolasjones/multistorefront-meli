-- F-VTA-15 (MSF-152, épica MSF-135, spec 20261024-130000-ventas-despacho-y-faltantes, FR-003, FR-004, FR-005,
-- FR-006, FR-007, FR-010 y FR-011): `public.cambiar_estado_despacho`, la máquina de estados del despacho de una
-- factura, y `public.obtener_despacho_comprobante`, la lectura que la tarjeta «Responsables» necesita.
--
-- Esquema (Principio VII): sin tablas nuevas. Escribe `dominio.comprobantes_venta` (`estado_despacho`, `armo_id`,
-- `controlo_id`, `entrego_id`, `entregado_en`, `updated_at`) y, por el motor de stock, `dominio.existencias(_deposito)`,
-- `dominio.movimientos_stock` y `dominio.reservas_stock` (todas `dominio`); por `private.registrar_actividad`,
-- `public.registro_actividad` (plataforma). Nada se escribe directo desde el navegador: solo por estas RPC.
--
-- Flujo 1 (máquina de estados):
--   sin_armar → armando → listo_para_despachar → entregado
--   incompleto → armando (reanudar el armado; lo deja `registrar_faltantes_despacho`, F-VTA-18)
-- `entregado` es terminal.
--
-- Reglas:
--   · Solo `factura` `confirmada` con estado de despacho (FR-003). Un presupuesto, un borrador o una factura
--     anulada no se despachan (22023 / 55000).
--   · La acción `despachar` de Ventas es el permiso (FR-008) y hace falta ver Ventas en la tienda del
--     comprobante. Depósito despacha con Ventas en `lectura`.
--   · Idempotente: pedir el estado que ya tiene devuelve el comprobante sin tocar responsables ni stock.
--   · Bloqueo optimista por `p_actualizado_en` (40001) y fila `for update`: dos cambios simultáneos no se pisan.
--   · El responsable de cada paso tiene que ser elegible (FR-004, FR-005, FR-006): Depósito o Administrador
--     para armar y controlar; rol con la acción `despachar` para entregar. Quien armó no puede controlar,
--     salvo el Administrador (FR-005).
--   · Entregar descuenta, en la MISMA transacción, las reservas «A pedido» de las líneas del comprobante
--     (FR-007): todo o nada. Las líneas de stock normal no se vuelven a tocar (ya se descontaron al confirmar).
--   · Cada transición registra la actividad `despacho.estado_cambiado` con el estado anterior, el nuevo y el
--     responsable (FR-011).
--
-- Errores: 42501 permiso o responsable no elegible · 22023 dato inválido · P0002 no existe · 55000 transición no
-- permitida o factura sin estado de despacho · 40001 conflicto de `p_actualizado_en`.
--
-- Sobre `descontar_reserva`: la RPC pública de Stock exige `stock` en `edicion` y la autoridad de la entrega es
-- la acción `despachar` de Ventas (un rol con `despachar` puede no tener Stock en edición). Por eso el descuento
-- lo hace `private.descontar_reservas_entrega`, que aplica el mismo movimiento de stock que
-- `public.descontar_reserva` pero sin exigir ese nivel: es la variante interna que el plan anticipa.
--
-- Migración aditiva. Reversión (migración posterior; los despachos hechos NO se deshacen solos: la entrega ya
-- descontó stock, hay que corregirlo por Stock):
--   drop function public.cambiar_estado_despacho(uuid, text, uuid, timestamptz);
--   drop function public.obtener_despacho_comprobante(uuid);
--   drop function private.descontar_reservas_entrega(uuid);
--   drop function private.etiqueta_estado_despacho(text);

-- Etiqueta visible de un estado de despacho (la misma que el catálogo del frontend, `ventasDespacho.ts`).
create or replace function private.etiqueta_estado_despacho(p_estado text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_estado
    when 'sin_armar' then 'Sin armar'
    when 'armando' then 'Armando'
    when 'incompleto' then 'Incompleto'
    when 'listo_para_despachar' then 'Listo para despachar'
    when 'entregado' then 'Entregado'
    else initcap(replace(coalesce(p_estado, ''), '_', ' '))
  end;
$$;

comment on function private.etiqueta_estado_despacho(text) is
  'Etiqueta visible de un estado de despacho (F-VTA-15): Sin armar, Armando, Incompleto, Listo para despachar o Entregado.';

revoke execute on function private.etiqueta_estado_despacho(text) from public, anon, authenticated;

-- Descuento de las reservas «A pedido» de un comprobante al entregarlo (FR-007).
--
-- Variante interna de `public.descontar_reserva`: misma mecánica (cantidad y reservado −n, salida en el libro con
-- el motivo «Entrega de producto a pedido», reserva a `descontada`) pero SIN exigir `stock` en `edicion`, porque
-- la autoridad de la entrega es la acción `despachar` de Ventas en la tienda del comprobante. Mismo orden de
-- bloqueos que la RPC pública (primero el producto, después la reserva) para no deadlockear con ella.
--
-- Todo o nada: si alguna línea «A pedido» no tiene su reserva activa, la excepción revierte la entrega entera
-- (la llamada va dentro de la transacción de `cambiar_estado_despacho`).
create or replace function private.descontar_reservas_entrega(p_comprobante_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_linea record;
  v_reserva dominio.reservas_stock;
  v_motivo uuid;
  v_nombre_actor text;
  v_saldo integer;
  v_total integer := 0;
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para entregar un pedido' using errcode = '42501';
  end if;

  v_motivo := private.motivo_sistema_movimiento(v_org, 'Entrega de producto a pedido', 'salida');
  v_nombre_actor := private.nombre_actor_stock(v_actor);

  for v_linea in
    select l.orden, l.producto_id, l.deposito_id
      from dominio.comprobantes_venta_lineas l
     where l.comprobante_id = p_comprobante_id
       and l.organizacion_id = v_org
       and l.a_pedido
     order by l.producto_id, l.deposito_id, l.orden
  loop
    -- Mismo orden de bloqueos que `public.descontar_reserva`: primero el producto, después la reserva.
    perform 1
      from dominio.existencias e
     where e.producto_id = v_linea.producto_id and e.organizacion_id = v_org
     for update;

    select r.* into v_reserva
      from dominio.reservas_stock r
     where r.organizacion_id = v_org
       and r.referencia = 'comprobante:' || p_comprobante_id::text || ':linea:' || v_linea.orden
     for update;
    if not found then
      raise exception 'No encontramos la reserva de la línea % del pedido: no se puede entregar' , v_linea.orden
        using errcode = '22023';
    end if;
    if v_reserva.estado <> 'activa' then
      raise exception 'La reserva de la línea % del pedido ya fue %: no se puede entregar', v_linea.orden, v_reserva.estado
        using errcode = '22023';
    end if;

    -- Cantidad y reservado −n: el disponible del depósito no cambia, así que la barrera de stock no frena.
    v_saldo := private.aplicar_movimiento_deposito(
      v_org, v_reserva.producto_id, v_reserva.deposito_id, -v_reserva.cantidad, -v_reserva.cantidad, true);

    insert into dominio.movimientos_stock
      (organizacion_id, producto_id, tipo, cantidad, diferencia, saldo, motivo_id, nota, fecha,
       actor_id, actor_nombre, deposito_id)
    values
      (v_org, v_reserva.producto_id, 'salida', v_reserva.cantidad, -v_reserva.cantidad, v_saldo, v_motivo,
       left('Reserva ' || coalesce(v_reserva.referencia, v_reserva.id::text), 500), current_date,
       v_actor, v_nombre_actor, v_reserva.deposito_id);

    update dominio.reservas_stock
       set estado = 'descontada', resuelto_en = now(), updated_at = now()
     where id = v_reserva.id;

    perform private.registrar_actividad(
      'stock.reserva_descontada',
      format('Descontó una reserva de %s unidades, stock resultante %s', v_reserva.cantidad, v_saldo)
    );

    v_total := v_total + 1;
  end loop;

  return v_total;
end;
$$;

comment on function private.descontar_reservas_entrega(uuid) is
  'Descuenta las reservas «A pedido» de un comprobante al entregarlo (F-VTA-15, FR-007), todo o nada. Solo la llama `cambiar_estado_despacho`, en su misma transacción.';

revoke execute on function private.descontar_reservas_entrega(uuid) from public, anon, authenticated;

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
  if v_c.estado <> 'confirmada' then
    raise exception 'Solo las facturas confirmadas se despachan' using errcode = '55000';
  end if;
  if v_c.estado_despacho is null then
    raise exception 'Esta factura todavía no tiene estado de despacho' using errcode = '55000';
  end if;

  -- Permisos: la acción `despachar` de Ventas y el acceso a la tienda del comprobante.
  if not (select private.puede_accion('ventas', 'despachar')) then
    raise exception 'Tu rol no puede despachar' using errcode = '42501';
  end if;
  if (select private.nivel_ventas_en_empresa(v_c.empresa_id)) = 'ninguno' then
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
  'Avanza el despacho de una factura (F-VTA-15): sin_armar → armando → listo_para_despachar → entregado, con el responsable de cada paso, bloqueo optimista, idempotencia y descuento de las reservas «A pedido» al entregar. Exige la acción `despachar` de Ventas.';

revoke execute on function public.cambiar_estado_despacho(uuid, text, uuid, timestamptz) from public, anon;
grant execute on function public.cambiar_estado_despacho(uuid, text, uuid, timestamptz) to authenticated;

-- Estado del despacho y responsables de un comprobante: lo que muestra la tarjeta «Responsables» (FR-010).
-- Exige ver Ventas en la tienda del comprobante, como el resto de las lecturas de comprobantes.
create or replace function public.obtener_despacho_comprobante(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_c dominio.comprobantes_venta;
begin
  if v_org is null or (select auth.uid()) is null then
    raise exception 'Necesitás una sesión con organización para ver el despacho de un comprobante' using errcode = '42501';
  end if;
  select * into v_c
    from dominio.comprobantes_venta c
   where c.id = p_id and c.organizacion_id = v_org;
  if not found or v_c.empresa_id is null then
    raise exception 'El comprobante no existe' using errcode = 'P0002';
  end if;
  if (select private.nivel_ventas_en_empresa(v_c.empresa_id)) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver los comprobantes de esta tienda' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'estado_despacho', v_c.estado_despacho,
    'armo_id', v_c.armo_id,
    'armo', (
      select coalesce(nullif(btrim(concat_ws(' ', pu.nombre, pu.apellido)), ''), au.email::text)
        from auth.users au
        left join public.perfiles_usuario pu on pu.user_id = au.id
       where au.id = v_c.armo_id
    ),
    'controlo_id', v_c.controlo_id,
    'controlo', (
      select coalesce(nullif(btrim(concat_ws(' ', pu.nombre, pu.apellido)), ''), au.email::text)
        from auth.users au
        left join public.perfiles_usuario pu on pu.user_id = au.id
       where au.id = v_c.controlo_id
    ),
    'entrego_id', v_c.entrego_id,
    'entrego', (
      select coalesce(nullif(btrim(concat_ws(' ', pu.nombre, pu.apellido)), ''), au.email::text)
        from auth.users au
        left join public.perfiles_usuario pu on pu.user_id = au.id
       where au.id = v_c.entrego_id
    ),
    'entregado_en', v_c.entregado_en,
    'updated_at', v_c.updated_at,
    -- Si la sesión puede avanzar el despacho (acción `despachar` de Ventas): la tarjeta «Responsables» solo
    -- ofrece la acción cuando la base la aceptaría.
    'puede_despachar', (select private.puede_accion('ventas', 'despachar'))
  );
end;
$$;

comment on function public.obtener_despacho_comprobante(uuid) is
  'Estado del despacho, responsables (Armó, Controló, Entregó) y momento de entrega de un comprobante (F-VTA-15, FR-010). Exige ver Ventas en su tienda.';

revoke execute on function public.obtener_despacho_comprobante(uuid) from public, anon;
grant execute on function public.obtener_despacho_comprobante(uuid) to authenticated;
