-- MSF-667 (lote 32, MSF-647): `public.revertir_cobro`, la reversión auditada de un cobro mal cargado.
--
-- Decisión tomada: función `revertir_cobro` con CONTRA-ASIENTO (el libro de cobros nunca se edita ni se borra), solo
-- administrador, motivo obligatorio; reabre «Cobrado» → «Deuda».
--
-- Esquema (Principio VII): sin tablas nuevas; altera `dominio.cobros_comprobante` (dominio) con dos columnas nulables
-- (`revierte_cobro_id`, `motivo_reversion`) y un origen nuevo `reversion`. El contra-asiento es una fila con importe
-- NEGATIVO que repite empresa, comprobante, forma de pago y cuenta del cobro original; así `sum(importe)` (saldo,
-- alertas, cuenta corriente, pagos) ya descuenta lo revertido sin tocar a los lectores.
--
-- Reglas de la RPC (errores: 42501 permiso · P0002 no existe · 22023 dato inválido · 55000 estado no válido):
--   · Solo administrador de la organización (el rol sale de la sesión; los demás roles reciben 42501).
--   · Motivo obligatorio, hasta 300 caracteres. El actor y el momento quedan en el contra-asiento
--     (`registrado_por`, `registrado_en`) y en la Actividad (`comprobante.cobro_revertido`).
--   · No se revierte: un contra-asiento, un cobro ya revertido (un cobro se revierte una sola vez: índice único), un
--     cobro conciliado contra el banco (primero se revierte la conciliación) ni el cobro de un contrarreembolso (se
--     corrige desde el contrarreembolso). Tampoco sobre una factura borrador o anulada.
--   · Con el saldo neto de nuevo > 0 y la factura en «Cobrado», pasa a «Deuda» por la función de estado de cobro
--     (matriz de transiciones del actor sistema); con saldo 0 sigue la regla vigente (saldo 0 ⇒ Cobrado).
--   · El contra-asiento no se concilia (`aplicar_conciliacion` lo rechaza) ni deja conciliar al original revertido.
--   · Orden de bloqueos: comprobante primero y después el cobro, como `registrar_cobro_interno`.
--
-- Seguridad: `security definer`, `search_path = ''`; organización y actor de la sesión. `revoke … from public, anon` y
-- `grant execute … to authenticated` explícitos. Límite documentado en docs/cobros-por-comprobante.md.
--
-- Migración aditiva (la única restricción que se reemplaza es `importe > 0`, que pasa a admitir el contra-asiento).
-- Reversión: (en una migración posterior, solo si no hay contra-asientos: `select count(*) from dominio.cobros_comprobante
-- where origen = 'reversion'` debe dar 0): drop function public.revertir_cobro(uuid, text);
-- alter table dominio.cobros_comprobante drop constraint cobros_comprobante_reversion_ck;
-- drop index dominio.cobros_comprobante_revierte_uq; alter table dominio.cobros_comprobante drop column revierte_cobro_id,
-- drop column motivo_reversion; recrear los checks `importe > 0` y `origen in ('manual', 'contrarreembolso')`; y volver a
-- las definiciones de private.validar_cobro_comprobante() (20270114100000) y private.aplicar_conciliacion()
-- (20270114110000).

-- ============================================================================
-- El libro admite el contra-asiento
-- ============================================================================
alter table dominio.cobros_comprobante
  add column if not exists revierte_cobro_id uuid,
  add column if not exists motivo_reversion text check (length(motivo_reversion) <= 300);

alter table dominio.cobros_comprobante drop constraint if exists cobros_comprobante_importe_check;
alter table dominio.cobros_comprobante drop constraint if exists cobros_comprobante_origen_check;
alter table dominio.cobros_comprobante add constraint cobros_comprobante_origen_check
  check (origen in ('manual', 'contrarreembolso', 'reversion'));
alter table dominio.cobros_comprobante add constraint cobros_comprobante_reversion_ck check (
  (origen = 'reversion' and importe < 0 and revierte_cobro_id is not null and motivo_reversion is not null)
  or (origen <> 'reversion' and importe > 0 and revierte_cobro_id is null and motivo_reversion is null)
);
alter table dominio.cobros_comprobante add constraint cobros_comprobante_revierte_fk
  foreign key (revierte_cobro_id, organizacion_id) references dominio.cobros_comprobante (id, organizacion_id);
create unique index if not exists cobros_comprobante_revierte_uq
  on dominio.cobros_comprobante (revierte_cobro_id) where revierte_cobro_id is not null;

comment on column dominio.cobros_comprobante.revierte_cobro_id is
  'MSF-667: en un contra-asiento (origen reversion), el cobro que revierte. Un cobro se revierte una sola vez.';
comment on column dominio.cobros_comprobante.motivo_reversion is
  'MSF-667: motivo obligatorio del contra-asiento (hasta 300 caracteres).';

-- ============================================================================
-- Validación del libro: el contra-asiento no revalida forma de pago ni cuenta
-- ============================================================================
create or replace function private.validar_cobro_comprobante()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from dominio.comprobantes_venta c
     where c.id = new.comprobante_id
       and c.organizacion_id = new.organizacion_id
  ) then
    raise exception 'El comprobante no es de la organización del cobro' using errcode = '23514';
  end if;

  if not exists (
    select 1 from dominio.comprobantes_venta c
     where c.id = new.comprobante_id
       and c.empresa_id = new.empresa_id
  ) then
    raise exception 'El comprobante no es de la empresa del cobro' using errcode = '23514';
  end if;

  -- MSF-667: el contra-asiento de `revertir_cobro` repite la forma de pago y la cuenta del cobro original aunque después se
  -- hayan desactivado: solo se exige que el comprobante sea de la organización y de la empresa (arriba).
  if new.origen = 'reversion' then
    return new;
  end if;

  if not exists (
    select 1 from dominio.formas_pago f
     where f.id = new.forma_pago_id
       and f.organizacion_id = new.organizacion_id
       and f.empresa_id = new.empresa_id
  ) then
    raise exception 'La forma de pago no es de la empresa del cobro' using errcode = '23514';
  end if;

  if not exists (
    select 1 from dominio.formas_pago f
     where f.id = new.forma_pago_id and f.activo
  ) then
    raise exception 'La forma de pago está desactivada' using errcode = '23514';
  end if;

  if new.cuenta_cobro_id is not null then
    if not exists (
      select 1 from dominio.cuentas_cobro c
       where c.id = new.cuenta_cobro_id
         and c.organizacion_id = new.organizacion_id
    ) then
      raise exception 'La cuenta de cobro no es de la organización del cobro' using errcode = '23514';
    end if;
    if not exists (
      select 1 from dominio.cuentas_cobro c
       where c.id = new.cuenta_cobro_id and c.activa
    ) then
      raise exception 'La cuenta de cobro está marcada «No usar»' using errcode = '23514';
    end if;
    if not exists (
      select 1 from dominio.cuentas_cobro_empresas ce
       where ce.cuenta_id = new.cuenta_cobro_id
         and ce.empresa_id = new.empresa_id
         and ce.organizacion_id = new.organizacion_id
    ) then
      raise exception 'La cuenta de cobro no está habilitada en la empresa del cobro'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function private.validar_cobro_comprobante() from public, anon, authenticated;

-- ============================================================================
-- Conciliación: ni el contra-asiento ni un cobro revertido
-- ============================================================================
create or replace function private.aplicar_conciliacion(
  p_id uuid,
  p_actualizado_en timestamptz,
  p_conciliado boolean
)
returns dominio.cobros_comprobante
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_cobro dominio.cobros_comprobante;
  v_nombre text;
  v_numero text;
  v_cuenta text;
  v_detalle text;
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para conciliar pagos' using errcode = '42501';
  end if;

  -- ── El pago, con bloqueo de fila: serializa dos conciliaciones simultáneas ──
  select * into v_cobro
    from dominio.cobros_comprobante b
   where b.id = p_id and b.organizacion_id = v_org
     for update;
  if not found then
    raise exception 'El pago no existe' using errcode = 'P0002';
  end if;

  -- ── El permiso es el de la empresa del pago (FR-020) ──────────────────────
  if not (select private.puede_conciliar_pago_en_empresa(v_cobro.empresa_id)) then
    raise exception 'Tu rol no puede conciliar pagos en esta tienda' using errcode = '42501';
  end if;

  -- ── MSF-667: un contra-asiento o un cobro ya revertido no se concilia ──────
  if v_cobro.origen = 'reversion' then
    raise exception 'Este movimiento es una reversión de cobro: no se concilia contra el banco' using errcode = '55000';
  end if;
  if p_conciliado and exists (
    select 1 from dominio.cobros_comprobante r
     where r.revierte_cobro_id = v_cobro.id and r.organizacion_id = v_cobro.organizacion_id
  ) then
    raise exception 'Este cobro fue revertido: no se puede conciliar' using errcode = '55000';
  end if;

  -- ── Solo se concilia lo que tiene cuenta de cobro (FR-021) ───────────────
  if v_cobro.cuenta_cobro_id is null then
    raise exception 'Este cobro no tiene cuenta de cobro: no hay nada que conciliar contra el banco'
      using errcode = '22023';
  end if;

  -- ── Idempotente: si el pago ya está en el estado pedido, no hay nada que hacer ──
  if (v_cobro.aprobado_por is not null) = coalesce(p_conciliado, false) then
    return v_cobro;
  end if;

  -- ── Bloqueo optimista: el pago no cambió desde que la pantalla lo leyó ───
  if p_actualizado_en is null or p_actualizado_en <> v_cobro.actualizado_en then
    raise exception 'El pago fue modificado por otra persona' using errcode = '40001';
  end if;

  -- ── Quién aprueba (foto del nombre: el historial sobrevive a la cuenta) ───
  select coalesce(nullif(btrim(concat_ws(' ', pr.nombre, pr.apellido)), ''), u.email::text)
    into v_nombre
    from auth.users u
    left join public.perfiles_usuario pr on pr.user_id = u.id
   where u.id = v_actor;
  if v_nombre is null then
    raise exception 'El usuario que concilia el pago no existe' using errcode = '22023';
  end if;

  select c.numero into v_numero
    from dominio.comprobantes_venta c
   where c.id = v_cobro.comprobante_id;
  select cc.nombre into v_cuenta
    from dominio.cuentas_cobro cc
   where cc.id = v_cobro.cuenta_cobro_id;

  -- ── La aprobación o su reversión. No se toca el comprobante ni el saldo (FR-022) ─
  if p_conciliado then
    update dominio.cobros_comprobante
       set aprobado_por = v_actor,
           aprobado_por_nombre = v_nombre,
           aprobado_en = now(),
           actualizado_en = now()
     where id = v_cobro.id
    returning * into v_cobro;
  else
    update dominio.cobros_comprobante
       set aprobado_por = null,
           aprobado_por_nombre = null,
           aprobado_en = null,
           actualizado_en = now()
     where id = v_cobro.id
    returning * into v_cobro;
  end if;

  -- ── El evento (FR-022). Nunca con datos bancarios completos ───────────────
  if p_conciliado then
    v_detalle := format('Pago de %s conciliado en la cuenta %s de la factura %s',
      v_cobro.importe, coalesce(v_cuenta, 'sin cuenta'), coalesce(v_numero, 'sin número'));
  else
    v_detalle := format('Conciliación revertida del pago de %s en la cuenta %s de la factura %s',
      v_cobro.importe, coalesce(v_cuenta, 'sin cuenta'), coalesce(v_numero, 'sin número'));
  end if;

  perform private.insertar_actividad(
    v_cobro.organizacion_id,
    v_actor,
    case when p_conciliado then 'pago.conciliado' else 'pago.conciliacion_revertida' end,
    v_detalle,
    v_cobro.empresa_id
  );

  return v_cobro;
end;
$$;

revoke execute on function private.aplicar_conciliacion(uuid, timestamptz, boolean) from public, anon, authenticated;

-- ============================================================================
-- RPC
-- ============================================================================
create or replace function public.revertir_cobro(p_cobro_id uuid, p_motivo text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_comprobante_id uuid;
  v_c dominio.comprobantes_venta;
  v_cobro dominio.cobros_comprobante;
  v_saldo record;
  v_nombre text;
  v_nuevo uuid;
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para revertir cobros' using errcode = '42501';
  end if;
  if not (select private.puede_escribir()) then
    raise exception 'Solo el administrador puede revertir un cobro' using errcode = '42501';
  end if;

  -- El comprobante se toma primero (mismo orden que registrar_cobro_interno); el cobro se lee sin bloqueo para saber cuál.
  select b.comprobante_id into v_comprobante_id
    from dominio.cobros_comprobante b
   where b.id = p_cobro_id and b.organizacion_id = v_org;
  if not found then
    raise exception 'El cobro no existe' using errcode = 'P0002';
  end if;

  select * into v_c from dominio.comprobantes_venta c
   where c.id = v_comprobante_id and c.organizacion_id = v_org for update;
  if not found then
    raise exception 'El cobro no existe' using errcode = 'P0002';
  end if;

  select * into v_cobro from dominio.cobros_comprobante b
   where b.id = p_cobro_id and b.organizacion_id = v_org for update;

  if v_motivo = '' then
    raise exception 'Escribí el motivo de la reversión' using errcode = '22023', hint = 'motivo';
  end if;
  if length(v_motivo) > 300 then
    raise exception 'El motivo de la reversión no puede superar los 300 caracteres' using errcode = '22023', hint = 'motivo';
  end if;
  if v_cobro.origen = 'reversion' then
    raise exception 'Un contra-asiento no se revierte' using errcode = '55000';
  end if;
  if v_cobro.origen = 'contrarreembolso' then
    raise exception 'El cobro de un contrarreembolso se corrige desde el contrarreembolso' using errcode = '55000';
  end if;
  if exists (select 1 from dominio.cobros_comprobante r
              where r.revierte_cobro_id = v_cobro.id and r.organizacion_id = v_org) then
    raise exception 'El cobro ya fue revertido' using errcode = '55000';
  end if;
  if v_cobro.aprobado_por is not null then
    raise exception 'El cobro está conciliado: revertí primero la conciliación' using errcode = '55000';
  end if;
  if v_c.estado in ('borrador', 'anulada') then
    raise exception 'La factura no está en un estado operativo: no admite revertir cobros' using errcode = '55000';
  end if;

  select coalesce(nullif(btrim(concat_ws(' ', pr.nombre, pr.apellido)), ''), u.email::text)
    into v_nombre
    from auth.users u
    left join public.perfiles_usuario pr on pr.user_id = u.id
   where u.id = v_actor;
  if v_nombre is null then
    raise exception 'El usuario que revierte el cobro no existe' using errcode = '22023';
  end if;

  insert into dominio.cobros_comprobante (
    organizacion_id, empresa_id, comprobante_id, importe, forma_pago_id, cuenta_cobro_id,
    origen, registrado_por, registrado_por_nombre, revierte_cobro_id, motivo_reversion
  )
  values (
    v_cobro.organizacion_id, v_cobro.empresa_id, v_cobro.comprobante_id, -v_cobro.importe, v_cobro.forma_pago_id,
    v_cobro.cuenta_cobro_id, 'reversion', v_actor, v_nombre, v_cobro.id, v_motivo
  )
  returning id into v_nuevo;

  select * into v_saldo from private.saldo_comprobante(v_c.id);
  if v_saldo.saldo = 0 then
    perform private.marcar_estado_cobro_comprobante(v_c.id, 'cobrado');
  elsif v_c.estado = 'cobrado' then
    perform private.marcar_estado_cobro_comprobante(v_c.id, 'deuda');
  end if;

  perform private.insertar_actividad(
    v_c.organizacion_id,
    v_actor,
    'comprobante.cobro_revertido',
    format('Revirtió el cobro de ARS %s de la factura %s: %s', v_cobro.importe, v_c.numero, v_motivo),
    v_c.empresa_id
  );
  return v_nuevo;
end;
$$;

revoke execute on function public.revertir_cobro(uuid, text) from public, anon;
grant execute on function public.revertir_cobro(uuid, text) to authenticated;

comment on function public.revertir_cobro(uuid, text) is
  'Revierte un cobro con un contra-asiento auditado (importe negativo, origen reversion), solo administrador y con motivo obligatorio; reabre Cobrado → Deuda si el saldo vuelve a ser positivo. Devuelve el id del contra-asiento (MSF-667).';
