-- MSF-618 (devolución del Revisor del PR #638): el detalle del evento `comprobante.cobro_registrado`
-- se armaba sin moneda («Cobro de 859100 por …») y la pantalla le anteponía siempre «$».
-- Con el texto sin moneda, un consumidor (la pantalla, el CSV, un tablero) tiene que SUPONER que
-- el importe es en pesos; si algún día hay comprobantes en otra moneda, el detalle mentiría.
--
-- Esquemas (Principio VII, verificado objeto por objeto):
--   private.registrar_cobro_interno   private (interna)  recreada: el detalle lleva la moneda.
--   dominio.comprobantes_venta        dominio (existente) sin columna de moneda: no se altera.
--   public.registro_actividad         public (existente)  recibe el evento; no se altera.
--   dominio.cuentas_cobro             dominio (existente) no se lee ni se altera (ver la moneda abajo).
-- Sin tablas nuevas, sin columnas nuevas y sin cambiar el libro de cobros: solo el texto del detalle.
--
-- De dónde sale la moneda (decisión):
-- · La del IMPORTE, que es la del comprobante que se cobra. `dominio.comprobantes_venta` no tiene
--   columna de moneda: sus importes son pesos (F-PRE-03 recalcula a pesos los precios en dólares),
--   así que hoy la moneda es ARS. Cuando el comprobante tenga moneda, este es el único lugar que
--   hay que cambiar.
-- · La cuenta de cobro NO cambia la moneda del importe: dice dónde entra el dinero, no en qué
--   unidad se cobra. El importe descuenta el saldo del comprobante (que es en pesos) y el diálogo
--   «Registrar cobro» lo propone con ese saldo; una cuenta en dólares no convierte el importe.
--
-- El texto nuevo es «Cobro de ARS 859100 por …». La pantalla (`formatearDetalleActividad`) muestra
-- la moneda que trae el texto: «Cobro de $ 859.100,00». Las filas anteriores a esta migración no
-- llevan moneda y se siguen mostrando como pesos: son cobros en pesos.
--
-- Migración aditiva (recrea una función; no borra ni altera datos). Reversión (en una migración
-- posterior; no se ejecuta en este PR): volver a crear `private.registrar_cobro_interno` con el
-- detalle anterior, sin moneda:
--   v_detalle := format('Cobro de %s por %s en la factura %s', p_importe, v_forma.nombre, v_c.numero);
--   v_detalle := format('Cobro de %s por %s en la cuenta %s de la factura %s',
--     p_importe, v_forma.nombre, v_cuenta, v_c.numero);

create or replace function private.registrar_cobro_interno(
  p_comprobante_id uuid,
  p_importe numeric,
  p_forma_pago_id uuid,
  p_cuenta_cobro_id uuid,
  p_origen text,
  p_actor uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_c dominio.comprobantes_venta;
  v_saldo record;
  v_forma dominio.formas_pago;
  v_cobro_id uuid;
  v_nombre text;
  v_cuenta text;
  v_detalle text;
begin
  -- ── Validaciones del pedido (FR-003) ───────────────────────────────────────
  if p_actor is null then
    raise exception 'El cobro necesita un actor: no se puede registrar sin saber quién lo hizo'
      using errcode = '22023';
  end if;

  if p_importe is null then
    raise exception 'El importe es obligatorio' using errcode = '22023';
  end if;

  if p_importe <= 0 then
    raise exception 'El importe tiene que ser mayor a cero' using errcode = '22023';
  end if;

  if round(p_importe, 2) <> p_importe then
    raise exception 'El importe puede tener hasta dos decimales' using errcode = '22023';
  end if;

  if p_forma_pago_id is null then
    raise exception 'La forma de pago es obligatoria' using errcode = '22023';
  end if;

  if p_origen is null then
    p_origen := 'manual';
  end if;
  if p_origen not in ('manual', 'contrarreembolso') then
    raise exception 'El origen del cobro no es válido' using errcode = '22023';
  end if;

  -- ── El comprobante, con bloqueo de fila (FR-003) ──────────────────────────
  select * into v_c
    from dominio.comprobantes_venta c
   where c.id = p_comprobante_id
     for update;
  if not found then
    raise exception 'El comprobante no existe' using errcode = 'P0002';
  end if;

  if v_c.tipo <> 'factura' then
    raise exception 'Solo las facturas admiten cobros' using errcode = '22023';
  end if;

  if v_c.empresa_id is null then
    raise exception 'La factura no tiene empresa: no admite cobros' using errcode = '22023';
  end if;

  if v_c.estado in ('borrador', 'anulada') then
    raise exception 'La factura no está en un estado operativo: no admite cobros'
      using errcode = '55000';
  end if;

  -- El actor tiene que tener acceso a la empresa de la factura: es la defensa ante cualquier
  -- vía de escritura (la RPC `registrar_cobro` además exige la acción `registrar_cobro`).
  if not exists (
    select 1 from public.usuarios_organizacion u
     where u.user_id = p_actor
       and u.organizacion_id = v_c.organizacion_id
       and u.estado = 'activo'
       and (u.rol_id = 'administrador' or exists (
         select 1 from public.usuarios_empresas ue
          where ue.user_id = u.user_id and ue.empresa_id = v_c.empresa_id))
  ) then
    raise exception 'El actor no tiene acceso a la empresa de la factura' using errcode = '42501';
  end if;

  -- ── La forma de pago, de la misma empresa ──────────────────────────────────
  select * into v_forma
    from dominio.formas_pago f
   where f.id = p_forma_pago_id
     and f.organizacion_id = v_c.organizacion_id
     and f.empresa_id = v_c.empresa_id;
  if not found then
    raise exception 'La forma de pago no es de la empresa de la factura' using errcode = '22023';
  end if;

  -- ── El tope: el importe no puede superar el saldo (FR-003) ────────────────
  select * into v_saldo from private.saldo_comprobante(p_comprobante_id);
  if p_importe > v_saldo.saldo then
    raise exception 'El importe supera el saldo pendiente: el saldo es % y el importe es %',
      v_saldo.saldo, p_importe
      using errcode = 'P0001';
  end if;

  -- ── Quién registra (foto del nombre: el historial sobrevive a la cuenta) ───
  select coalesce(nullif(btrim(concat_ws(' ', pr.nombre, pr.apellido)), ''), u.email::text)
    into v_nombre
    from auth.users u
    left join public.perfiles_usuario pr on pr.user_id = u.id
   where u.id = p_actor;
  if v_nombre is null then
    raise exception 'El usuario que registra el cobro no existe' using errcode = '22023';
  end if;

  -- ── El cobro (FR-001) ─────────────────────────────────────────────────────
  insert into dominio.cobros_comprobante (
    organizacion_id, empresa_id, comprobante_id, importe, forma_pago_id, cuenta_cobro_id,
    origen, registrado_por, registrado_por_nombre
  )
  values (
    v_c.organizacion_id, v_c.empresa_id, v_c.id, p_importe, v_forma.id, p_cuenta_cobro_id,
    p_origen, p_actor, v_nombre
  )
  returning id into v_cobro_id;

  -- ── Cobrado o Deuda (FR-004, FR-005) ───────────────────────────────────────
  select * into v_saldo from private.saldo_comprobante(p_comprobante_id);
  if v_saldo.saldo = 0 then
    perform private.marcar_estado_cobro_comprobante(p_comprobante_id, 'cobrado');
  elsif v_forma.genera_deuda then
    perform private.marcar_estado_cobro_comprobante(p_comprobante_id, 'deuda');
  end if;

  -- ── El evento (FR-006) ────────────────────────────────────────────────────
  v_cuenta := null;
  if p_cuenta_cobro_id is not null then
    select c.nombre into v_cuenta from dominio.cuentas_cobro c where c.id = p_cuenta_cobro_id;
  end if;

  -- La moneda del importe es la del comprobante: hoy no tiene columna de moneda (sus importes son
  -- pesos, F-PRE-03), así que es ARS. El día que la tenga, se lee de ahí y no de una constante.
  if v_cuenta is null then
    v_detalle := format('Cobro de ARS %s por %s en la factura %s', p_importe, v_forma.nombre, v_c.numero);
  else
    v_detalle := format('Cobro de ARS %s por %s en la cuenta %s de la factura %s',
      p_importe, v_forma.nombre, v_cuenta, v_c.numero);
  end if;

  perform private.insertar_actividad(
    v_c.organizacion_id,
    p_actor,
    'comprobante.cobro_registrado',
    v_detalle,
    v_c.empresa_id
  );

  return v_cobro_id;
end;
$$;

revoke execute on function private.registrar_cobro_interno(uuid, numeric, uuid, uuid, text, uuid)
  from public, anon, authenticated;

comment on function private.registrar_cobro_interno(uuid, numeric, uuid, uuid, text, uuid) is
  'Registra un cobro sobre una factura (F-VTA-12): valida el tope contra el saldo con bloqueo de fila, pasa la factura a Cobrado o Deuda por la función private de MSF-177 y deja el evento comprobante.cobro_registrado con la moneda del importe (ARS: la del comprobante). No la ejecuta authenticated.';
