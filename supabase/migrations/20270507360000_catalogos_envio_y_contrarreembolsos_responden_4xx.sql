-- Lote 59 (MSF-654 y MSF-655, quinta ola de la convención de códigos de negocio mapeados a 4xx; ver docs/errores-negocio-postgrest.md): las RPC de formas
-- de envío, transportes, contrarreembolsos y envíos en moto de Ventas dejan de contestar HTTP 500 cuando el dato no existe
-- (`P0002`) o lo editó otra persona (`40001`). Misma regla que 20270507340000 y 20270507350000: «no existe / no es de tu
-- organización» pasa a `PT404` (HTTP 404) y el conflicto de edición (bloqueo optimista por `updated_at`) a `PT412`
-- (HTTP 412). Mensaje de negocio idéntico.
-- Funciones: actualizar_forma_envio, cambiar_estado_forma_envio, actualizar_transporte, cambiar_estado_transporte,
-- marcar_contrarreembolso_cobrado y actualizar_envio_moto.
--
-- Cada función parte de su definición VIGENTE (indicada sobre ella; ninguna fue reescrita in situ por un barrido
-- posterior) y solo cambia el errcode de esos rechazos: mensajes, cuerpo, firma, `security`, `search_path` y grants son los
-- mismos (`create or replace` conserva privilegios y comentario). Ninguna es llamable por `anon` ni la consumen Kestra,
-- workers o Edge Functions: solo la web. Quedan fuera `conciliar_pago` y `revertir_conciliacion_pago` (son envoltorios que
-- delegan en funciones de `private`, donde se lanzan los errores), `55000` y los demás códigos.
--
-- Además actualiza los `comment on function` de actualizar_forma_pago, actualizar_cuenta_cobro, actualizar_forma_envio,
-- actualizar_transporte y actualizar_envio_moto, que nombraban `40001` como código del conflicto de edición (las dos primeras
-- se migraron en 20270507350000 y su comentario no se tocó entonces).
--
-- Migración aditiva (create or replace). Reversión: volver a aplicar la definición vigente indicada sobre cada función
-- y sus comentarios anteriores (en el cuerpo, `errcode = 'PT404'` vuelve a `'P0002'` y `errcode = 'PT412'` a `'40001'`). El cliente acepta los dos códigos.

-- actualizar_forma_envio: definición vigente en 20261022120200_formas_envio_rpc.sql
create or replace function public.actualizar_forma_envio(
  p_id uuid,
  p_actualizado_en timestamptz,
  p_nombre text,
  p_tipo text,
  p_exige_transporte_guia boolean,
  p_costo_defecto numeric,
  p_estado_despacho_inicial text,
  p_orden integer,
  p_activo boolean
)
returns dominio.formas_envio
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actual dominio.formas_envio;
  v_fila dominio.formas_envio;
begin
  if (select private.organizacion_id()) is null
     or not (select private.es_administrador_de((select private.organizacion_id()))) then
    raise exception 'Solo el Administrador puede editar formas de envío' using errcode = '42501';
  end if;

  if btrim(coalesce(p_nombre, '')) = '' then
    raise exception 'Completá el nombre' using errcode = '22023';
  end if;
  if length(btrim(p_nombre)) > 100 then
    raise exception 'El nombre admite hasta 100 caracteres' using errcode = '22023';
  end if;
  if p_tipo is null or p_tipo not in ('retiro_local', 'correo', 'expreso', 'moto', 'terminal') then
    raise exception 'El tipo de forma de envío no es válido' using errcode = '22023';
  end if;
  if p_estado_despacho_inicial is null
     or p_estado_despacho_inicial not in ('sin_armar', 'armando', 'listo_para_despachar') then
    raise exception 'El estado de despacho inicial no es válido' using errcode = '22023';
  end if;
  if p_exige_transporte_guia is null or p_activo is null then
    raise exception 'Faltan datos de la forma de envío' using errcode = '22023';
  end if;
  if p_costo_defecto is not null and (p_costo_defecto < 0 or p_costo_defecto >= 10000000000) then
    raise exception 'El costo por defecto debe ser un importe de 0 en adelante' using errcode = '22023';
  end if;
  if p_orden is null or p_orden < 0 or p_orden > 9999 then
    raise exception 'El orden debe estar entre 0 y 9999' using errcode = '22023';
  end if;

  -- Serializa ediciones concurrentes; RLS acota a la organización y a las empresas accesibles.
  select * into v_actual from dominio.formas_envio where id = p_id for update;
  if not found then
    raise exception 'La forma de envío no existe' using errcode = 'PT404';
  end if;
  if p_actualizado_en is null or v_actual.updated_at <> p_actualizado_en then
    raise exception 'La forma de envío fue modificada por otra persona' using errcode = 'PT412';
  end if;

  update dominio.formas_envio
     set nombre = p_nombre,
         tipo = p_tipo,
         exige_transporte_guia = p_exige_transporte_guia,
         costo_defecto = p_costo_defecto,
         estado_despacho_inicial = p_estado_despacho_inicial,
         orden = p_orden,
         activo = p_activo
   where id = p_id
  returning * into v_fila;
  return v_fila;
end;
$$;

-- cambiar_estado_forma_envio: definición vigente en 20261022120200_formas_envio_rpc.sql
create or replace function public.cambiar_estado_forma_envio(p_id uuid, p_activo boolean)
returns dominio.formas_envio
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_fila dominio.formas_envio;
begin
  if (select private.organizacion_id()) is null
     or not (select private.es_administrador_de((select private.organizacion_id()))) then
    raise exception 'Solo el Administrador puede cambiar el estado de las formas de envío' using errcode = '42501';
  end if;
  if p_activo is null then
    raise exception 'El estado es obligatorio' using errcode = '22023';
  end if;

  select * into v_fila from dominio.formas_envio where id = p_id for update;
  if not found then
    raise exception 'La forma de envío no existe' using errcode = 'PT404';
  end if;
  if v_fila.activo = p_activo then
    return v_fila;
  end if;

  update dominio.formas_envio set activo = p_activo where id = p_id returning * into v_fila;
  return v_fila;
end;
$$;

-- actualizar_transporte: definición vigente en 20261022120800_transportes_rpc.sql
create or replace function public.actualizar_transporte(
  p_id uuid,
  p_actualizado_en timestamptz,
  p_nombre text,
  p_tipo text,
  p_cuit text default null,
  p_terminal_retiro text default null,
  p_localidad text default null,
  p_telefono text default null,
  p_correo text default null,
  p_persona_contacto text default null,
  p_direccion text default null,
  p_cobra_contrarreembolso boolean default false,
  p_comision_pct numeric default 0,
  p_plazo_rendicion_dias integer default 0,
  p_orden integer default 0,
  p_activa boolean default true,
  p_empresa_ids uuid[] default '{}'
)
returns dominio.transportes
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actual dominio.transportes;
  v_fila dominio.transportes;
  v_empresas_cambiaron boolean;
begin
  if v_org is null or not (select private.es_administrador_de(v_org)) then
    raise exception 'Solo un Administrador puede editar transportes' using errcode = '42501';
  end if;
  if btrim(coalesce(p_nombre, '')) = '' then
    raise exception 'El nombre es obligatorio' using errcode = '22023';
  end if;
  if p_tipo is null or p_tipo not in ('expreso', 'correo', 'moto_propia') then
    raise exception 'El tipo no es válido: usá expreso, correo o moto_propia' using errcode = '22023';
  end if;

  -- Serializa ediciones concurrentes del mismo transporte; RLS acota a la organización.
  select * into v_actual from dominio.transportes where id = p_id for update;
  if not found then
    raise exception 'El transporte no existe' using errcode = 'PT404';
  end if;
  if p_actualizado_en is null or v_actual.updated_at <> p_actualizado_en then
    raise exception 'El transporte fue modificado por otra persona' using errcode = 'PT412';
  end if;

  update dominio.transportes
     set nombre = p_nombre,
         tipo = p_tipo,
         cuit = p_cuit,
         terminal_retiro = p_terminal_retiro,
         localidad = p_localidad,
         telefono = p_telefono,
         correo = p_correo,
         persona_contacto = p_persona_contacto,
         direccion = p_direccion,
         cobra_contrarreembolso = coalesce(p_cobra_contrarreembolso, false),
         comision_pct = coalesce(p_comision_pct, 0),
         plazo_rendicion_dias = coalesce(p_plazo_rendicion_dias, 0),
         orden = coalesce(p_orden, 0),
         activa = coalesce(p_activa, true)
   where id = p_id
  returning * into v_fila;

  v_empresas_cambiaron := private.asegurar_empresas_de_transporte(v_fila.id, v_fila.organizacion_id, p_empresa_ids);
  if v_empresas_cambiaron and v_fila.updated_at = v_actual.updated_at then
    -- Cambió solo el conjunto de empresas: el bloqueo optimista también debe avanzar.
    update dominio.transportes
       set updated_at = greatest(clock_timestamp(), v_actual.updated_at + interval '1 microsecond')
     where id = p_id
    returning * into v_fila;
  end if;
  return v_fila;
end;
$$;

-- cambiar_estado_transporte: definición vigente en 20261022120800_transportes_rpc.sql
create or replace function public.cambiar_estado_transporte(p_id uuid, p_activa boolean)
returns dominio.transportes
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_fila dominio.transportes;
begin
  if v_org is null or not (select private.es_administrador_de(v_org)) then
    raise exception 'Solo un Administrador puede cambiar el estado de los transportes' using errcode = '42501';
  end if;
  if p_activa is null then
    raise exception 'El estado es obligatorio' using errcode = '22023';
  end if;

  select * into v_fila from dominio.transportes where id = p_id for update;
  if not found then
    raise exception 'El transporte no existe' using errcode = 'PT404';
  end if;
  if v_fila.activa = p_activa then
    return v_fila;
  end if;

  update dominio.transportes set activa = p_activa where id = p_id returning * into v_fila;
  return v_fila;
end;
$$;

-- marcar_contrarreembolso_cobrado: definición vigente en 20270114120100_marcar_contrarreembolso_cobrado.sql
create or replace function public.marcar_contrarreembolso_cobrado(
  p_id uuid,
  p_actualizado_en timestamptz
)
returns dominio.contrarreembolsos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_cr dominio.contrarreembolsos;
  v_c dominio.comprobantes_venta;
  v_forma_pago_id uuid;
  v_cobro_id uuid;
  v_nombre text;
  v_fila dominio.contrarreembolsos;
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para cobrar contrarreembolsos' using errcode = '42501';
  end if;

  -- ── El contrarreembolso, con bloqueo de fila: serializa dos «Marcar cobrado» ──
  select * into v_cr
    from dominio.contrarreembolsos cr
   where cr.id = p_id
     and cr.organizacion_id = v_org
     for update;
  if not found then
    raise exception 'El contrarreembolso no existe' using errcode = 'PT404';
  end if;

  -- ── El permiso es el de la EMPRESA del contrarreembolso (FR-041) ───────────
  if not (select private.puede_cobrar_contrarreembolso_en_empresa(v_cr.empresa_id)) then
    raise exception 'Tu rol no puede cobrar contrarreembolsos en esta tienda' using errcode = '42501';
  end if;

  -- ── Idempotente (FR-042): si ya está Cobrado, se devuelve tal cual ─────────
  -- Un doble clic no cobra dos veces: no hay segundo cobro ni segundo evento.
  if v_cr.estado = 'cobrado' then
    return v_cr;
  end if;

  -- ── Bloqueo optimista (FR-042): la versión leída en pantalla tiene que ser la ──
  if p_actualizado_en is null or v_cr.actualizado_en <> p_actualizado_en then
    raise exception 'El contrarreembolso fue modificado por otra persona' using errcode = 'PT412';
  end if;

  -- ── El comprobante (FR-044): un comprobante anulado no se cobra ────────────
  select * into v_c
    from dominio.comprobantes_venta c
   where c.id = v_cr.comprobante_id
     and c.organizacion_id = v_org;
  if not found then
    raise exception 'El comprobante no existe' using errcode = 'PT404';
  end if;

  if v_c.estado = 'anulada' then
    raise exception 'La factura está anulada: el contrarreembolso no se puede cobrar' using errcode = '55000';
  end if;

  -- ── La forma del cobro: la de la factura si la tiene; si no, la forma ──────
  -- «Contrarreembolso» de la tienda (es la forma con la que el transporte cobra al entregar).
  v_forma_pago_id := v_c.forma_pago_id;
  if v_forma_pago_id is null then
    select f.id into v_forma_pago_id
      from dominio.formas_pago f
     where f.organizacion_id = v_org
       and f.empresa_id = v_cr.empresa_id
       and f.tipo = 'contrarreembolso'
       and f.activo
     order by f.orden, f.nombre
     limit 1;
  end if;
  if v_forma_pago_id is null then
    raise exception 'La factura no tiene forma de pago y la tienda no tiene una forma «Contrarreembolso»: no se puede registrar el cobro'
      using errcode = '22023';
  end if;

  -- ── Quién cobra (foto del nombre: el historial sobrevive a la baja) ────────
  select coalesce(nullif(btrim(concat_ws(' ', pr.nombre, pr.apellido)), ''), u.email::text)
    into v_nombre
    from auth.users u
    left join public.perfiles_usuario pr on pr.user_id = u.id
   where u.id = v_actor;
  if v_nombre is null then
    raise exception 'El usuario que cobra el contrarreembolso no existe' using errcode = '22023';
  end if;

  -- ── El cobro en el libro, con origen `contrarreembolso` (FR-042) ───────────
  -- `private.registrar_cobro_interno` valida el tope contra el saldo y aplica Cobrado/Deuda
  -- (FR-003 y FR-004 de F-VTA-12): es la única vía, nadie más mueve el estado.
  v_cobro_id := private.registrar_cobro_interno(
    v_cr.comprobante_id, v_cr.importe, v_forma_pago_id, null, 'contrarreembolso', v_actor);

  -- ── El contrarreembolso pasa a Cobrado ────────────────────────────────────
  update dominio.contrarreembolsos
     set estado = 'cobrado',
         cobrado_por = v_actor,
         cobrado_por_nombre = v_nombre,
         cobrado_en = now(),
         cobro_id = v_cobro_id,
         -- now() es constante en la transacción: sin esto dos cambios en la misma transacción
         -- repetirían actualizado_en y no avanzaría el bloqueo.
         actualizado_en = greatest(clock_timestamp(), v_cr.actualizado_en + interval '1 microsecond')
   where id = v_cr.id
  returning * into v_fila;

  -- ── El evento (FR-043): misma transacción, con el actor, la tienda y la guía ─
  perform private.insertar_actividad(
    v_org,
    v_actor,
    'contrarreembolso.cobrado',
    format('Contrarreembolso de %s cobrado (guía %s) en la factura %s',
      v_cr.importe, v_cr.guia, v_c.numero),
    v_cr.empresa_id
  );

  return v_fila;
end;
$$;

-- actualizar_envio_moto: definición vigente en 20270228110000_envios_moto_factura_anulada_y_borrador.sql
create or replace function public.actualizar_envio_moto(
  p_id uuid,
  p_mensajero text,
  p_guia text,
  p_costo_envio numeric,
  p_abono numeric,
  p_enviado boolean,
  p_actualizado_en timestamptz
)
returns dominio.envios_moto
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_mensajero text := private.normalizar_mensajero(p_mensajero);
  v_guia text := nullif(btrim(coalesce(p_guia, '')), '');
  v_ant dominio.envios_moto;
  v_c dominio.comprobantes_venta;
  v_e dominio.envios_moto;
  v_cambios text[] := array[]::text[];
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para editar envíos en moto' using errcode = '42501';
  end if;

  -- ── Validaciones del pedido (FR-005) ──────────────────────────────────────
  if p_id is null then
    raise exception 'El envío es obligatorio' using errcode = '22023';
  end if;
  if v_mensajero = '' then
    raise exception 'El mensajero es obligatorio' using errcode = '22023', hint = 'mensajero';
  end if;
  if length(v_mensajero) > 100 then
    raise exception 'El mensajero no puede tener más de 100 caracteres' using errcode = '22023', hint = 'mensajero';
  end if;
  if v_guia is not null and length(v_guia) > 100 then
    raise exception 'La guía no puede tener más de 100 caracteres' using errcode = '22023', hint = 'guia';
  end if;
  if p_costo_envio is null or p_costo_envio < 0 then
    raise exception 'El costo de envío tiene que ser cero o mayor' using errcode = '22023', hint = 'costo_envio';
  end if;
  if round(p_costo_envio, 2) <> p_costo_envio then
    raise exception 'El costo de envío puede tener hasta dos decimales' using errcode = '22023', hint = 'costo_envio';
  end if;
  if p_costo_envio > 999999999999.99 then
    raise exception 'El costo de envío no puede ser mayor a 999999999999.99' using errcode = '22023', hint = 'costo_envio';
  end if;
  if p_abono is null or p_abono < 0 then
    raise exception 'El importe que abona al recibir tiene que ser cero o mayor' using errcode = '22023', hint = 'abono';
  end if;
  if round(p_abono, 2) <> p_abono then
    raise exception 'El importe que abona al recibir puede tener hasta dos decimales' using errcode = '22023', hint = 'abono';
  end if;
  if p_abono > 999999999999.99 then
    raise exception 'El importe que abona al recibir no puede ser mayor a 999999999999.99' using errcode = '22023', hint = 'abono';
  end if;
  if p_enviado is null then
    raise exception 'Indicá si el envío está enviado' using errcode = '22023', hint = 'enviado';
  end if;

  -- ── El envío: primero se lee sin bloquear y se comprueba el permiso (ver abajo) ──
  select * into v_ant
    from dominio.envios_moto e
   where e.id = p_id
     and e.organizacion_id = v_org;
  if found then
    select * into v_c
      from dominio.comprobantes_venta c
     where c.id = v_ant.comprobante_id
       and c.organizacion_id = v_org;
  end if;

  -- ── El permiso es el de la EMPRESA del comprobante (FR-008), ANTES de cualquier bloqueo ──
  -- Un envío que no existe, de otra organización o de una tienda sin permiso da el MISMO `42501` (no revela existencia).
  if not found or not (select private.puede_registrar_envio_moto_en_empresa(v_c.empresa_id)) then
    raise exception 'Tu rol no puede editar envíos en moto en esta tienda' using errcode = '42501';
  end if;

  -- Con permiso se bloquea la fila: serializa dos ediciones y la rendición.
  select * into v_ant
    from dominio.envios_moto e
   where e.id = p_id
     and e.organizacion_id = v_org
     for update;
  select * into v_c
    from dominio.comprobantes_venta c
   where c.id = v_ant.comprobante_id
     and c.organizacion_id = v_org;

  -- ── Un envío rendido es de solo lectura (FR-005) ──────────────────────────
  if v_ant.rendido then
    raise exception 'El envío ya está rendido: no se puede editar' using errcode = '55000';
  end if;

  -- ── Una factura anulada después de cargar el envío lo bloquea (decisión de Nicolás, 2026-11-12) ──
  if v_c.estado = 'anulada' then
    raise exception 'La factura % fue anulada: el envío en moto ya no se puede editar', v_c.numero
      using errcode = '55000';
  end if;

  -- ── Bloqueo optimista (FR-005): la versión leída en pantalla tiene que ser la vigente ──
  if p_actualizado_en is null or v_ant.updated_at <> p_actualizado_en then
    raise exception 'El envío fue modificado por otra persona' using errcode = 'PT412';
  end if;

  -- ── Qué cambió (para el evento) ───────────────────────────────────────────
  if v_ant.mensajero is distinct from v_mensajero then
    v_cambios := v_cambios || format('mensajero %s → %s', v_ant.mensajero, v_mensajero);
  end if;
  if v_ant.guia is distinct from v_guia then
    v_cambios := v_cambios || format('guía %s → %s', coalesce(v_ant.guia, 'sin guía'), coalesce(v_guia, 'sin guía'));
  end if;
  if v_ant.costo_envio is distinct from p_costo_envio then
    v_cambios := v_cambios || format('costo %s → %s', v_ant.costo_envio, p_costo_envio);
  end if;
  if v_ant.abono is distinct from p_abono then
    v_cambios := v_cambios || format('abona %s → %s', v_ant.abono, p_abono);
  end if;
  if v_ant.enviado is distinct from p_enviado then
    v_cambios := v_cambios || format('enviado %s → %s',
      case when v_ant.enviado then 'sí' else 'no' end, case when p_enviado then 'sí' else 'no' end);
  end if;

  -- ── La edición: no toca `rendido` ni `rendido_en` ─────────────────────────
  update dominio.envios_moto e
     set mensajero = v_mensajero,
         guia = v_guia,
         costo_envio = p_costo_envio,
         abono = p_abono,
         enviado = p_enviado,
         -- now() es constante en la transacción: sin esto dos cambios en la misma transacción
         -- repetirían updated_at y no avanzaría el bloqueo.
         updated_at = greatest(clock_timestamp(), v_ant.updated_at + interval '1 microsecond')
   where e.id = v_ant.id
  returning * into v_e;

  -- ── El evento (FR-009): misma transacción, con actor, comprobante, mensajero y cambios ──
  perform private.registrar_actividad(
    'envio_moto.actualizado',
    left(format('Editó el envío en moto de la factura %s (mensajero %s): %s',
      v_c.numero, v_e.mensajero,
      case when cardinality(v_cambios) = 0 then 'sin cambios' else array_to_string(v_cambios, '; ') end), 500),
    v_c.empresa_id
  );

  return v_e;
end;
$$;

-- Los comentarios de las funciones que nombraban el código viejo del conflicto de edición pasan a `PT412`.
comment on function public.actualizar_forma_pago(uuid, timestamptz, text, text, boolean, boolean, text, integer, boolean) is
  'F-VTA-01: edita una forma de pago con bloqueo optimista por updated_at (PT412 ante conflicto). Solo Administrador; la edición aplica solo a la empresa de la fila.';
comment on function public.actualizar_forma_envio(uuid, timestamptz, text, text, boolean, numeric, text, integer, boolean) is
  'F-VTA-01: edita una forma de envío con bloqueo optimista por updated_at (PT412 ante conflicto). Solo Administrador; la edición aplica solo a la empresa de la fila.';
comment on function public.actualizar_cuenta_cobro(uuid, timestamptz, text, text, text, text, text, text, text, text, integer, boolean, text, uuid[]) is
  'F-VTA-03: edita una cuenta de cobro y su habilitación por empresa con bloqueo optimista por updated_at (PT412 ante conflicto); solo Administrador.';
comment on function public.actualizar_transporte(uuid, timestamptz, text, text, text, text, text, text, text, text, text, boolean, numeric, integer, integer, boolean, uuid[]) is
  'F-VTA-04: edita un transporte y sus empresas con bloqueo optimista por updated_at (PT412 ante conflicto); solo Administrador.';
comment on function public.actualizar_envio_moto(uuid, text, text, numeric, numeric, boolean, timestamptz) is
  'Edita mensajero, guía, costo, abono y Enviado de un envío en moto (F-VTA-24, FR-005): bloqueo optimista por updated_at (PT412), rechaza un envío rendido o de una factura anulada (55000) y nunca escribe rendido ni rendido_en. Exige ventas en edición y rol operador o administrador en la empresa del comprobante. Deja el evento envio_moto.actualizado.';
