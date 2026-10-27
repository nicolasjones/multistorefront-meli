-- F-VTA-12 (MSF-389, épica MSF-195, spec 20261024-150000-ventas-cobros-y-conciliacion, FR-002):
-- `public.registrar_cobro`: la RPC con la que una persona registra un cobro parcial o total
-- sobre una factura, con su forma de pago y su cuenta de cobro.
--
-- Esquema (Principio VII), verificado objeto por objeto:
--   public.permisos_rol_accion   public (plataforma)  recibe la acción `registrar_cobro` como
--                                                 DATO: es la matriz de permisos por
--                                                 organización × rol × sección × acción.
--   public.registrar_cobro        public (nueva RPC)   el camino público de escritura; escribe
--                                                 `dominio.cobros_comprobante` (`dominio`).
--   private.*                     private (internas)  `puede_registrar_cobro_en_empresa` (permiso
--                                                 por empresa) y las funciones de plataforma
--                                                 que se recrean abajo.
--   dominio.cobros_comprobante    dominio (existente)  el libro de cobros (migración 20261215100000).
--   dominio.comprobantes_venta    dominio (existente)  la factura cobrada.
--   dominio.formas_pago           dominio (existente)  la forma de pago elegida.
--   dominio.cuentas_cobro         dominio (existente)  la cuenta de cobro del pago.
-- Sin tablas nuevas: esta migración no crea ni altera columnas de ninguna tabla.
--
-- Permiso (FR-002):
-- · La acción `registrar_cobro` de la sección `ventas` se siembra para Mostrador, Administración
--   y Administrador. Los demás roles quedan sin permiso aunque tengan `ventas` en edición
--   (Operador) o solo lectura (Depósito, Consulta, Miembro).
-- · El permiso se resuelve con el rol del usuario en la EMPRESA del comprobante
--   (`private.puede_registrar_cobro_en_empresa`), no con la suma de sus roles: quien no puede
--   cobrar en la tienda A no lo hereda por ser Operador en la B (mismo criterio que
--   `private.puede_editar_precio_en_empresa`).
-- · Registrar un cobro es escribir: exige `ventas` en edición en esa empresa.
--
-- Reglas de la RPC (FR-002):
-- · Solo facturas confirmadas no anuladas: un borrador, un presupuesto o una nota de crédito no
--   admiten cobros.
-- · La forma de pago es de la misma empresa y está activa.
-- · La cuenta de cobro la exige la forma de pago cuando así está configurada, y tiene que estar
--   activa («No usar» la rechaza) y habilitada para la empresa del comprobante.
-- · El importe, el tope contra el saldo y el paso a Cobrado/Deuda los aplica
--   `private.registrar_cobro_interno` (FR-003, FR-004): esta RPC no duplica esas reglas.
-- · El importe además no puede ser mayor al máximo de la columna (numeric(14,2)): si lo fuera,
--   la base tiraría un error técnico (22003) que la pantalla no sabe explicar.
-- · Cada error de validación lleva `hint` con el nombre del campo: es lo que permite que la
--   pantalla marque el campo (importe, forma de pago o cuenta de cobro) y no un error general.
--   El tope también lo lleva (`P0001` con `hint = 'importe'`): la pantalla marca el importe.
--
-- `p_actualizado_en` viene en el contrato (`contracts/ventas-cobros-y-conciliacion.md`) pero el
-- cobro NO usa bloqueo optimista: el saldo se recalcula con bloqueo de fila sobre el comprobante
-- (FR-003), así que dos cobros simultáneos se serializan solos. Se acepta el parámetro para no
-- romper el contrato y no se compara.
--
-- Migración aditiva. Reversión (en una migración posterior; no se ejecuta en este PR):
--   drop function public.registrar_cobro(uuid, numeric, uuid, uuid, timestamptz);
--   drop function private.puede_registrar_cobro_en_empresa(uuid);
--   delete from public.permisos_rol_accion where accion = 'registrar_cobro';
--   alter table public.permisos_rol_accion drop constraint permisos_rol_accion_accion_check;
--   alter table public.permisos_rol_accion add constraint permisos_rol_accion_accion_check
--     check (accion in ('eliminar', 'exportar', 'ver_costos', 'editar_precio'));
--   restaurar private.matriz_acciones_iniciales() y private.puede_accion(text, text) de
--   20261203200200_accion_editar_precio.sql.

-- ============================================================================
-- La acción `registrar_cobro` en la matriz de permisos (plataforma)
-- ============================================================================

alter table public.permisos_rol_accion drop constraint if exists permisos_rol_accion_accion_check;
alter table public.permisos_rol_accion
  add constraint permisos_rol_accion_accion_check
  check (accion in ('eliminar', 'exportar', 'ver_costos', 'editar_precio', 'anular', 'emitir_nota_credito', 'registrar_cobro'));

comment on constraint permisos_rol_accion_accion_check on public.permisos_rol_accion is
  'Acciones por rol y sección. anular y emitir_nota_credito (F-VTA-11) y registrar_cobro (F-VTA-12) viven solo en ventas.';

-- Valores iniciales de la acción (FR-002): Mostrador, Administración y Administrador pueden
-- registrar cobros; los demás roles, no. `editar_precio` y `registrar_cobro` son de Ventas.
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
      else m.rol_id in ('administrador', 'administracion')
    end
  from private.matriz_inicial() m
  cross join (values ('eliminar'), ('exportar'), ('ver_costos'), ('editar_precio'), ('anular'), ('emitir_nota_credito'), ('registrar_cobro')) as a(accion)
  where a.accion not in ('editar_precio', 'anular', 'emitir_nota_credito', 'registrar_cobro') or m.seccion = 'ventas';
$$;

comment on function private.matriz_acciones_iniciales() is
  'Valores iniciales PROPUESTOS de permisos por acción (FR-006); pendientes de confirmar con el cliente. editar_precio (F-VTA-06), anular y emitir_nota_credito (F-VTA-11) y registrar_cobro (F-VTA-12) solo en ventas: Administrador y Operador; Administrador y Administración; y Mostrador, Administración y Administrador.';

-- `private.puede_accion` reconoce la acción nueva. Registrar un cobro es escribir: exige
-- `edicion`, como eliminar y editar precio (quien solo lee nunca cobra).
create or replace function private.puede_accion(p_seccion text, p_accion text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_accion not in ('eliminar', 'exportar', 'ver_costos', 'editar_precio', 'anular', 'emitir_nota_credito', 'registrar_cobro') then false
    when (select private.is_superadmin())
      and exists (select 1 from public.superadmin_organizacion_activa a where a.user_id = (select auth.uid()))
      then true
    -- eliminar, editar_precio, anular, emitir_nota_credito y registrar_cobro exigen edición; exportar y ver costos exigen al menos lectura.
    when p_accion in ('eliminar', 'editar_precio', 'anular', 'emitir_nota_credito', 'registrar_cobro') and (select private.nivel_seccion(p_seccion)) <> 'edicion' then false
    when (select private.nivel_seccion(p_seccion)) = 'ninguno' then false
    else coalesce(
      (
        select bool_or(private.accion_de_rol(x.organizacion_id, x.rol_id, p_seccion, p_accion))
        from private.roles_de_referencia(p_seccion) x
        where case
          when p_accion in ('eliminar', 'editar_precio', 'anular', 'emitir_nota_credito', 'registrar_cobro') then private.nivel_de_rol(x.organizacion_id, x.rol_id, p_seccion) = 'edicion'
          else private.nivel_de_rol(x.organizacion_id, x.rol_id, p_seccion) <> 'ninguno'
        end
      ),
      false
    )
  end;
$$;

comment on function private.puede_accion(text, text) is
  'true si el usuario actual puede eliminar | exportar | ver_costos | editar_precio | anular | emitir_nota_credito | registrar_cobro en la sección, con la misma resolución por empresa que nivel_seccion. Cualquier otra acción → false.';

-- Organizaciones existentes: la siembra es idempotente (`on conflict do nothing`) y no pisa filas editadas.
select private.sembrar_permisos(id) from public.organizaciones;

-- ============================================================================
-- Permiso por empresa (la del comprobante), no por empresa activa
-- ============================================================================

create or replace function private.puede_registrar_cobro_en_empresa(p_empresa_id uuid)
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
        (select private.organizacion_id()), (select private.rol_en_empresa(p_empresa_id)), 'ventas', 'registrar_cobro')),
      false)
  end;
$$;

revoke execute on function private.puede_registrar_cobro_en_empresa(uuid) from public, anon, authenticated;

comment on function private.puede_registrar_cobro_en_empresa(uuid) is
  'true si el usuario actual puede registrar cobros en esa empresa (acción registrar_cobro de Ventas y ventas en edición). Solo la llama la RPC de cobros.';

-- ============================================================================
-- public.registrar_cobro (FR-002)
-- ============================================================================

create or replace function public.registrar_cobro(
  p_comprobante_id uuid,
  p_importe numeric,
  p_forma_pago_id uuid,
  p_cuenta_cobro_id uuid default null,
  p_actualizado_en timestamptz default null
)
returns dominio.cobros_comprobante
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_c dominio.comprobantes_venta;
  v_forma dominio.formas_pago;
  v_cuenta record;
  v_cobro_id uuid;
  v_cobro dominio.cobros_comprobante;
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para registrar cobros' using errcode = '42501';
  end if;

  -- ── El importe (FR-003): la base es la autoridad, el `hint` marca el campo ──
  if p_importe is null then
    raise exception 'El importe es obligatorio' using errcode = '22023', hint = 'importe';
  end if;
  if p_importe <= 0 then
    raise exception 'El importe tiene que ser mayor a cero' using errcode = '22023', hint = 'importe';
  end if;
  if round(p_importe, 2) <> p_importe then
    raise exception 'El importe puede tener hasta dos decimales' using errcode = '22023', hint = 'importe';
  end if;
  -- El libro guarda el importe en numeric(14,2): un importe mayor no tiene dónde guardarse y la
  -- base tiraría un error técnico (22003) que la pantalla no sabe explicar. Se rechaza acá, con
  -- el mensaje y el `hint` del campo.
  if p_importe > 999999999999.99 then
    raise exception 'El importe no puede ser mayor a 999999999999.99' using errcode = '22023', hint = 'importe';
  end if;

  if p_forma_pago_id is null then
    raise exception 'La forma de pago es obligatoria' using errcode = '22023', hint = 'forma_pago_id';
  end if;

  -- ── El comprobante, con bloqueo de fila: serializa los cobros simultáneos (FR-003) ──
  select * into v_c
    from dominio.comprobantes_venta c
   where c.id = p_comprobante_id and c.organizacion_id = v_org
     for update;
  if not found then
    raise exception 'El comprobante no existe' using errcode = 'P0002';
  end if;

  -- ── El permiso es el de la empresa del comprobante (FR-002) ─────────────────
  if not (select private.puede_registrar_cobro_en_empresa(v_c.empresa_id)) then
    raise exception 'Tu rol no puede registrar cobros en esta tienda' using errcode = '42501';
  end if;

  -- ── Solo las facturas confirmadas admiten cobros (FR-002) ──────────────────
  if v_c.tipo <> 'factura' then
    raise exception 'Solo las facturas admiten cobros' using errcode = '22023';
  end if;
  if v_c.estado = 'borrador' then
    raise exception 'La factura está en borrador: confirmala antes de registrar cobros' using errcode = '55000';
  end if;
  if v_c.estado = 'anulada' then
    raise exception 'La factura está anulada: no admite cobros' using errcode = '55000';
  end if;

  -- ── La forma de pago: de la misma empresa y activa ────────────────────────
  select * into v_forma
    from dominio.formas_pago f
   where f.id = p_forma_pago_id
     and f.organizacion_id = v_org
     and f.empresa_id = v_c.empresa_id;
  if not found then
    raise exception 'La forma de pago no es de la empresa de la factura' using errcode = '22023', hint = 'forma_pago_id';
  end if;
  if not v_forma.activo then
    raise exception 'La forma de pago % está desactivada', v_forma.nombre using errcode = '22023', hint = 'forma_pago_id';
  end if;

  -- ── La cuenta de cobro: la exige la forma y tiene que estar activa y habilitada (FR-002) ──
  if v_forma.exige_cuenta_cobro and p_cuenta_cobro_id is null then
    raise exception 'La forma de pago % exige una cuenta de cobro', v_forma.nombre using errcode = '22023', hint = 'cuenta_cobro_id';
  end if;
  if p_cuenta_cobro_id is not null then
    select c.* into v_cuenta
      from dominio.cuentas_cobro c
     where c.id = p_cuenta_cobro_id and c.organizacion_id = v_org;
    if not found then
      raise exception 'La cuenta de cobro no existe o no es de tu organización' using errcode = '22023', hint = 'cuenta_cobro_id';
    end if;
    if not v_cuenta.activa then
      raise exception 'La cuenta de cobro % está marcada «No usar»', v_cuenta.nombre using errcode = '22023', hint = 'cuenta_cobro_id';
    end if;
    if not exists (
      select 1 from dominio.cuentas_cobro_empresas ce
       where ce.cuenta_id = p_cuenta_cobro_id
         and ce.empresa_id = v_c.empresa_id
         and ce.organizacion_id = v_org
    ) then
      raise exception 'La cuenta de cobro % no está habilitada en esta tienda', v_cuenta.nombre using errcode = '22023', hint = 'cuenta_cobro_id';
    end if;
  end if;

  -- ── El cobro: lo registra la función interna (FR-003, FR-004, FR-006) ────
  begin
    v_cobro_id := private.registrar_cobro_interno(
      v_c.id, p_importe, v_forma.id, p_cuenta_cobro_id, 'manual', v_actor);
  exception when sqlstate 'P0001' then
    -- El tope (el importe supera el saldo): el mensaje nombra el importe y el saldo (FR-003).
    raise exception '%', sqlerrm using errcode = 'P0001', hint = 'importe';
  end;

  select * into v_cobro from dominio.cobros_comprobante where id = v_cobro_id;
  return v_cobro;
end;
$$;

revoke execute on function public.registrar_cobro(uuid, numeric, uuid, uuid, timestamptz) from public, anon;
grant execute on function public.registrar_cobro(uuid, numeric, uuid, uuid, timestamptz) to authenticated;

comment on function public.registrar_cobro(uuid, numeric, uuid, uuid, timestamptz) is
  'Registra un cobro parcial o total sobre una factura (F-VTA-12, FR-002): solo factura confirmada no anulada, acción registrar_cobro de Ventas en la empresa del comprobante, forma de pago de la misma empresa y cuenta de cobro activa y habilitada cuando la forma la exige. Devuelve el cobro registrado. Contrato en contracts/ventas-cobros-y-conciliacion.md.';
