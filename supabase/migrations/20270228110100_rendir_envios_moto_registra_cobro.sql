-- MSF-145 (Ventas motos), decisiones de Nicolás del 2026-11-12 (4 y 6): rendir un envío en moto registra el cobro en el libro
-- de cobros de la factura, y un envío de una factura anulada no se puede rendir.
--
-- Esquema (Principio VII), verificado objeto por objeto:
--   dominio.envios_moto                dominio (existente)  nueva columna `cobro_id` (nula): el cobro del libro que dejó la
--                                                  rendición. Misma forma que `dominio.contrarreembolsos.cobro_id`: FK compuesta
--                                                  (cobro_id, organizacion_id) a `dominio.cobros_comprobante`. NO es una tabla
--                                                  nueva: la exportación total (`private.conjuntos_exportacion_total`) ya incluye
--                                                  `envios_moto` (20270222300200) y la columna viaja con la fila.
--   dominio.cobros_comprobante         dominio (existente)  el libro de cobros: se escribe SOLO por `private.registrar_cobro_interno`.
--   dominio.comprobantes_venta         dominio (existente)  se lee (estado, forma de pago, empresa) y se bloquea (`for update`).
--   dominio.formas_pago                dominio (existente)  la forma del cobro (la de la factura o la «Contrarreembolso» de la tienda).
--   public.rendir_envios_moto          public (RPC existente, se reemplaza)  rinde y cobra.
--   private.registrar_cobro_interno / private.saldo_comprobante   private (existentes)  no se tocan: ver docs/cobros-por-comprobante.md.
--
-- Qué cambia en `rendir_envios_moto(p_ids uuid[]) returns jsonb` (todo lo demás sigue igual que en 20270222300100):
-- · Decisión 4: un envío PENDIENTE de una factura anulada aborta la rendición entera con `55000` y un mensaje en castellano que
--   nombra la factura. Los ya rendidos se siguen ignorando (idempotencia).
-- · Decisión 6: por cada envío que se rinde, en la misma transacción, se registra en el libro de cobros de su factura un cobro
--   por `least(abono, saldo neto de la factura)`. NO se duplica la lógica de cobros: es `private.registrar_cobro_interno`, el único
--   camino al libro, el que valida el tope, pasa la factura a Cobrado o Deuda y deja el evento `comprobante.cobro_registrado`.
--   · Tope: el saldo neto de `private.saldo_comprobante` (total − cobros − notas de crédito). Si el abono lo supera (p. ej. se
--     cargó de más) se cobra el saldo, nunca más. Si el saldo es 0 o el abono es 0 no se registra cobro (el envío igual se rinde).
--   · Origen del cobro: `contrarreembolso`. Es el cobro que un transportista (acá, la mensajería propia) hace al entregar y rinde;
--     el `check` de `cobros_comprobante.origen` solo admite `manual` y `contrarreembolso`, y no se altera.
--   · Forma de pago: la de la factura si la tiene; si no, la forma activa de tipo `contrarreembolso` de la tienda (igual que
--     `marcar_contrarreembolso_cobrado`). Sin ninguna de las dos se aborta con `22023`.
--   · Cuenta de cobro: ninguna (es efectivo en mano).
--   · La factura en borrador con abono > 0 no admite el cobro: se aborta con `55000` («confirmala antes de rendir»). Con abono 0
--     se puede rendir.
--   · El `cobro_id` queda en el envío (trazabilidad); es lo único que se escribe además de `rendido` y `rendido_en`.
-- · La respuesta suma `total_cobrado` (lo registrado en el libro, que puede ser menor que `total_abono`) y `sin_cobro` (cuántos
--   envíos quedaron sin cobro por abono 0 o saldo 0). El resto (`cantidad`, `mensajero`, `total_abono`, `total_costo`, `neto`) no cambia.
-- · El evento `envio_moto.rendido` suma lo cobrado en el libro.
--
-- Bloqueos: los envíos en orden de id (como antes) y, por cada uno, su factura `for update` (el mismo orden que
-- `marcar_contrarreembolso_cobrado`: primero el objeto de despacho, después la factura). El disparador de notas de crédito
-- (20270228110200) toma la factura primero y los envíos con `skip locked`, así que no hay interbloqueo.
--
-- Permisos: igual que antes, solo el Administrador de la empresa de cada envío, y ahora comprobado ANTES de cualquier lock y sin
-- revelar la existencia: un id que no existe, es de otra organización o de una tienda sin permiso da el mismo `42501` (revisión de
-- seguridad del 2026-11-12). `private.registrar_cobro_interno` exige que el actor sea miembro de la organización con acceso a la
-- empresa: un superadmin con organización activa pero sin membresía recibe, antes de empezar, `42501` con un mensaje claro.
--
-- Factura ya en estado `cobrado` (p. ej. cobrada en mostrador, anterior al libro de cobros, y sin cobros en él): rendir NO registra
-- cobro (cuenta en `sin_cobro`) y deja el estado intacto; así una forma de pago que genera deuda no la hace retroceder a Deuda.
--
-- Facturas en borrador con abono: se listan todas en el error `55000`, como las anuladas.
--
-- Deuda: si la forma de pago del cobro genera deuda (la de la factura o la «Contrarreembolso» de la tienda) y queda saldo, la
-- factura pasa a Deuda, igual que con un contrarreembolso (`private.registrar_cobro_interno`, FR-005 de F-VTA-12).
--
-- Migración aditiva (una columna nula nueva). Reversión (en una migración posterior; no se ejecuta en este PR):
--   restaurar `public.rendir_envios_moto(uuid[])` de 20270222300100_rendir_envios_moto.sql;
--   alter table dominio.envios_moto drop constraint envios_moto_cobro_fk, drop constraint envios_moto_cobro_ck, drop column cobro_id;
--   REVERTIR EXIGE CONTRA-ASIENTO: los cobros ya escritos por rendiciones quedan en el libro (es un libro de dinero, no se borra
--   ni se edita) y la columna `cobro_id` es la única traza de qué envío originó cada uno: antes de soltarla hay que guardar los
--   pares (envío, cobro_id) y, si se quiere deshacer el efecto, corregirlos con un asiento de signo contrario por un camino nuevo
--   (hoy no existe ninguno); el estado de las facturas (Cobrado o Deuda) tampoco retrocede solo.

-- ============================================================================
-- La columna `cobro_id`
-- ============================================================================

alter table dominio.envios_moto add column if not exists cobro_id uuid;

-- Idempotente: cada constraint se agrega solo si no existe.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'envios_moto_cobro_fk' and conrelid = 'dominio.envios_moto'::regclass) then
    alter table dominio.envios_moto
      add constraint envios_moto_cobro_fk
      foreign key (cobro_id, organizacion_id) references dominio.cobros_comprobante (id, organizacion_id);
  end if;
  -- Un cobro del libro solo cuelga de un envío rendido.
  if not exists (select 1 from pg_constraint where conname = 'envios_moto_cobro_ck' and conrelid = 'dominio.envios_moto'::regclass) then
    alter table dominio.envios_moto add constraint envios_moto_cobro_ck check (cobro_id is null or rendido);
  end if;
end
$$;

create unique index if not exists envios_moto_cobro_id_key on dominio.envios_moto (cobro_id) where cobro_id is not null;

comment on column dominio.envios_moto.cobro_id is
  'Cobro del libro (dominio.cobros_comprobante, origen contrarreembolso) que registró la rendición. Nulo si el envío no rendido, o se rindió con abono 0 o con la factura sin saldo. Solo lo escribe rendir_envios_moto.';

-- ============================================================================
-- public.rendir_envios_moto: rinde y cobra
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
  v_total_cobrado numeric(14, 2) := 0;
  v_sin_cobro integer := 0;
  v_empresas uuid[] := array[]::uuid[];
  v_empresa uuid;
  v_numeros text[] := array[]::text[];
  v_comprobantes text;
  v_detalle text;
  v_anulada text;
  v_borradores text;
  v_e dominio.envios_moto;
  v_c dominio.comprobantes_venta;
  v_saldo record;
  v_importe numeric(14, 2);
  v_forma_pago_id uuid;
  v_cobro_id uuid;
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

  -- ── El permiso ANTES de cualquier bloqueo y sin revelar la existencia (revisión de seguridad del 2026-11-12) ──
  -- Se resuelven los envíos SIN lock, con el permiso de la EMPRESA de cada uno (FR-020): solo el Administrador. Un id que no
  -- existe, es de otra organización o de una tienda donde no se puede rendir da el MISMO `42501`: no se sabe si existe, y quien
  -- no puede rendir no toma ningún lock.
  if (select private.nivel_seccion('ventas')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede rendir envíos en moto en esta tienda' using errcode = '42501';
  end if;

  select count(*) into v_encontrados
    from dominio.envios_moto e
    join dominio.comprobantes_venta c on c.id = e.comprobante_id and c.organizacion_id = e.organizacion_id
   where e.id = any (v_ids)
     and e.organizacion_id = v_org
     and (select private.puede_rendir_envio_moto_en_empresa(c.empresa_id));
  if v_encontrados <> cardinality(v_ids) then
    raise exception 'Tu rol no puede rendir envíos en moto en esta tienda' using errcode = '42501';
  end if;

  -- ── Los envíos, con bloqueo de fila (en orden fijo, sin interbloqueos): serializa dos rendiciones ──
  -- Un reintento concurrente espera acá y después ve los envíos ya rendidos: no hay doble evento ni doble cobro.
  perform 1
    from dominio.envios_moto e
   where e.id = any (v_ids)
     and e.organizacion_id = v_org
   order by e.id
     for update;

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
      'cantidad', 0, 'mensajero', null, 'total_abono', 0, 'total_costo', 0, 'neto', 0,
      'total_cobrado', 0, 'sin_cobro', 0);
  end if;

  -- ── Factura anulada después de cargar el envío: no se rinde (decisión de Nicolás, 2026-11-12) ──
  select string_agg(c.numero, ', ' order by c.numero) into v_anulada
    from dominio.envios_moto e
    join dominio.comprobantes_venta c on c.id = e.comprobante_id and c.organizacion_id = e.organizacion_id
   where e.id = any (v_ids)
     and e.organizacion_id = v_org
     and not e.rendido
     and c.estado = 'anulada';
  if v_anulada is not null then
    raise exception 'La factura % fue anulada: su envío en moto no se puede rendir, no se rindió ninguno', v_anulada
      using errcode = '55000';
  end if;

  -- ── Facturas en borrador con abono: se listan todas, como las anuladas ────
  select string_agg(c.numero, ', ' order by c.numero) into v_borradores
    from dominio.envios_moto e
    join dominio.comprobantes_venta c on c.id = e.comprobante_id and c.organizacion_id = e.organizacion_id
   where e.id = any (v_ids)
     and e.organizacion_id = v_org
     and not e.rendido
     and e.abono > 0
     and c.estado = 'borrador';
  if v_borradores is not null then
    raise exception 'La factura % está en borrador: confirmala antes de rendir su envío en moto, no se rindió ninguno', v_borradores
      using errcode = '55000';
  end if;

  -- ── El cobro lo escribe `registrar_cobro_interno`, que exige que el actor sea miembro con acceso a la tienda ──
  -- (un superadmin con organización activa pero sin membresía pasa el permiso de rendir y no puede cobrar): se avisa antes
  -- de empezar, con un mensaje claro.
  if exists (
    select 1
      from dominio.envios_moto e
      join dominio.comprobantes_venta c on c.id = e.comprobante_id and c.organizacion_id = e.organizacion_id
     where e.id = any (v_ids)
       and e.organizacion_id = v_org
       and not e.rendido
       and e.abono > 0
       and c.estado <> 'cobrado'
       and not exists (
         select 1 from public.usuarios_organizacion u
          where u.user_id = v_actor
            and u.organizacion_id = v_org
            and u.estado = 'activo'
            and (u.rol_id = 'administrador' or exists (
              select 1 from public.usuarios_empresas ue
               where ue.user_id = u.user_id and ue.empresa_id = c.empresa_id)))
  ) then
    raise exception 'Para rendir y registrar el cobro tenés que ser miembro de la organización con acceso a la tienda de la factura: un superadmin sin membresía no puede rendir'
      using errcode = '42501';
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

  -- ── La rendición y el cobro de cada envío, en orden de id ─────────────────
  for v_e in
    select e.*
      from dominio.envios_moto e
     where e.id = any (v_ids)
       and e.organizacion_id = v_org
       and not e.rendido
     order by e.id
  loop
    -- La factura, con bloqueo de fila (el orden de bloqueo es envío → factura, como en los contrarreembolsos).
    select * into v_c
      from dominio.comprobantes_venta c
     where c.id = v_e.comprobante_id
       and c.organizacion_id = v_org
       for update;

    -- Una anulación que llegó entre la lectura de arriba y este bloqueo también frena la rendición.
    if v_c.estado = 'anulada' then
      raise exception 'La factura % fue anulada: su envío en moto no se puede rendir, no se rindió ninguno', v_c.numero
        using errcode = '55000';
    end if;

    v_cobro_id := null;
    v_importe := 0;

    -- Una factura que ya está en Cobrado (p. ej. pagada en mostrador, antes del libro de cobros) no recibe cobro: el envío se
    -- rinde y el estado queda intacto (con una forma que genera deuda, un cobro la haría retroceder a Deuda).
    if v_e.abono > 0 and v_c.estado <> 'cobrado' then
      select * into v_saldo from private.saldo_comprobante(v_c.id);
      -- El tope del cobro es el saldo neto (total − cobros − notas de crédito): nunca se cobra de más.
      v_importe := least(v_e.abono, v_saldo.saldo);
    end if;

    if v_importe > 0 then
      if v_c.estado = 'borrador' then
        raise exception 'La factura % está en borrador: confirmala antes de rendir su envío en moto, no se rindió ninguno', v_c.numero
          using errcode = '55000';
      end if;

      -- La forma de pago: la de la factura si la tiene; si no, la forma «Contrarreembolso» de la tienda.
      v_forma_pago_id := v_c.forma_pago_id;
      if v_forma_pago_id is null then
        select f.id into v_forma_pago_id
          from dominio.formas_pago f
         where f.organizacion_id = v_org
           and f.empresa_id = v_c.empresa_id
           and f.tipo = 'contrarreembolso'
           and f.activo
         order by f.orden, f.nombre
         limit 1;
      end if;
      if v_forma_pago_id is null then
        raise exception 'La factura % no tiene forma de pago y la tienda no tiene una forma «Contrarreembolso»: no se puede registrar el cobro, no se rindió ninguno', v_c.numero
          using errcode = '22023';
      end if;

      -- El único camino al libro de cobros: valida el tope, pasa la factura a Cobrado o Deuda y deja su evento.
      v_cobro_id := private.registrar_cobro_interno(
        v_c.id, v_importe, v_forma_pago_id, null, 'contrarreembolso', v_actor);
      v_total_cobrado := v_total_cobrado + v_importe;
    else
      v_sin_cobro := v_sin_cobro + 1;
    end if;

    -- Escribe solo `rendido`, `rendido_en` y `cobro_id` (no toca `updated_at`: la rendición no cambia los datos del envío).
    update dominio.envios_moto e
       set rendido = true,
           rendido_en = now(),
           cobro_id = v_cobro_id
     where e.id = v_e.id;

    v_numeros := v_numeros || v_c.numero;
    v_empresas := v_empresas || v_c.empresa_id;
  end loop;

  -- ── El evento (FR-024): uno por rendición, en la misma transacción ────────
  -- La empresa del evento es la de los envíos si todos son de una sola; si no, queda sin empresa.
  select array_agg(distinct x) into v_empresas from unnest(v_empresas) as x;
  v_empresa := case when cardinality(v_empresas) = 1 then v_empresas[1] else null end;

  select string_agg(n, ', ' order by n) into v_comprobantes from unnest(v_numeros) as n;

  v_detalle := format('Rindió %s envío(s) en moto del mensajero %s: total a rendir %s, costo %s, neto %s, cobrado en el libro %s. Facturas: ',
    v_pendientes, v_mensajero, v_total_abono, v_total_costo, v_total_abono - v_total_costo, v_total_cobrado);
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
    'neto', v_total_abono - v_total_costo,
    'total_cobrado', v_total_cobrado,
    'sin_cobro', v_sin_cobro);
end;
$$;

revoke execute on function public.rendir_envios_moto(uuid[]) from public, anon;
grant execute on function public.rendir_envios_moto(uuid[]) to authenticated;

comment on function public.rendir_envios_moto(uuid[]) is
  'Rinde envíos en moto, de a uno o en lote (F-VTA-25): todo o nada, idempotente (los ya rendidos se ignoran), solo enviados y no rendidos de un mismo mensajero y de facturas no anuladas (55000). Registra en el libro de cobros de cada factura, por private.registrar_cobro_interno con origen contrarreembolso, un cobro por el menor entre el abono y el saldo neto. Exige el rol administrador en la empresa de cada envío. Escribe solo rendido, rendido_en y cobro_id. Devuelve {cantidad, mensajero, total_abono, total_costo, neto, total_cobrado, sin_cobro}. Deja un evento envio_moto.rendido. No revierte.';
