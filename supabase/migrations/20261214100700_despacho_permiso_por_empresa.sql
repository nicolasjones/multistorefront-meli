-- F-VTA-15 (MSF-152, épica MSF-135, spec 20261024-130000-ventas-despacho-y-faltantes, FR-008, FR-010):
-- el permiso `despachar` se evalúa en la EMPRESA del comprobante, no en la empresa activa.
--
-- Devolución del Revisor (seguridad, aislamiento por empresa): `private.puede_accion('ventas', 'despachar')`
-- resuelve las secciones por empresa contra la empresa ACTIVA (ver `private.roles_de_referencia`). Una persona
-- con `deposito` en la tienda A (y A activa) podía despachar una factura de la tienda B donde su rol no tiene la
-- acción `despachar`, porque la RPC solo comprobaba `nivel_ventas_en_empresa(B) <> 'ninguno'`. Mismo bug en el
-- `puede_despachar` que devuelve `obtener_despacho_comprobante`: la tarjeta ofrecía avanzar una factura de una
-- tienda donde la base después rechazaba (o peor, aceptaba por el permiso de otra tienda).
--
-- La regla correcta es la misma que ya usa el resto de Ventas: el nivel del rol en la empresa del documento. Se
-- encapsula en `private.puede_despachar_en_empresa(p_empresa_id)`, que reutiliza la elegibilidad de responsables
-- (`private.responsable_despacho_habilitado(..., 'entregar')`: acción `despachar` + Ventas al menos en lectura) con
-- el rol del actor EN ESA EMPRESA. El superadmin con organización activa conserva el acceso, igual que en
-- `private.puede_accion`.
--
-- Esquema (Principio VII): sin tablas nuevas; solo se redefine una función interna y las dos RPC de despacho.
-- Migración aditiva. Reversión (migración posterior): reaplicar las definiciones de
-- `20261214100500_despacho_cambiar_estado.sql` y `drop function private.puede_despachar_en_empresa(uuid)`.

create or replace function private.puede_despachar_en_empresa(p_empresa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_empresa_id is null then false
    when not exists (
      select 1 from dominio.empresas e
       where e.id = p_empresa_id and e.organizacion_id = (select private.organizacion_id())
    ) then false
    when (select private.is_superadmin())
      and exists (select 1 from public.superadmin_organizacion_activa a where a.user_id = (select auth.uid()))
      then true
    else coalesce(
      private.responsable_despacho_habilitado(
        (select private.organizacion_id()),
        private.rol_usuario_en_empresa(
          (select private.organizacion_id()), (select auth.uid()), p_empresa_id),
        'entregar'
      ),
      false
    )
  end;
$$;

comment on function private.puede_despachar_en_empresa(uuid) is
  'true si el usuario actual tiene la acción `despachar` de Ventas en esa empresa (F-VTA-15, FR-008), con el rol que tiene EN ESA EMPRESA y no en la activa. Superadmin con organización activa: sí. Solo la llaman las RPC de despacho.';

revoke execute on function private.puede_despachar_en_empresa(uuid) from public, anon, authenticated;

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
  'Avanza el despacho de una factura (F-VTA-15): sin_armar → armando → listo_para_despachar → entregado, con el responsable de cada paso, bloqueo optimista, idempotencia y descuento de las reservas «A pedido» al entregar. Exige la acción `despachar` de Ventas en la empresa del comprobante.';

revoke execute on function public.cambiar_estado_despacho(uuid, text, uuid, timestamptz) from public, anon;
grant execute on function public.cambiar_estado_despacho(uuid, text, uuid, timestamptz) to authenticated;

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
    -- La tarjeta solo ofrece avanzar si la base aceptaría ESTA factura: la acción `despachar` se resuelve en
    -- la empresa del comprobante, no en la empresa activa de la barra superior (Principio VIII, FR-012).
    'puede_despachar', (select private.puede_despachar_en_empresa(v_c.empresa_id))
  );
end;
$$;

comment on function public.obtener_despacho_comprobante(uuid) is
  'Estado del despacho, responsables (Armó, Controló, Entregó) y momento de entrega de un comprobante (F-VTA-15, FR-010). Exige ver Ventas en su tienda; `puede_despachar` se resuelve con la acción `despachar` en esa misma empresa.';

revoke execute on function public.obtener_despacho_comprobante(uuid) from public, anon;
grant execute on function public.obtener_despacho_comprobante(uuid) to authenticated;
