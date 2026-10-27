-- F-VTA-16 (MSF-166, épica MSF-135, spec 20261024-130000-ventas-despacho-y-faltantes, FR-021):
-- `public.guardar_envio_comprobante`: transporte, guía y fecha de envío de una factura confirmada no entregada.
--
-- Esquema (Principio VII): sin tablas nuevas. Escribe `dominio.comprobantes_venta` (`transporte_id`, `guia`,
-- `fecha_envio`, `updated_at`) y, por `private.registrar_actividad`, `public.registro_actividad` (plataforma).
-- Lee `dominio.transportes` y `dominio.transportes_empresas` (catálogo de MSF-139). Nada se escribe directo desde
-- el navegador: la tabla no tiene política ni grant de escritura, solo esta RPC `security definer`.
--
-- Reglas (FR-021):
--   · Solo una **factura confirmada y no entregada**: un presupuesto, un borrador o una factura ya entregada no
--     registran envío (22023 / 55000).
--   · El transporte tiene que estar **activo** y **asignado a la empresa del comprobante** (`dominio
--     .transportes_empresas`): un transporte de otra organización, desactivado o de otra tienda se rechaza (22023).
--   · Permiso: la acción **`despachar`** o Ventas en **`edicion`**, siempre resuelto en la **empresa del
--     comprobante** (no en la empresa activa de la barra superior: Principio VIII). `despachar` habilita a Depósito
--     (Ventas en lectura) y `edicion` a quien edita Ventas en esa tienda (42501).
--   · **Bloqueo optimista** por `p_actualizado_en` (40001) y fila `for update`: dos cambios simultáneos no se pisan.
--   · Es **idempotente**: guardar lo mismo que ya está guardado devuelve el comprobante sin tocar `updated_at` ni
--     registrar actividad de nuevo (no rompe el bloqueo de quien lo está mirando).
--   · Cada guardado registra la actividad `despacho.envio_guardado`.
--
-- La **exigencia** de transporte y guía cuando la forma de envío la pide NO se comprueba acá: es la regla de
-- entrega (FR-022, `cambiar_estado_despacho` al pasar a `entregado`). Guardar el envío es guardar el dato; el
-- «no se puede entregar sin guía» se resuelve al entregar (T015).
--
-- Errores: 42501 sin sesión/organización o sin permiso · 22023 dato inválido (transporte, guía) · P0002 no existe ·
-- 55000 la factura no está confirmada o ya fue entregada · 40001 conflicto de `p_actualizado_en`.
--
-- Migración aditiva. Reversión (en una migración posterior; los envíos ya cargados NO se deshacen solos:
-- exportarlos antes):
--   drop function public.guardar_envio_comprobante(uuid, uuid, text, date, timestamptz);

create or replace function public.guardar_envio_comprobante(
  p_id uuid,
  p_transporte_id uuid,
  p_guia text,
  p_fecha_envio date,
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
  v_transporte dominio.transportes;
  v_guia text;
  v_fecha date;
  v_detalle text;
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para registrar el envío' using errcode = '42501';
  end if;

  -- La fila se toma `for update`: dos guardados simultáneos se serializan.
  select * into v_c
    from dominio.comprobantes_venta c
   where c.id = p_id and c.organizacion_id = v_org
   for update;
  if not found or v_c.empresa_id is null then
    raise exception 'El comprobante no existe' using errcode = 'P0002';
  end if;

  -- Solo las facturas: un presupuesto no se despacha.
  if v_c.tipo <> 'factura' then
    raise exception 'Un presupuesto no registra envío: solo las facturas se despachan' using errcode = '22023';
  end if;
  if v_c.estado <> 'confirmada' then
    raise exception 'Solo las facturas confirmadas registran el envío' using errcode = '55000';
  end if;
  if v_c.estado_despacho is null then
    raise exception 'Esta factura todavía no tiene estado de despacho' using errcode = '55000';
  end if;
  if v_c.estado_despacho = 'entregado' then
    raise exception 'Esta factura ya fue entregada: no se puede cambiar el envío' using errcode = '55000';
  end if;

  -- Permiso: la acción `despachar` o Ventas en `edicion`, en la empresa DEL COMPROBANTE (no en la activa).
  if not (select private.puede_despachar_en_empresa(v_c.empresa_id))
     and (select private.nivel_ventas_en_empresa(v_c.empresa_id)) <> 'edicion' then
    raise exception 'Tu rol no puede registrar el envío de comprobantes de esta tienda' using errcode = '42501';
  end if;

  -- Guía: texto de hasta 100 caracteres; en blanco = sin guía.
  v_guia := nullif(btrim(coalesce(p_guia, '')), '');
  if v_guia is not null and length(v_guia) > 100 then
    raise exception 'La guía no puede tener más de 100 caracteres' using errcode = '22023', hint = 'guia';
  end if;

  -- Fecha de envío: si no viene, la de hoy (la mercadería sale hoy).
  v_fecha := p_fecha_envio;
  if v_fecha is null and p_transporte_id is not null then
    v_fecha := current_date;
  end if;

  -- Idempotente: lo mismo que ya está guardado no se vuelve a escribir (ni `updated_at`, ni actividad).
  if v_c.transporte_id is not distinct from p_transporte_id
     and v_c.guia is not distinct from v_guia
     and v_c.fecha_envio is not distinct from v_fecha then
    return v_c;
  end if;

  -- Bloqueo optimista (FR-021).
  if p_actualizado_en is distinct from v_c.updated_at then
    raise exception 'Alguien modificó este comprobante mientras lo mirabas: recargalo y volvé a intentar' using errcode = '40001';
  end if;

  -- Transporte: de la organización, activo y usado en la empresa del comprobante (FR-021).
  if p_transporte_id is not null then
    select * into v_transporte
      from dominio.transportes t
     where t.id = p_transporte_id and t.organizacion_id = v_org;
    if not found then
      raise exception 'El transporte no existe' using errcode = '22023', hint = 'transporte_id';
    end if;
    if not v_transporte.activa then
      raise exception 'El transporte «%» está desactivado: elegí otro', v_transporte.nombre
        using errcode = '22023', hint = 'transporte_id';
    end if;
    if not exists (
      select 1
        from dominio.transportes_empresas te
       where te.transporte_id = v_transporte.id
         and te.empresa_id = v_c.empresa_id
         and te.organizacion_id = v_org
    ) then
      raise exception 'El transporte «%» no se usa en esta tienda: elegí otro', v_transporte.nombre
        using errcode = '22023', hint = 'transporte_id';
    end if;
  end if;

  update dominio.comprobantes_venta
     set transporte_id = p_transporte_id,
         guia = v_guia,
         fecha_envio = v_fecha,
         updated_at = clock_timestamp()
   where id = v_c.id
  returning * into v_fila;

  v_detalle := case
    when v_fila.transporte_id is null and v_fila.guia is null then 'sin transporte ni guía'
    else trim(
      case
        when v_fila.transporte_id is not null then 'transporte ' || coalesce(v_transporte.nombre, '—')
        else 'sin transporte'
      end ||
      case when v_fila.guia is not null then ', guía ' || v_fila.guia else '' end ||
      case when v_fila.fecha_envio is not null then ', fecha ' || to_char(v_fila.fecha_envio, 'DD/MM/YYYY') else '' end
    )
  end;
  perform private.registrar_actividad(
    'despacho.envio_guardado',
    format('Envío: %s en la factura %s', v_detalle, v_fila.numero),
    v_fila.empresa_id
  );

  return v_fila;
end;
$$;

comment on function public.guardar_envio_comprobante(uuid, uuid, text, date, timestamptz) is
  'Guarda el transporte, la guía y la fecha de envío de una factura confirmada no entregada (F-VTA-16, FR-021). Exige la acción `despachar` o Ventas en `edicion` en la empresa del comprobante; el transporte tiene que estar activo y usarse en esa tienda; usa bloqueo optimista por `p_actualizado_en`.';

revoke execute on function public.guardar_envio_comprobante(uuid, uuid, text, date, timestamptz) from public, anon;
grant execute on function public.guardar_envio_comprobante(uuid, uuid, text, date, timestamptz) to authenticated;
