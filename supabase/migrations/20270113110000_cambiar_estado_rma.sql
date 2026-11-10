-- F-VTA-29 (MSF-304, épica MSF-178, FR-011): `public.cambiar_estado_rma`, el avance de estado de una devolución.
--
-- Esquema (Principio VII): sin tablas nuevas. Actualiza `dominio.rma` (dominio, 20270113100000) y, por
-- `private.registrar_actividad`, `public.registro_actividad` (plataforma).
--
-- Reglas:
--   · Transición lineal `abierto → en_gestion → cerrado`, sin saltos ni retrocesos (22023).
--   · Idempotente: pedir el estado que ya tiene devuelve el RMA actual, sin evento ni cambio (aunque `p_actualizado_en`
--     esté vencido: un reintento tras una respuesta perdida no es un conflicto).
--   · Bloqueo optimista: la fila se toma `for update` y `p_actualizado_en` debe ser el `actualizado_en` leído (40001 si
--     otra persona la cambió). `actualizado_en` se renueva con `clock_timestamp()` en cada cambio.
--   · Todo en una transacción: cambio de estado + evento `rma.estado_cambiado` (desde, hasta, actor y tienda).
--
-- Seguridad: `security definer`, `search_path = ''`; organización y actor salen de la sesión. Exige `ventas` en
-- `edicion` EN LA EMPRESA del RMA (`private.nivel_ventas_en_empresa`). `revoke … from public, anon` y
-- `grant execute … to authenticated` explícitos.
--
-- Errores: 42501 permiso o sin sesión · P0002 no existe · 22023 estado desconocido o transición inválida ·
-- 40001 modificado por otra persona.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.cambiar_estado_rma(uuid, text, timestamptz);

create or replace function public.cambiar_estado_rma(
  p_id uuid,
  p_estado text,
  p_actualizado_en timestamptz
)
returns dominio.rma
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_rma dominio.rma;
  v_desde text;
  v_etiquetas constant jsonb := '{"abierto": "Abierta", "en_gestion": "En gestión", "cerrado": "Cerrada"}';
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para cambiar el estado de una devolución' using errcode = '42501';
  end if;
  if p_estado is null or p_estado not in ('abierto', 'en_gestion', 'cerrado') then
    raise exception 'El estado % no existe', coalesce(p_estado, '(vacío)') using errcode = '22023', hint = 'estado';
  end if;

  select * into v_rma
    from dominio.rma r
   where r.id = p_id and r.organizacion_id = v_org
   for update;
  if not found then
    raise exception 'La devolución no existe' using errcode = 'P0002';
  end if;
  if (select private.nivel_ventas_en_empresa(v_rma.empresa_id)) <> 'edicion' then
    raise exception 'Tu rol no puede cambiar el estado de devoluciones en esta tienda' using errcode = '42501';
  end if;

  if v_rma.estado = p_estado then
    return v_rma;
  end if;
  if p_actualizado_en is null or v_rma.actualizado_en <> p_actualizado_en then
    raise exception 'La devolución fue modificada por otra persona' using errcode = '40001';
  end if;
  if not ((v_rma.estado = 'abierto' and p_estado = 'en_gestion') or (v_rma.estado = 'en_gestion' and p_estado = 'cerrado')) then
    raise exception 'No se puede pasar una devolución de % a %', v_etiquetas ->> v_rma.estado, v_etiquetas ->> p_estado
      using errcode = '22023', hint = 'estado';
  end if;

  v_desde := v_rma.estado;
  update dominio.rma
     set estado = p_estado, actualizado_en = clock_timestamp()
   where id = v_rma.id
  returning * into v_rma;

  perform private.registrar_actividad(
    'rma.estado_cambiado',
    format('Pasó la devolución %s de %s a %s', v_rma.numero, v_etiquetas ->> v_desde, v_etiquetas ->> p_estado),
    v_rma.empresa_id
  );
  return v_rma;
end;
$$;

revoke execute on function public.cambiar_estado_rma(uuid, text, timestamptz) from public, anon;
grant execute on function public.cambiar_estado_rma(uuid, text, timestamptz) to authenticated;

comment on function public.cambiar_estado_rma(uuid, text, timestamptz) is
  'Avanza el estado de una devolución (abierto → en_gestion → cerrado) con bloqueo optimista, idempotente y con evento (F-VTA-29, FR-011). Exige ventas en edición en la tienda del RMA.';
