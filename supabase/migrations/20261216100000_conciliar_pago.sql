-- F-VTA-13 (MSF-401, épica MSF-195, spec 20261024-150000-ventas-cobros-y-conciliacion,
-- FR-020, FR-021, FR-022): conciliación de pagos por cuenta de cobro.
--
-- `public.conciliar_pago` y `public.revertir_conciliacion_pago`: aprobar (o deshacer) el
-- acuerdo entre un cobro con cuenta de cobro y el extracto del banco.
--
-- Esquemas (Principio VII), verificados objeto por objeto:
--   public.permisos_rol_accion   public (plataforma)  recibe la acción `conciliar_pago` como
--                                                 DATO: es la matriz de permisos por
--                                                 organización × rol × sección × acción.
--   public.conciliar_pago        public (nueva RPC)   el camino público de escritura; mueve
--                                                 `aprobado_*` de `dominio.cobros_comprobante`.
--   public.revertir_conciliacion_pago
--                                public (nueva RPC)   ídem, en sentido contrario.
--   private.aplicar_conciliacion
--                                private (interna)    el ÚNICO camino que mueve la aprobación:
--                                                 las reglas viven en un solo lugar y las dos RPC
--                                                 públicas no pueden divergir.
--   private.puede_conciliar_pago_en_empresa
--                                private (interna)    el permiso por EMPRESA (no por empresa
--                                                 activa): la tienda del pago.
--   private.matriz_acciones_iniciales / private.puede_accion
--                                private (internas)   la matriz que siembra la acción y la regla
--                                                 que la reconoce.
--   dominio.cobros_comprobante    dominio (existente)  el libro de cobros (migración
--                                                 20261215100000): guarda la aprobación.
--   dominio.comprobantes_venta    dominio (existente)  la factura pagada: se LEE (número) y no
--                                                 se toca (FR-022).
--   dominio.cuentas_cobro         dominio (existente)  la cuenta del pago: se LEE (nombre).
--   public.registro_actividad     public (existente)  auditoría transversal: los eventos
--                                                 `pago.conciliado` y `pago.conciliacion_revertida`.
-- Sin tablas nuevas: esta migración no crea ni altera columnas de ninguna tabla.
--
-- Permiso (FR-020):
-- · La acción `conciliar_pago` de la sección `ventas` se siembra para Administración y
--   Administrador. Los demás roles quedan sin permiso aunque tengan `ventas` en edición
--   (Operador) o solo lectura (Depósito, Consulta, Miembro, Mostrador).
-- · El permiso se resuelve con el rol del usuario en la EMPRESA del PAGO
--   (`private.puede_conciliar_pago_en_empresa`), no con la suma de sus roles: quien no puede
--   conciliar en la tienda A no lo hereda por ser Administración en la B (mismo criterio que
--   `private.puede_registrar_cobro_en_empresa`).
-- · Conciliar es escribir: exige `ventas` en edición en esa empresa.
--
-- Reglas de la conciliación (FR-021, FR-022) — todas en `private.aplicar_conciliacion`:
-- · Solo un cobro CON CUENTA DE COBRO se concilia: el efectivo no va a ninguna cuenta y no
--   tiene nada que conciliar contra un banco (decisión 5 de la spec). Un cobro sin cuenta se
--   rechaza con `22023`.
-- · IDEMPOTENTE: conciliar un pago ya conciliado (o revertir uno ya revertido) no cambia
--   nada, no deja evento y no avanza `actualizado_en`. El estado repetido es un no-op, no un
--   error.
-- · BLOQUEO OPTIMISTA: el llamador manda el `actualizado_en` que leyó; si el pago cambió
--   desde entonces, se rechaza con `40001` sin pisar nada (el mismo criterio que
--   `public.actualizar_cuenta_cobro`).
-- · La fila se toma con `for update`: dos conciliaciones simultáneas del mismo pago se
--   serializan y solo la primera mueve la aprobación.
-- · CONCILIAR NO ES COBRAR: no se toca el estado del comprobante (ni `cobrado` ni `deuda`), no
--   se toca el saldo y no se registra ningún cobro nuevo. El saldo lo mueve
--   `private.registrar_cobro_interno` (F-VTA-12), nunca esta RPC.
-- · Cada cambio deja su evento en `public.registro_actividad` (actor, tienda, importe y cuenta
--   por su NOMBRE): nunca con datos bancarios completos (ni CBU ni CUIT).
--
-- Migración aditiva. Reversión (en una migración posterior; no se ejecuta en este PR):
--   drop function public.conciliar_pago(uuid, timestamptz);
--   drop function public.revertir_conciliacion_pago(uuid, timestamptz);
--   drop function private.aplicar_conciliacion(uuid, timestamptz, boolean);
--   drop function private.puede_conciliar_pago_en_empresa(uuid);
--   delete from public.permisos_rol_accion where accion = 'conciliar_pago';
--   alter table public.permisos_rol_accion drop constraint permisos_rol_accion_accion_check;
--   alter table public.permisos_rol_accion add constraint permisos_rol_accion_accion_check
--     check (accion in ('eliminar', 'exportar', 'ver_costos', 'editar_precio', 'registrar_cobro'));
--   restaurar private.matriz_acciones_iniciales() y private.puede_accion de
--   20261215100300_registrar_cobro.sql.

-- ============================================================================
-- La acción `conciliar_pago` en la matriz de permisos (plataforma)
-- ============================================================================

alter table public.permisos_rol_accion drop constraint if exists permisos_rol_accion_accion_check;
alter table public.permisos_rol_accion
  add constraint permisos_rol_accion_accion_check
  check (accion in ('eliminar', 'exportar', 'ver_costos', 'editar_precio', 'anular', 'emitir_nota_credito', 'registrar_cobro', 'conciliar_pago'));

comment on constraint permisos_rol_accion_accion_check on public.permisos_rol_accion is
  'Acciones por rol y sección. anular y emitir_nota_credito (F-VTA-11), registrar_cobro (F-VTA-12) y conciliar_pago (F-VTA-13) viven solo en ventas.';

-- Valores iniciales de la acción (FR-020): Administración y Administrador concilian; los demás
-- roles, no. `editar_precio`, `registrar_cobro` y `conciliar_pago` son de Ventas.
create or replace function private.matriz_acciones_iniciales()
returns table (rol_id text, seccion text, accion text, permitido boolean)
language sql
immutable
set search_path = ''
as $$
  select m.rol_id, m.seccion, a.accion,
    case a.accion
      when 'eliminar' then m.rol_id = 'administrador'
      when 'exportar' then m.rol_id in ('administrador', 'operador', 'administracion')
      when 'editar_precio' then m.rol_id in ('administrador', 'operador')
      when 'anular' then m.rol_id in ('administrador', 'administracion')
      when 'emitir_nota_credito' then m.rol_id in ('administrador', 'administracion')
      when 'registrar_cobro' then m.rol_id in ('administrador', 'administracion', 'mostrador')
      when 'conciliar_pago' then m.rol_id in ('administrador', 'administracion')
      else m.rol_id in ('administrador', 'administracion')
    end
  from private.matriz_inicial() m
  cross join (values ('eliminar'), ('exportar'), ('ver_costos'), ('editar_precio'), ('anular'), ('emitir_nota_credito'), ('registrar_cobro'), ('conciliar_pago')) as a(accion)
  where a.accion not in ('editar_precio', 'anular', 'emitir_nota_credito', 'registrar_cobro', 'conciliar_pago') or m.seccion = 'ventas';
$$;

comment on function private.matriz_acciones_iniciales() is
  'Valores iniciales PROPUESTOS de permisos por acción (FR-006); pendientes de confirmar con el cliente. editar_precio (F-VTA-06), anular y emitir_nota_credito (F-VTA-11), registrar_cobro (F-VTA-12) y conciliar_pago (F-VTA-13) solo en ventas: Administrador y Operador; Administrador y Administración; Mostrador, Administración y Administrador; y Administración y Administrador.';

-- `private.puede_accion` reconoce la acción nueva. Conciliar es escribir: exige `edicion`,
-- como eliminar y editar precio (quien solo lee nunca aprueba una conciliación).
create or replace function private.puede_accion(p_seccion text, p_accion text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_accion not in ('eliminar', 'exportar', 'ver_costos', 'editar_precio', 'anular', 'emitir_nota_credito', 'registrar_cobro', 'conciliar_pago') then false
    when (select private.is_superadmin())
      and exists (select 1 from public.superadmin_organizacion_activa a where a.user_id = (select auth.uid()))
      then true
    -- eliminar, editar_precio, anular, emitir_nota_credito, registrar_cobro y conciliar_pago exigen edición; exportar y ver costos exigen al menos lectura.
    when p_accion in ('eliminar', 'editar_precio', 'anular', 'emitir_nota_credito', 'registrar_cobro', 'conciliar_pago') and (select private.nivel_seccion(p_seccion)) <> 'edicion' then false
    when (select private.nivel_seccion(p_seccion)) = 'ninguno' then false
    else coalesce(
      (
        select bool_or(private.accion_de_rol(x.organizacion_id, x.rol_id, p_seccion, p_accion))
        from private.roles_de_referencia(p_seccion) x
        where case
          when p_accion in ('eliminar', 'editar_precio', 'anular', 'emitir_nota_credito', 'registrar_cobro', 'conciliar_pago') then private.nivel_de_rol(x.organizacion_id, x.rol_id, p_seccion) = 'edicion'
          else private.nivel_de_rol(x.organizacion_id, x.rol_id, p_seccion) <> 'ninguno'
        end
      ),
      false
    )
  end;
$$;

comment on function private.puede_accion(text, text) is
  'true si el usuario actual puede eliminar | exportar | ver_costos | editar_precio | anular | emitir_nota_credito | registrar_cobro | conciliar_pago en la sección, con la misma resolución por empresa que nivel_seccion. Cualquier otra acción → false.';

-- Organizaciones existentes: la siembra es idempotente (`on conflict do nothing`) y no pisa
-- filas editadas. Las organizaciones nuevas la siembran por el trigger.
select private.sembrar_permisos(id) from public.organizaciones;

-- ============================================================================
-- Permiso por empresa (la del pago), no por empresa activa
-- ============================================================================

create or replace function private.puede_conciliar_pago_en_empresa(p_empresa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select private.nivel_ventas_en_empresa(p_empresa_id)) <> 'edicion' then false
    when (select private.is_superadmin())
      and exists (select 1 from public.superadmin_organizacion_activa a where a.user_id = (select auth.uid()))
      then true
    else coalesce(
      (select private.accion_de_rol(
        (select private.organizacion_id()), (select private.rol_en_empresa(p_empresa_id)), 'ventas', 'conciliar_pago')),
      false)
  end;
$$;

revoke execute on function private.puede_conciliar_pago_en_empresa(uuid) from public, anon, authenticated;

comment on function private.puede_conciliar_pago_en_empresa(uuid) is
  'true si el usuario actual puede conciliar pagos en esa empresa (acción conciliar_pago de Ventas y ventas en edición). Solo la llaman las RPC de conciliación.';

-- ============================================================================
-- El único camino que mueve la aprobación (FR-021, FR-022)
-- ============================================================================
-- `p_conciliado` dice a qué estado se lleva el pago: `true` lo aprueba, `false` revierte la
-- aprobación. Las dos RPC públicas son sus envoltorios: las reglas viven acá una sola vez.

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

revoke execute on function private.aplicar_conciliacion(uuid, timestamptz, boolean)
  from public, anon, authenticated;

comment on function private.aplicar_conciliacion(uuid, timestamptz, boolean) is
  'Único camino que mueve la aprobación de un pago (F-VTA-13): solo cobros con cuenta de cobro, permiso por empresa del pago, idempotente, con bloqueo optimista, evento de actividad y sin tocar el estado del comprobante ni el saldo. No la ejecuta authenticated.';

-- ============================================================================
-- public.conciliar_pago (FR-021, FR-022)
-- ============================================================================

create or replace function public.conciliar_pago(
  p_id uuid,
  p_actualizado_en timestamptz
)
returns dominio.cobros_comprobante
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.aplicar_conciliacion(p_id, p_actualizado_en, true);
end;
$$;

revoke execute on function public.conciliar_pago(uuid, timestamptz) from public, anon;
grant execute on function public.conciliar_pago(uuid, timestamptz) to authenticated;

comment on function public.conciliar_pago(uuid, timestamptz) is
  'Concilia un pago contra el extracto del banco (F-VTA-13, FR-021): solo cobros con cuenta de cobro, acción conciliar_pago de Ventas en la empresa del pago, idempotente y con bloqueo optimista. No cambia el estado del comprobante ni el saldo. Contrato en contracts/ventas-cobros-y-conciliacion.md.';

-- ============================================================================
-- public.revertir_conciliacion_pago (FR-021, FR-022)
-- ============================================================================

create or replace function public.revertir_conciliacion_pago(
  p_id uuid,
  p_actualizado_en timestamptz
)
returns dominio.cobros_comprobante
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.aplicar_conciliacion(p_id, p_actualizado_en, false);
end;
$$;

revoke execute on function public.revertir_conciliacion_pago(uuid, timestamptz) from public, anon;
grant execute on function public.revertir_conciliacion_pago(uuid, timestamptz) to authenticated;

comment on function public.revertir_conciliacion_pago(uuid, timestamptz) is
  'Revierte la conciliación de un pago (F-VTA-13, FR-021): solo cobros con cuenta de cobro, acción conciliar_pago de Ventas en la empresa del pago, idempotente y con bloqueo optimista. No cambia el estado del comprobante ni el saldo. Contrato en contracts/ventas-cobros-y-conciliacion.md.';
