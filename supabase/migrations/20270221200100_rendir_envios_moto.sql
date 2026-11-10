-- F-VTA-25 (épica MSF-145, spec 20261024-130000-ventas-motos, FR-020, FR-021, FR-022, FR-023, FR-024):
-- la rendición de los envíos en moto y la tarjeta «Motos sin rendir».
--
-- Esquema (Principio VII), verificado objeto por objeto:
--   public.rendir_envios_moto          public (nueva RPC)   rinde uno o varios envíos (fila o lote).
--   public.resumen_motos_sin_rendir    public (nueva RPC)   monto y cantidad de la tarjeta.
--   dominio.envios_moto                dominio (existente)  la tabla (20270221100100): esta RPC es la
--                                                  ÚNICA que escribe `rendido` y `rendido_en`.
--   dominio.comprobantes_venta         dominio (existente)  se lee (empresa y número del comprobante).
--   private.puede_rendir_envio_moto_en_empresa  private (existente, 20270221100200)  el permiso.
--   public.registro_actividad          public (existente)   evento por `private.registrar_actividad`.
-- Sin tablas nuevas: esta migración no crea ni altera columnas.
--
-- Reglas de `rendir_envios_moto(p_ids uuid[]) returns jsonb` (FR-020, FR-021, FR-022, FR-024):
-- · Solo el Administrador de la empresa del envío (o superadmin con organización activa): `42501`.
-- · TODO O NADA: es una sola transacción. Un id inexistente o de otra organización, un envío no
--   enviado, o una mezcla de mensajeros abortan todo con `22023`; un envío de una empresa donde no se
--   puede rendir aborta con `42501`.
-- · IDEMPOTENTE: los ids ya rendidos se ignoran (no cambian, no cuentan para la regla de un solo
--   mensajero y no duplican el evento). Si todos ya estaban rendidos devuelve cantidad 0 y totales 0 y
--   no deja evento.
-- · Solo se rinde lo ENVIADO y no rendido, de UN mismo mensajero (normalizado, sin distinguir
--   mayúsculas).
-- · Escribe únicamente `rendido = true` y `rendido_en = now()`. No toca `updated_at` ni ninguna otra
--   columna. La reversión queda fuera de alcance.
-- · El TOTAL de la rendición es la suma del `abono`; el costo va aparte y el neto (`abono − costo`) es
--   informativo (decisión de producto 2). Devuelve
--   `{ "cantidad": n, "mensajero": "…" | null, "total_abono": x, "total_costo": y, "neto": x−y }`.
-- · Un solo evento `envio_moto.rendido` por rendición efectiva, en la misma transacción, con el actor, el
--   mensajero, la cantidad, los totales y los comprobantes (el detalle del registro de actividad se
--   acota a 500 caracteres: si hay muchos comprobantes, la lista se corta con «…»).
--
-- `resumen_motos_sin_rendir(p_empresa_id)` (FR-023): suma del `abono` de los envíos sin rendir con
-- `abono > 0` y su cantidad, sobre las empresas accesibles y el filtro opcional de tienda. Cuenta todos
-- los no rendidos con abono (como el prototipo): un envío sin marcar Enviado suma aunque no pueda
-- rendirse todavía.
--
-- Como son `security definer` (la RLS no las acota), filtran a mano por organización, empresa accesible
-- y nivel de `ventas` en cada empresa. `search_path = ''`, `revoke … from public, anon`, `grant …
-- to authenticated`.
--
-- Migración aditiva. Reversión (en una migración posterior; no se ejecuta en este PR):
--   drop function if exists public.resumen_motos_sin_rendir(uuid);
--   drop function if exists public.rendir_envios_moto(uuid[]);

-- ============================================================================
-- public.rendir_envios_moto (FR-020, FR-021, FR-022, FR-024)
-- ============================================================================

create or replace function public.rendir_envios_moto(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_ids uuid[];
  v_encontrados integer;
  v_pendientes integer;
  v_no_enviados integer;
  v_mensajeros integer;
  v_mensajero text;
  v_total_abono numeric(14, 2);
  v_total_costo numeric(14, 2);
  v_empresas uuid[];
  v_empresa uuid;
  v_comprobantes text;
  v_detalle text;
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para rendir envíos en moto' using errcode = '42501';
  end if;

  -- ── Validaciones del pedido (FR-021) ──────────────────────────────────────
  if p_ids is null or cardinality(p_ids) = 0 then
    raise exception 'Elegí al menos un envío para rendir' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_ids) as x(id) where x.id is null) then
    raise exception 'Alguno de los envíos no es válido' using errcode = '22023';
  end if;
  if cardinality(p_ids) > 500 then
    raise exception 'No se pueden rendir más de 500 envíos a la vez' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct x.id), array[]::uuid[]) into v_ids from unnest(p_ids) as x(id);

  -- ── Los envíos, con bloqueo de fila (en orden fijo, sin interbloqueos): serializa dos rendiciones ──
  -- Un reintento concurrente espera acá y después ve los envíos ya rendidos: no hay doble evento.
  perform 1
    from dominio.envios_moto e
   where e.id = any (v_ids)
     and e.organizacion_id = v_org
   order by e.id
     for update;

  select count(*) into v_encontrados
    from dominio.envios_moto e
   where e.id = any (v_ids)
     and e.organizacion_id = v_org;
  if v_encontrados <> cardinality(v_ids) then
    raise exception 'Alguno de los envíos no existe: no se rindió ninguno' using errcode = '22023';
  end if;

  -- ── El permiso es el de la EMPRESA de cada envío (FR-020): solo el Administrador ──
  if exists (
    select 1
      from dominio.envios_moto e
      join dominio.comprobantes_venta c on c.id = e.comprobante_id and c.organizacion_id = e.organizacion_id
     where e.id = any (v_ids)
       and e.organizacion_id = v_org
       and not (select private.puede_rendir_envio_moto_en_empresa(c.empresa_id))
  ) then
    raise exception 'Tu rol no puede rendir envíos en moto en esta tienda' using errcode = '42501';
  end if;

  -- ── Lo pendiente: los ya rendidos se ignoran (idempotencia, FR-020) ───────
  select count(*),
         count(*) filter (where not e.enviado),
         count(distinct lower(e.mensajero)),
         min(e.mensajero),
         coalesce(sum(e.abono), 0),
         coalesce(sum(e.costo_envio), 0)
    into v_pendientes, v_no_enviados, v_mensajeros, v_mensajero, v_total_abono, v_total_costo
    from dominio.envios_moto e
   where e.id = any (v_ids)
     and e.organizacion_id = v_org
     and not e.rendido;

  if v_pendientes = 0 then
    return jsonb_build_object(
      'cantidad', 0, 'mensajero', null, 'total_abono', 0, 'total_costo', 0, 'neto', 0);
  end if;

  -- ── Solo se rinde lo enviado (FR-020) ─────────────────────────────────────
  if v_no_enviados > 0 then
    raise exception 'Solo se rinden los envíos ya enviados: hay % sin marcar como enviado, no se rindió ninguno', v_no_enviados
      using errcode = '22023';
  end if;

  -- ── Un solo mensajero por rendición, sin distinguir mayúsculas (FR-021) ───
  if v_mensajeros > 1 then
    raise exception 'La selección mezcla mensajeros: rendí un mensajero por vez, no se rindió ninguno'
      using errcode = '22023';
  end if;

  -- ── La rendición: escribe SOLO `rendido` y `rendido_en` (FR-020) ──────────
  -- Lo que se rinde ahora (no lo que ya estaba rendido, aunque sea de esta misma transacción) alimenta
  -- el evento.
  with rendidos as (
    update dominio.envios_moto e
       set rendido = true,
           rendido_en = now()
     where e.id = any (v_ids)
       and e.organizacion_id = v_org
       and not e.rendido
    returning e.comprobante_id, e.organizacion_id
  )
  select array_agg(distinct c.empresa_id),
         string_agg(c.numero, ', ' order by c.numero)
    into v_empresas, v_comprobantes
    from rendidos r
    join dominio.comprobantes_venta c on c.id = r.comprobante_id and c.organizacion_id = r.organizacion_id;

  -- ── El evento (FR-024): uno por rendición, en la misma transacción ────────
  -- La empresa del evento es la de los envíos si todos son de una sola; si no, queda sin empresa.
  v_empresa := case when cardinality(v_empresas) = 1 then v_empresas[1] else null end;

  v_detalle := format('Rindió %s envío(s) en moto del mensajero %s: total a rendir %s, costo %s, neto %s. Facturas: ',
    v_pendientes, v_mensajero, v_total_abono, v_total_costo, v_total_abono - v_total_costo);
  if length(v_detalle) + length(v_comprobantes) > 500 then
    v_detalle := v_detalle || left(v_comprobantes, greatest(500 - length(v_detalle) - 1, 0)) || '…';
  else
    v_detalle := v_detalle || v_comprobantes;
  end if;

  perform private.registrar_actividad('envio_moto.rendido', v_detalle, v_empresa);

  return jsonb_build_object(
    'cantidad', v_pendientes,
    'mensajero', v_mensajero,
    'total_abono', v_total_abono,
    'total_costo', v_total_costo,
    'neto', v_total_abono - v_total_costo);
end;
$$;

revoke execute on function public.rendir_envios_moto(uuid[]) from public, anon;
grant execute on function public.rendir_envios_moto(uuid[]) to authenticated;

comment on function public.rendir_envios_moto(uuid[]) is
  'Rinde envíos en moto, de a uno o en lote (F-VTA-25, FR-020, FR-021, FR-022, FR-024): todo o nada, idempotente (los ya rendidos se ignoran), solo enviados y no rendidos de un mismo mensajero. Exige el rol administrador en la empresa de cada envío. Escribe solo rendido y rendido_en. Devuelve {cantidad, mensajero, total_abono, total_costo, neto}; el total a rendir es la suma del abono. Deja un evento envio_moto.rendido. No revierte.';

-- ============================================================================
-- public.resumen_motos_sin_rendir (FR-023): la tarjeta «Motos sin rendir»
-- ============================================================================

create or replace function public.resumen_motos_sin_rendir(
  p_empresa_id uuid default null
)
returns table (
  monto numeric,
  entregas integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
begin
  if v_org is null or (select private.nivel_seccion('ventas')) not in ('lectura', 'edicion') then
    raise exception 'Necesitás acceso a Ventas para ver los envíos en moto' using errcode = '42501';
  end if;

  return query
  select coalesce(sum(e.abono), 0)::numeric,
         count(*)::integer
    from dominio.envios_moto e
    join dominio.comprobantes_venta c on c.id = e.comprobante_id and c.organizacion_id = e.organizacion_id
   where e.organizacion_id = v_org
     and not e.rendido
     and e.abono > 0
     and c.empresa_id in (select private.empresas_accesibles())
     and (select private.nivel_ventas_en_empresa(c.empresa_id)) in ('lectura', 'edicion')
     and (p_empresa_id is null or c.empresa_id = p_empresa_id);
end;
$$;

revoke execute on function public.resumen_motos_sin_rendir(uuid) from public, anon;
grant execute on function public.resumen_motos_sin_rendir(uuid) to authenticated;

comment on function public.resumen_motos_sin_rendir(uuid) is
  'Tarjeta «Motos sin rendir» (F-VTA-25, FR-023): suma del abono y cantidad de los envíos en moto sin rendir con abono mayor a 0, sobre las empresas accesibles y el filtro opcional de tienda.';
