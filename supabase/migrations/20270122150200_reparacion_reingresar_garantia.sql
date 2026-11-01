-- F-SVC-21 (MSF-146, épica MSF-124): `public.reingresar_por_garantia`.
-- Esquema: sin tablas nuevas (escribe en `dominio.reparaciones` y `dominio.reparacion_historial`; Principio VII).
--
-- SECURITY DEFINER con control explícito: organización de la sesión, `edicion` en `service_tecnico`, origen de
-- una tienda accesible (si no, `P0002`) y bloqueado con `for update`. El origen debe estar entregada
-- (`entrega_real`) y no anulada (`55000`). Falla obligatoria (`22023`, `hint = falla`), técnico elegible y
-- entrega prevista no anterior a hoy si vienen. Copia tienda, cliente, contacto, modelo, N.º de serie y
-- accesorios; NO copia ítems, costos ni adjuntos. Número siguiente bajo el bloqueo de numeración vigente
-- (`private.siguiente_numero_reparacion`), primer estado activo por `orden`, ingreso de hoy (Argentina).
-- Escribe el evento `alta` con la nota «Reingreso por garantía de R-xxxx» y la actividad
-- `reparacion.reingreso_garantia` en la misma transacción. No reemplaza `crear_reparacion`.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.reingresar_por_garantia(uuid, text, uuid, date);

create or replace function public.reingresar_por_garantia(
  p_reparacion_origen uuid,
  p_falla text,
  p_tecnico uuid default null,
  p_entrega_prevista date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_origen dominio.reparaciones;
  v_falla text := btrim(coalesce(p_falla, ''));
  v_estado uuid;
  v_numero integer;
  v_id uuid;
  v_codigo_origen text;
begin
  if v_org is null or (select auth.uid()) is null
     or (select private.nivel_seccion('service_tecnico')) is distinct from 'edicion' then
    raise exception 'Tu rol no puede reingresar reparaciones por garantía' using errcode = '42501';
  end if;

  select * into v_origen
    from dominio.reparaciones r
   where r.id = p_reparacion_origen and r.organizacion_id = v_org
   for update;
  if not found
     or not exists (select 1 from private.empresas_accesibles() a(id) where a.id = v_origen.empresa_id) then
    raise exception 'La reparación no existe' using errcode = 'P0002';
  end if;
  if v_origen.anulada_en is not null then
    raise exception 'La reparación está anulada: no se puede reingresar por garantía' using errcode = '55000';
  end if;
  if v_origen.entrega_real is null then
    raise exception 'Solo se puede reingresar por garantía una reparación entregada' using errcode = '55000';
  end if;

  if v_falla = '' then
    raise exception 'Describí la falla del reingreso' using errcode = '22023', hint = 'falla';
  end if;
  if length(v_falla) > 1000 then
    raise exception 'Máximo 1000 caracteres' using errcode = '22023', hint = 'falla';
  end if;
  if p_tecnico is not null and not private.es_tecnico_de_service(p_tecnico) then
    raise exception 'El técnico no es válido' using errcode = '22023', hint = 'tecnico';
  end if;
  if p_entrega_prevista is not null and p_entrega_prevista < v_hoy then
    raise exception 'La entrega prevista no puede ser anterior al ingreso' using errcode = '22023', hint = 'entrega_prevista';
  end if;

  select s.id into v_estado
    from dominio.estados_reparacion s
   where s.organizacion_id = v_org and s.activo
   order by s.orden, s.id
   limit 1;
  if v_estado is null then
    raise exception 'No hay estados de reparación activos: activá uno en Estados de reparación' using errcode = '22023';
  end if;

  v_numero := private.siguiente_numero_reparacion(v_origen.empresa_id);
  v_codigo_origen := private.codigo_reparacion(v_origen.numero);

  insert into dominio.reparaciones (
    organizacion_id, empresa_id, numero, cliente_id, contacto, modelo_id, estado_id, numero_serie,
    accesorios, falla, tecnico_id, ingreso_en, entrega_prevista, reparacion_origen_id
  ) values (
    v_org, v_origen.empresa_id, v_numero, v_origen.cliente_id, v_origen.contacto, v_origen.modelo_id,
    v_estado, v_origen.numero_serie, v_origen.accesorios, v_falla, p_tecnico, v_hoy, p_entrega_prevista,
    v_origen.id
  )
  returning id into v_id;

  insert into dominio.reparacion_historial (organizacion_id, reparacion_id, tipo, estado_nuevo_id, nota, usuario_id)
  values (v_org, v_id, 'alta', v_estado, 'Reingreso por garantía de ' || v_codigo_origen, (select auth.uid()));

  perform private.registrar_actividad(
    'reparacion.reingreso_garantia',
    format('Reingresó por garantía la reparación %s como %s', v_codigo_origen, private.codigo_reparacion(v_numero)),
    v_origen.empresa_id
  );

  return private.reparacion_json(v_id);
end;
$$;

comment on function public.reingresar_por_garantia(uuid, text, uuid, date) is
  'F-SVC-21: reingreso por garantía de una reparación entregada y no anulada; copia equipo y cliente, falla nueva, número siguiente de la tienda. Solo con edición en Service técnico.';

revoke execute on function public.reingresar_por_garantia(uuid, text, uuid, date) from public, anon;
grant execute on function public.reingresar_por_garantia(uuid, text, uuid, date) to authenticated;
