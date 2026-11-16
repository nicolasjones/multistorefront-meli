-- F-VTA-05 (MSF-273, épica MSF-159, spec 20261023-100000-ventas-comprobantes, FR-001, FR-002, FR-008):
-- RPC de alta, edición de cabecera y lectura del comprobante de venta.
--
-- Esquema (Principio VII): sin tablas nuevas. Escriben `dominio.comprobantes_venta` (dominio) y,
-- por `private.registrar_actividad`, `public.registro_actividad` (public, auditoría transversal).
--
-- Seguridad: las RPC viven en `public`, son `security definer` con `search_path = ''` y la organización
-- y el operador salen de la sesión (`private.organizacion_id()`, `auth.uid()`), nunca de un argumento.
-- El nivel de `ventas` se evalúa en la EMPRESA del comprobante (no solo en la activa): la misma persona
-- puede editar en una tienda y solo leer en otra. `revoke ... from public, anon` y
-- `grant execute ... to authenticated` explícitos (solo las RPC de acceso son ejecutables por `anon`).
--
-- Errores: 42501 permiso · 22023 dato inválido (mensaje en castellano, `hint` = campo) · P0002 no existe ·
-- 55000 documento cerrado · 40001 conflicto de edición (bloqueo optimista por `updated_at`).
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.obtener_comprobante(uuid);
--   drop function public.guardar_comprobante(uuid, uuid, text, date, date, uuid, uuid, timestamptz);
--   drop function public.crear_comprobante(text, uuid, uuid, text, date, date, uuid, uuid);
--   drop function private.validar_catalogo_comprobante(uuid, uuid, uuid, uuid);
--   drop function private.nivel_ventas_en_empresa(uuid);

-- Nivel de `ventas` del usuario actual en una empresa concreta: edicion | lectura | ninguno.
-- Superadmin con organización activa = edicion (igual que nivel_seccion); si no, la empresa debe ser
-- accesible y rige el rol del usuario en ELLA.
create or replace function private.nivel_ventas_en_empresa(p_empresa_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not exists (
      select 1 from dominio.empresas e
      where e.id = p_empresa_id and e.organizacion_id = (select private.organizacion_id())
    ) then 'ninguno'
    when (select private.is_superadmin())
      and exists (select 1 from public.superadmin_organizacion_activa a where a.user_id = (select auth.uid()))
      then 'edicion'
    when p_empresa_id not in (select private.empresas_accesibles()) then 'ninguno'
    else private.nivel_de_rol(
      (select private.organizacion_id()),
      (select private.rol_en_empresa(p_empresa_id)),
      'ventas'
    )
  end;
$$;

revoke execute on function private.nivel_ventas_en_empresa(uuid) from public, anon, authenticated;

comment on function private.nivel_ventas_en_empresa(uuid) is
  'Nivel de la sección ventas del usuario actual en una empresa (F-VTA-05, FR-001). Solo la llaman las RPC security definer de comprobantes.';

-- Forma de pago y de envío: solo se guarda la elección (FR-005). Los catálogos son de MSF-139. Si la tabla
-- del catálogo existe, la elección debe ser de la organización y de la empresa; si todavía no existe, no se
-- acepta ningún valor (nada de ids sueltos que luego no apunten a nada).
create or replace function private.validar_catalogo_comprobante(
  p_organizacion_id uuid,
  p_empresa_id uuid,
  p_forma_pago_id uuid,
  p_envio_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_valido boolean;
begin
  if p_forma_pago_id is not null then
    if to_regclass('dominio.formas_pago') is null then
      raise exception 'Las formas de pago todavía no están disponibles' using errcode = '22023', hint = 'forma_pago_id';
    end if;
    execute 'select exists (select 1 from dominio.formas_pago f where f.id = $1 and f.organizacion_id = $2 and f.empresa_id = $3)'
      into v_valido using p_forma_pago_id, p_organizacion_id, p_empresa_id;
    if not v_valido then
      raise exception 'La forma de pago no existe en esta tienda' using errcode = '22023', hint = 'forma_pago_id';
    end if;
  end if;
  if p_envio_id is not null then
    if to_regclass('dominio.formas_envio') is null then
      raise exception 'Las formas de envío todavía no están disponibles' using errcode = '22023', hint = 'envio_id';
    end if;
    execute 'select exists (select 1 from dominio.formas_envio f where f.id = $1 and f.organizacion_id = $2 and f.empresa_id = $3)'
      into v_valido using p_envio_id, p_organizacion_id, p_empresa_id;
    if not v_valido then
      raise exception 'La forma de envío no existe en esta tienda' using errcode = '22023', hint = 'envio_id';
    end if;
  end if;
end;
$$;

revoke execute on function private.validar_catalogo_comprobante(uuid, uuid, uuid, uuid) from public, anon, authenticated;

-- ============================================================================
-- crear_comprobante (FR-001, FR-004, FR-008)
-- ============================================================================
create or replace function public.crear_comprobante(
  p_tipo text,
  p_empresa_id uuid,
  p_cliente_id uuid,
  p_canal text,
  p_fecha date default current_date,
  p_valido_hasta date default null,
  p_forma_pago_id uuid default null,
  p_envio_id uuid default null
)
returns dominio.comprobantes_venta
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_empresa dominio.empresas;
  v_numero integer;
  v_fila dominio.comprobantes_venta;
  v_etiqueta text;
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para crear comprobantes' using errcode = '42501';
  end if;
  if p_tipo is null or p_tipo not in ('factura', 'presupuesto') then
    raise exception 'Elegí si es una factura o un presupuesto' using errcode = '22023', hint = 'tipo';
  end if;
  if p_empresa_id is null then
    raise exception 'Elegí la tienda' using errcode = '22023', hint = 'empresa_id';
  end if;
  select * into v_empresa from dominio.empresas e where e.id = p_empresa_id and e.organizacion_id = v_org;
  if not found then
    raise exception 'La tienda no existe' using errcode = '22023', hint = 'empresa_id';
  end if;
  if (select private.nivel_ventas_en_empresa(p_empresa_id)) <> 'edicion' then
    raise exception 'Tu rol no puede crear comprobantes en esta tienda' using errcode = '42501';
  end if;
  if not v_empresa.activa then
    raise exception 'La tienda está desactivada' using errcode = '22023', hint = 'empresa_id';
  end if;
  if p_cliente_id is null or not exists (
    select 1 from public.clientes c
    where c.id = p_cliente_id and c.organizacion_id = v_org and c.archivado_en is null
  ) then
    raise exception 'Elegí un cliente o Consumidor final' using errcode = '22023', hint = 'cliente_id';
  end if;
  if p_canal is null or p_canal not in ('mostrador', 'tienda_online', 'telefono_whatsapp') then
    raise exception 'Elegí el canal de venta' using errcode = '22023', hint = 'canal';
  end if;
  if p_fecha is null then
    raise exception 'Indicá la fecha' using errcode = '22023', hint = 'fecha';
  end if;
  if p_valido_hasta is not null and (p_tipo <> 'presupuesto' or p_valido_hasta < p_fecha) then
    raise exception 'La validez solo aplica a presupuestos y no puede ser anterior a la fecha'
      using errcode = '22023', hint = 'valido_hasta';
  end if;
  perform private.validar_catalogo_comprobante(v_org, p_empresa_id, p_forma_pago_id, p_envio_id);

  v_numero := private.siguiente_numero_comprobante(p_empresa_id, p_tipo);

  insert into dominio.comprobantes_venta (
    organizacion_id, empresa_id, cliente_id, tipo, numero, numero_entero, fecha, estado,
    total_sin_iva, total_con_iva, canal, operador_id, valido_hasta, forma_pago_id, envio_id
  )
  values (
    v_org, p_empresa_id, p_cliente_id, p_tipo, lpad(v_numero::text, 8, '0'), v_numero, p_fecha,
    case p_tipo when 'factura' then 'borrador' else 'pendiente' end,
    0, 0, p_canal, v_actor, p_valido_hasta, p_forma_pago_id, p_envio_id
  )
  returning * into v_fila;

  v_etiqueta := case v_fila.tipo when 'factura' then 'la factura' else 'el presupuesto' end;
  perform private.registrar_actividad(
    'comprobante.creado',
    format('Creó %s %s en %s', v_etiqueta, v_fila.numero, v_empresa.nombre),
    p_empresa_id
  );
  return v_fila;
end;
$$;

-- ============================================================================
-- guardar_comprobante (FR-002, FR-003, FR-008): edita la cabecera con bloqueo optimista.
-- La empresa y el tipo no se tocan: no son argumentos.
-- ============================================================================
create or replace function public.guardar_comprobante(
  p_id uuid,
  p_cliente_id uuid,
  p_canal text,
  p_fecha date,
  p_valido_hasta date,
  p_forma_pago_id uuid,
  p_envio_id uuid,
  p_actualizado_en timestamptz
)
returns dominio.comprobantes_venta
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actual dominio.comprobantes_venta;
  v_fila dominio.comprobantes_venta;
begin
  if v_org is null or (select auth.uid()) is null then
    raise exception 'Necesitás una sesión con organización para editar comprobantes' using errcode = '42501';
  end if;

  select * into v_actual
    from dominio.comprobantes_venta c
   where c.id = p_id and c.organizacion_id = v_org
   for update;
  if not found or v_actual.empresa_id is null then
    raise exception 'El comprobante no existe' using errcode = 'P0002';
  end if;
  if (select private.nivel_ventas_en_empresa(v_actual.empresa_id)) <> 'edicion' then
    raise exception 'Tu rol no puede editar comprobantes de esta tienda' using errcode = '42501';
  end if;

  -- Editable: factura en borrador o presupuesto pendiente. Todo lo demás está cerrado (FR-002).
  if not ((v_actual.tipo = 'factura' and v_actual.estado = 'borrador')
       or (v_actual.tipo = 'presupuesto' and v_actual.estado = 'pendiente')) then
    raise exception 'El comprobante ya está cerrado y no se puede modificar' using errcode = '55000';
  end if;
  if p_actualizado_en is distinct from v_actual.updated_at then
    raise exception 'Otra persona modificó este comprobante. Recargalo para ver los cambios' using errcode = '40001';
  end if;

  -- El cliente debe ser de la organización; solo se exige que no esté archivado si cambió.
  if p_cliente_id is null
     or not exists (select 1 from public.clientes c where c.id = p_cliente_id and c.organizacion_id = v_org)
     or (p_cliente_id is distinct from v_actual.cliente_id and exists (
       select 1 from public.clientes c where c.id = p_cliente_id and c.archivado_en is not null
     )) then
    raise exception 'Elegí un cliente o Consumidor final' using errcode = '22023', hint = 'cliente_id';
  end if;
  if p_canal is null or p_canal not in ('mostrador', 'tienda_online', 'telefono_whatsapp') then
    raise exception 'Elegí el canal de venta' using errcode = '22023', hint = 'canal';
  end if;
  if p_fecha is null then
    raise exception 'Indicá la fecha' using errcode = '22023', hint = 'fecha';
  end if;
  if p_valido_hasta is not null and (v_actual.tipo <> 'presupuesto' or p_valido_hasta < p_fecha) then
    raise exception 'La validez solo aplica a presupuestos y no puede ser anterior a la fecha'
      using errcode = '22023', hint = 'valido_hasta';
  end if;
  -- Solo se revalida el catálogo si la elección cambió (una elección vieja ya guardada no bloquea el resto).
  if p_forma_pago_id is distinct from v_actual.forma_pago_id or p_envio_id is distinct from v_actual.envio_id then
    perform private.validar_catalogo_comprobante(
      v_org, v_actual.empresa_id,
      case when p_forma_pago_id is distinct from v_actual.forma_pago_id then p_forma_pago_id end,
      case when p_envio_id is distinct from v_actual.envio_id then p_envio_id end
    );
  end if;

  update dominio.comprobantes_venta
     set cliente_id = p_cliente_id,
         canal = p_canal,
         fecha = p_fecha,
         valido_hasta = p_valido_hasta,
         forma_pago_id = p_forma_pago_id,
         envio_id = p_envio_id,
         updated_at = clock_timestamp()
   where id = p_id
  returning * into v_fila;

  perform private.registrar_actividad(
    'comprobante.editado',
    format('Editó %s %s', case v_fila.tipo when 'factura' then 'la factura' else 'el presupuesto' end, v_fila.numero),
    v_fila.empresa_id
  );
  return v_fila;
end;
$$;

-- ============================================================================
-- obtener_comprobante (lectura): cabecera + cliente + líneas + totales.
-- Las líneas llegan con F-VTA-06: hasta entonces la lista va vacía.
-- ============================================================================
create or replace function public.obtener_comprobante(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_c dominio.comprobantes_venta;
  v_nivel text;
  v_resultado jsonb;
begin
  if v_org is null or (select auth.uid()) is null then
    raise exception 'Necesitás una sesión con organización para ver comprobantes' using errcode = '42501';
  end if;
  select * into v_c from dominio.comprobantes_venta c where c.id = p_id and c.organizacion_id = v_org;
  if not found or v_c.empresa_id is null then
    raise exception 'El comprobante no existe' using errcode = 'P0002';
  end if;
  v_nivel := (select private.nivel_ventas_en_empresa(v_c.empresa_id));
  if v_nivel not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver comprobantes de esta tienda' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'id', v_c.id,
    'tipo', v_c.tipo,
    'numero', v_c.numero,
    'estado', v_c.estado,
    'empresa_id', v_c.empresa_id,
    'empresa', e.nombre,
    'cliente', jsonb_build_object(
      'id', cl.id,
      'nombre', cl.nombre,
      'documento', cl.documento,
      'direccion', nullif(btrim(concat_ws(', ', nullif(cl.direccion, ''), nullif(cl.localidad, ''), nullif(cl.provincia, ''))), ''),
      'tipo', cl.tipo,
      'es_consumidor_final', cl.es_consumidor_final
    ),
    'canal', v_c.canal,
    'fecha', v_c.fecha,
    'valido_hasta', v_c.valido_hasta,
    'operador_id', v_c.operador_id,
    'operador', coalesce(nullif(btrim(concat_ws(' ', p.nombre, p.apellido)), ''), 'Usuario sin nombre'),
    'forma_pago_id', v_c.forma_pago_id,
    'envio_id', v_c.envio_id,
    'lineas', '[]'::jsonb,
    'total_sin_iva', v_c.total_sin_iva,
    'iva', v_c.total_con_iva - v_c.total_sin_iva,
    'total_con_iva', v_c.total_con_iva,
    'editable', ((v_c.tipo = 'factura' and v_c.estado = 'borrador') or (v_c.tipo = 'presupuesto' and v_c.estado = 'pendiente')),
    'puede_editar', v_nivel = 'edicion',
    'updated_at', v_c.updated_at
  )
  into v_resultado
  from dominio.empresas e
  join public.clientes cl on cl.id = v_c.cliente_id and cl.organizacion_id = v_org
  left join public.perfiles_usuario p on p.user_id = v_c.operador_id
  where e.id = v_c.empresa_id;

  return v_resultado;
end;
$$;

revoke execute on function public.crear_comprobante(text, uuid, uuid, text, date, date, uuid, uuid) from public, anon;
revoke execute on function public.guardar_comprobante(uuid, uuid, text, date, date, uuid, uuid, timestamptz) from public, anon;
revoke execute on function public.obtener_comprobante(uuid) from public, anon;
grant execute on function public.crear_comprobante(text, uuid, uuid, text, date, date, uuid, uuid) to authenticated;
grant execute on function public.guardar_comprobante(uuid, uuid, text, date, date, uuid, uuid, timestamptz) to authenticated;
grant execute on function public.obtener_comprobante(uuid) to authenticated;

comment on function public.crear_comprobante(text, uuid, uuid, text, date, date, uuid, uuid) is
  'Alta de factura (borrador) o presupuesto (pendiente) numerada por empresa y tipo (F-VTA-05, FR-001). Exige ventas en edición en la empresa. Contrato en docs/ventas-comprobantes.md.';
comment on function public.guardar_comprobante(uuid, uuid, text, date, date, uuid, uuid, timestamptz) is
  'Edita la cabecera de un comprobante editable con bloqueo optimista por updated_at; no cambia empresa ni tipo (F-VTA-05, FR-002/FR-003).';
comment on function public.obtener_comprobante(uuid) is
  'Cabecera, cliente, líneas y totales de un comprobante; exige ventas en lectura o edición en su empresa (F-VTA-05).';
