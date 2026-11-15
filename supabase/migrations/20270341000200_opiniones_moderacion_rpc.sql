-- MSF-467 · Opiniones de productos, Fase 2 «Moderación» (T007). RF-OPI-13, RF-OPI-14, RF-OPI-16, D4, D5, D10, D11, D13.
--
-- Esquemas (Principio VII): dos RPC de panel -> `public` (superficie del panel, igual que las demás RPC de gestión); tipos de
-- evento de Actividad -> filas de `public.tipos_evento_actividad` (catálogo de plataforma, sin cambio de esquema).
--
-- Solo el Administrador de la organización (`private.es_administrador_de`) lista y modera (D10); cualquier otro -> 42501.
-- Con la bandera `tienda_opiniones` apagada solo se permite RECHAZAR (lo que reduce exposición); aceptar -> 55000 (D11).
-- Eventos de Actividad `opinion.aceptada` / `opinion.rechazada`: NO son sensibles (no llevan valor anterior/nuevo: registran
-- una decisión de moderación sobre contenido ajeno, no un cambio de configuración, permiso ni dato personal del actor), y su
-- detalle lleva producto y puntuación, NUNCA el comentario ni el motivo (D13).
--
-- Migración aditiva. Reversión (migración posterior; no se ejecuta en el mismo PR):
--   drop function if exists public.listar_opiniones(text, uuid, timestamptz, uuid, integer);
--   drop function if exists public.moderar_opinion(uuid, text, text, timestamptz);
--   delete from public.tipos_evento_actividad where tipo in ('opinion.aceptada', 'opinion.rechazada');

insert into public.tipos_evento_actividad (tipo, sensible, descripcion) values
  ('opinion.aceptada', false, 'Opinión de un producto aceptada por un administrador (se publica en la tienda)'),
  ('opinion.rechazada', false, 'Opinión de un producto rechazada o despublicada por un administrador')
on conflict (tipo) do nothing;

-- ============================================================================
-- public.listar_opiniones
-- ============================================================================
create or replace function public.listar_opiniones(
  p_estado text default 'pendiente',
  p_empresa_id uuid default null,
  p_desde_creada timestamptz default null,
  p_desde_id uuid default null,
  p_limite integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_limite integer := least(greatest(coalesce(p_limite, 20), 1), 50);
  v_estado text := coalesce(p_estado, 'pendiente');
  v_contadores jsonb;
  v_filas jsonb;
  v_siguiente jsonb := null;
  v_hay_mas boolean;
begin
  if v_org is null or not (select private.es_administrador_de(v_org)) then
    raise exception 'Solo un administrador puede ver las opiniones' using errcode = '42501';
  end if;
  if v_estado not in ('pendiente', 'aceptada', 'rechazada', 'todas') then
    raise exception 'Estado de opinión inválido' using errcode = '22023';
  end if;
  if p_empresa_id is not null and not exists (
    select 1 from dominio.empresas e where e.id = p_empresa_id and e.organizacion_id = v_org
  ) then
    raise exception 'La tienda no pertenece a tu organización' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'pendientes', count(*) filter (where o.estado = 'pendiente'),
    'aceptadas', count(*) filter (where o.estado = 'aceptada'),
    'rechazadas', count(*) filter (where o.estado = 'rechazada')
  )
  into v_contadores
  from dominio.opiniones_producto o
  where o.organizacion_id = v_org
    and (p_empresa_id is null or o.empresa_id = p_empresa_id);

  with pagina as (
    select o.*, row_number() over (order by o.creada_en desc, o.id desc) as rn
    from dominio.opiniones_producto o
    where o.organizacion_id = v_org
      and (p_empresa_id is null or o.empresa_id = p_empresa_id)
      and (v_estado = 'todas' or o.estado = v_estado)
      and (
        p_desde_creada is null or p_desde_id is null
        or (o.creada_en, o.id) < (p_desde_creada, p_desde_id)
      )
    order by o.creada_en desc, o.id desc
    limit v_limite + 1
  )
  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'id', g.id,
        'empresa_id', g.empresa_id,
        'empresa_nombre', e.nombre,
        'cliente_id', cc.cliente_id,
        'cliente_nombre', cl.nombre,
        'producto_id', g.producto_id,
        'producto_nombre', pr.nombre,
        'puntuacion', g.puntuacion,
        'comentario', g.comentario,
        'estado', g.estado,
        'motivo_rechazo', g.motivo_rechazo,
        'creada_en', g.creada_en,
        'actualizada_en', g.actualizada_en
      ) order by g.creada_en desc, g.id desc
    ) filter (where g.rn <= v_limite), '[]'::jsonb),
    coalesce(bool_or(g.rn > v_limite), false)
  into v_filas, v_hay_mas
  from pagina g
  join dominio.empresas e on e.id = g.empresa_id and e.organizacion_id = g.organizacion_id
  join public.cuentas_cliente cc on cc.id = g.cuenta_cliente_id
  join public.clientes cl on cl.id = cc.cliente_id
  join dominio.productos pr on pr.id = g.producto_id and pr.organizacion_id = g.organizacion_id;

  if v_hay_mas then
    select jsonb_build_object('creada', f->>'creada_en', 'id', f->>'id')
    into v_siguiente
    from jsonb_array_elements(v_filas) with ordinality as t (f, n)
    order by n desc
    limit 1;
  end if;

  return jsonb_build_object('contadores', v_contadores, 'filas', v_filas, 'siguiente', v_siguiente);
end;
$$;

comment on function public.listar_opiniones(text, uuid, timestamptz, uuid, integer) is
  'MSF-467 (RF-OPI-13): opiniones de la organización por tandas (cursor creada_en, id) con contadores Pendientes/Aceptadas/Rechazadas del ámbito de la tienda. Solo Administrador (42501). Muestra el nombre completo del cliente (D9).';

revoke execute on function public.listar_opiniones(text, uuid, timestamptz, uuid, integer) from public, anon;
grant execute on function public.listar_opiniones(text, uuid, timestamptz, uuid, integer) to authenticated;

-- ============================================================================
-- public.moderar_opinion
-- ============================================================================
create or replace function public.moderar_opinion(
  p_id uuid,
  p_decision text,
  p_motivo text default null,
  p_actualizada_en_esperada timestamptz default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_op dominio.opiniones_producto;
  v_estado_nuevo text;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_producto text;
begin
  if v_org is null or not (select private.es_administrador_de(v_org)) then
    raise exception 'Solo un administrador puede moderar opiniones' using errcode = '42501';
  end if;
  if p_decision not in ('aceptar', 'rechazar') then
    raise exception 'Decisión de moderación inválida' using errcode = '22023';
  end if;
  if p_decision = 'aceptar' and v_motivo is not null then
    raise exception 'El motivo solo se indica al rechazar' using errcode = '22023';
  end if;
  if v_motivo is not null and (char_length(v_motivo) > 200 or v_motivo ~ '[[:cntrl:]]') then
    raise exception 'El motivo admite hasta 200 caracteres sin caracteres de control' using errcode = '22023';
  end if;
  if p_actualizada_en_esperada is null then
    raise exception 'Falta la fecha de la opinión que viste' using errcode = '22023';
  end if;
  v_estado_nuevo := case p_decision when 'aceptar' then 'aceptada' else 'rechazada' end;

  select * into v_op
  from dominio.opiniones_producto o
  where o.id = p_id and o.organizacion_id = v_org
  for update;
  if not found then
    return jsonb_build_object('estado', 'no_encontrada');
  end if;

  -- Con la bandera apagada solo se reduce exposición (D11).
  if p_decision = 'aceptar' and not (select private.bandera_activa('tienda_opiniones')) then
    raise exception 'Las opiniones están desactivadas: no se pueden aceptar' using errcode = '55000';
  end if;

  -- Idempotente: repetir la decisión ya vigente responde ok sin duplicar el evento.
  if v_op.estado = v_estado_nuevo then
    return jsonb_build_object('estado', 'ok', 'opinion', jsonb_build_object('id', v_op.id, 'estado', v_op.estado));
  end if;

  -- Bloqueo optimista: si la fila cambió desde la pantalla del administrador (p. ej. el cliente la editó), no se pisa.
  if v_op.actualizada_en <> p_actualizada_en_esperada then
    raise exception 'conflicto' using errcode = '40001';
  end if;

  update dominio.opiniones_producto
  set estado = v_estado_nuevo,
      motivo_rechazo = case when v_estado_nuevo = 'rechazada' then v_motivo else null end,
      moderada_por = (select auth.uid()),
      moderada_en = now(),
      actualizada_en = now()
  where id = v_op.id
  returning * into v_op;

  select left(p.nombre, 150) into v_producto from dominio.productos p
  where p.id = v_op.producto_id and p.organizacion_id = v_op.organizacion_id;

  perform private.registrar_actividad(
    case v_estado_nuevo when 'aceptada' then 'opinion.aceptada' else 'opinion.rechazada' end,
    format('Opinión de %s %s sobre «%s» %s', v_op.puntuacion, case when v_op.puntuacion = 1 then 'estrella' else 'estrellas' end,
      coalesce(v_producto, 'producto'), case v_estado_nuevo when 'aceptada' then 'aceptada' else 'rechazada' end),
    v_op.empresa_id
  );

  return jsonb_build_object('estado', 'ok', 'opinion', jsonb_build_object('id', v_op.id, 'estado', v_op.estado));
end;
$$;

comment on function public.moderar_opinion(uuid, text, text, timestamptz) is
  'MSF-467 (RF-OPI-14): acepta o rechaza una opinión (motivo opcional de hasta 200 al rechazar). Solo Administrador (42501); idempotente; bloqueo optimista (40001 conflicto); apagada la bandera solo rechaza (55000). Registra el evento en Actividad sin el texto.';

revoke execute on function public.moderar_opinion(uuid, text, text, timestamptz) from public, anon;
grant execute on function public.moderar_opinion(uuid, text, text, timestamptz) to authenticated;
