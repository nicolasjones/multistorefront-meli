-- F-VTA-14 (MSF-410, épica MSF-195, spec 20261024-150000-ventas-cobros-y-conciliacion, FR-041,
-- FR-042, FR-043, FR-044): `public.marcar_contrarreembolso_cobrado`, la RPC con la que
-- Administración o Administración de la empresa marcan el contrarreembolso como cobrado.
--
-- Esquema (Principio VII), verificado objeto por objeto:
--   public.permisos_rol_accion             public (plataforma)  recibe la acción
--                                                     `cobrar_contrarreembolso` como DATO: es la
--                                                     matriz de permisos por organización × rol ×
--                                                     sección × acción.
--   public.marcar_contrarreembolso_cobrado public (nueva RPC)   el camino público de escritura;
--                                                     escribe `dominio.contrarreembolsos`
--                                                     (`dominio`) y el libro de cobros.
--   public.puede_cobrar_contrarreembolso   public (nueva RPC)   la lectura del permiso para la
--                                                     pantalla (FR-047: el botón «Marcar cobrado»
--                                                     se oculta sin permiso).
--   private.puede_cobrar_contrarreembolso_en_empresa private (nueva) la cuenta interna que resuelve
--                                                     ese permiso por empresa.
--   private.registrar_cobro_interno        private (existente)  deja el cobro en el libro (F-VTA-12).
--   dominio.contrarreembolsos              dominio (existente)  el contrarreembolso (20270114120000).
--   dominio.comprobantes_venta             dominio (existente)  la factura cobrada.
--   dominio.formas_pago                    dominio (existente)  la forma del cobro.
--   dominio.cobros_comprobante             dominio (existente)  el libro de cobros.
-- Sin tablas nuevas: esta migración no crea ni altera columnas de ninguna tabla.
--
-- Permiso (FR-041):
-- · La acción `cobrar_contrarreembolso` de la sección `ventas` se siembra para Administración y
--   Administrador. Los demás roles quedan sin permiso aunque tengan `ventas` en edición
--   (Mostrador, Operador) o solo lectura (Depósito, Consulta, Miembro).
-- · El permiso se resuelve con el rol del usuario en la EMPRESA del contrarreembolso
--   (`private.puede_cobrar_contrarreembolso_en_empresa`), no con la suma de sus roles: quien no
--   puede cobrar en la tienda A no lo hereda por ser Operador en la B (mismo criterio que
--   `private.puede_registrar_cobro_en_empresa`).
-- · Marcar cobrado es escribir: exige `ventas` en edición en esa empresa.
--
-- Reglas de la RPC (FR-042, FR-043, FR-044):
-- · IDEMPOTENTE: si el contrarreembolso ya está Cobrado, se devuelve tal cual. No hay segundo
--   cobro ni segundo evento (un doble clic no cobra dos veces).
-- · Bloqueo optimista: `p_actualizado_en` es la versión que se leyó en pantalla; si el
--   contrarreembolso cambió en el meantime, la RPC responde 40001 y la persona vuelve a leer.
-- · El cobro del comprobante lo registra `private.registrar_cobro_interno` con origen
--   `contrarreembolso` (FR-042): es la única vía a Cobrado/Deuda (FR-004 de F-VTA-12), así que la
--   factura pasa a Cobrado si el saldo llega a 0.
-- · Un comprobante anulado no se cobra (FR-044): el contrarreembolso queda visible y pendiente,
--   pero no cobrable, con un mensaje claro.
-- · El evento `contrarreembolso.cobrado` queda en la misma transacción, con el actor, la tienda y
--   la guía (FR-043).
--
-- MATRIZ DE PERMISOS (coordinación con F-VTA-13): esta historia y F-VTA-13 agregan una acción
-- cada una a la MISMA matriz (`public.permisos_rol_accion`). Para no pisarse sin importar el orden
-- en que se mergeen:
-- · el `check` de la tabla se rearma con las acciones que la matriz de plataforma puede sembrar
--   (`private.matriz_acciones_iniciales`, que ya incluye la acción de F-VTA-13) MÁS la de esta
--   historia, así que no puede fallar por una acción de la otra historia, esté sembrada o no;
-- · esta migración NO reemplaza `private.matriz_acciones_iniciales`: la acción de esta historia se
--   agrega en `private.sembrar_permisos`, la siembra idempotente que usan el trigger de
--   organizaciones nuevas y `public.restablecer_matriz_permisos`. La acción de la otra historia
--   sigue llegando por su propia `matriz_acciones_iniciales`;
-- · `private.puede_accion` reconoce la acción nueva y la de F-VTA-13 (`conciliar_pago`), así
--   ninguna de las dos bandas pierde la acción de la otra. El cierre de la épica (T034)
--   reconcilia la matriz completa.
--
-- Migración aditiva. Reversión (en una migración posterior; no se ejecuta en este PR):
--   drop function public.marcar_contrarreembolso_cobrado(uuid, timestamptz);
--   drop function public.puede_cobrar_contrarreembolso(uuid);
--   drop function private.puede_cobrar_contrarreembolso_en_empresa(uuid);
--   delete from public.permisos_rol_accion where accion = 'cobrar_contrarreembolso';
--   alter table public.permisos_rol_accion drop constraint permisos_rol_accion_accion_check;
--   alter table public.permisos_rol_accion add constraint permisos_rol_accion_accion_check
--     check (accion in ('eliminar', 'exportar', 'ver_costos', 'editar_precio', 'registrar_cobro',
--                        'conciliar_pago'));
--   restaurar private.sembrar_permisos(uuid) de 20261013130002_roles_basicos_permisos.sql y
--   private.puede_accion(text, text) de 20270114100300_registrar_cobro.sql.

-- ============================================================================
-- La acción `cobrar_contrarreembolso` en la matriz de permisos (plataforma)
-- ============================================================================

-- El check se rearma con las acciones que la matriz de plataforma puede sembrar MÁS la de esta
-- historia. No se hardcodea solo la lista de esta historia: F-VTA-13 siembra otra acción en la
-- misma tabla y un `add constraint` que no la contemple fallaría con las filas ya sembradas (la
-- base quedaría a medio aplicar). Y tampoco alcanza con leer las filas ya sembradas: en una base
-- recién migrada la tabla está vacía y el `check` quedaría sin la acción de F-VTA-13, que el
-- trigger de organización nueva sembraría después y no entraría (error 23514). Por eso se agrega
-- también lo que devuelve `private.matriz_acciones_iniciales`, que es la fuente de verdad de las
-- acciones de la matriz.
do $$
declare
  v_acciones text;
begin
  select string_agg(quote_literal(accion), ', ' order by accion)
    into v_acciones
    from (
      select unnest(array['eliminar', 'exportar', 'ver_costos', 'editar_precio',
                         'registrar_cobro', 'cobrar_contrarreembolso']) as accion
      union
      select distinct accion from private.matriz_acciones_iniciales()
      union
      select accion from public.permisos_rol_accion
    ) a;

  alter table public.permisos_rol_accion drop constraint if exists permisos_rol_accion_accion_check;
  execute format(
    'alter table public.permisos_rol_accion add constraint permisos_rol_accion_accion_check check (accion in (%s))',
    v_acciones);
end
$$;

comment on constraint permisos_rol_accion_accion_check on public.permisos_rol_accion is
  'Acciones por rol y sección. registrar_cobro (F-VTA-12), conciliar_pago (F-VTA-13) y cobrar_contrarreembolso (F-VTA-14) viven solo en ventas.';

-- Siembra de la acción (FR-041): Administración y Administrador pueden cobrar contrarreembolsos;
-- los demás roles quedan con la fila en `false` (para que la matriz los muestre y se puedan
-- cambiar a mano), pero no pueden cobrar.
--
-- Se agrega en `private.sembrar_permisos` y NO reemplazando `private.matriz_acciones_iniciales`:
-- las dos historias de la épica (F-VTA-13 y F-VTA-14) suman una acción a la MISMA matriz, y la
-- versión de `matriz_acciones_iniciales` que quede aplicada no conoce la acción de la otra. Así
-- cada acción llega por su propia migración y la siembra sigue siendo idempotente (no pisa las
-- filas editadas a mano). La usan el trigger de organizaciones nuevas y
-- `public.restablecer_matriz_permisos`.
create or replace function private.sembrar_permisos(p_organizacion_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.permisos_rol (organizacion_id, rol_id, seccion, nivel)
  select p_organizacion_id, m.rol_id, m.seccion, m.nivel from private.matriz_inicial() m
  on conflict do nothing;

  insert into public.permisos_rol_accion (organizacion_id, rol_id, seccion, accion, permitido)
  select p_organizacion_id, a.rol_id, a.seccion, a.accion, a.permitido
    from private.matriz_acciones_iniciales() a
  on conflict do nothing;

  -- F-VTA-14 (FR-041): `cobrar_contrarreembolso` es de Ventas y la pueden Administración y
  -- Administrador. Los demás roles de la sección quedan en `false`.
  insert into public.permisos_rol_accion (organizacion_id, rol_id, seccion, accion, permitido)
  select p_organizacion_id, m.rol_id, 'ventas', 'cobrar_contrarreembolso',
         m.rol_id in ('administrador', 'administracion')
    from (select distinct rol_id from private.matriz_inicial()) m
  on conflict do nothing;
$$;

comment on function private.sembrar_permisos(uuid) is
  'Siembra (idempotente) la matriz inicial de una organización: niveles, acciones de la matriz de plataforma y la acción cobrar_contrarreembolso de Ventas (F-VTA-14). No exponer: solo trigger y migraciones.';

revoke execute on function private.sembrar_permisos(uuid) from public, anon, authenticated;

-- `private.puede_accion` reconoce la acción nueva y la de F-VTA-13: las dos historias agregan una
-- acción a la misma matriz y esta versión tiene que dejar reconocidas las dos (si F-VTA-13 se
-- aplicó antes, no se pierde `conciliar_pago`). Marcar cobrado es escribir: exige `edicion`, como
-- eliminar, editar precio, registrar cobro y conciliar.
create or replace function private.puede_accion(p_seccion text, p_accion text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_accion not in ('eliminar', 'exportar', 'ver_costos', 'editar_precio', 'anular',
                          'emitir_nota_credito', 'registrar_cobro',
                          'cobrar_contrarreembolso', 'conciliar_pago') then false
    when (select private.is_superadmin())
      and exists (select 1 from public.superadmin_organizacion_activa a where a.user_id = (select auth.uid()))
      then true
    -- Solo exportar y ver costos se resuelven con lectura; el resto de las acciones escribe y
    -- exige edición. Es el mismo criterio para las acciones de las otras historias de la épica.
    when p_accion not in ('exportar', 'ver_costos')
      and (select private.nivel_seccion(p_seccion)) <> 'edicion' then false
    when (select private.nivel_seccion(p_seccion)) = 'ninguno' then false
    else coalesce(
      (
        select bool_or(private.accion_de_rol(x.organizacion_id, x.rol_id, p_seccion, p_accion))
        from private.roles_de_referencia(p_seccion) x
        where case
          when p_accion not in ('exportar', 'ver_costos')
            then private.nivel_de_rol(x.organizacion_id, x.rol_id, p_seccion) = 'edicion'
          else private.nivel_de_rol(x.organizacion_id, x.rol_id, p_seccion) <> 'ninguno'
        end
      ),
      false
    )
  end;
$$;

comment on function private.puede_accion(text, text) is
  'true si el usuario actual puede eliminar | exportar | ver_costos | editar_precio | anular | emitir_nota_credito | registrar_cobro | cobrar_contrarreembolso | conciliar_pago en la sección, con la misma resolución por empresa que nivel_seccion. Cualquier otra acción → false.';

-- Organizaciones existentes: la siembra es idempotente (`on conflict do nothing`) y no pisa filas
-- editadas a mano.
select private.sembrar_permisos(id) from public.organizaciones;

-- ============================================================================
-- Permiso por empresa (la del contrarreembolso), no por empresa activa
-- ============================================================================

create or replace function private.puede_cobrar_contrarreembolso_en_empresa(p_empresa_id uuid)
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
        (select private.organizacion_id()), (select private.rol_en_empresa(p_empresa_id)), 'ventas',
        'cobrar_contrarreembolso')),
      false)
  end;
$$;

revoke execute on function private.puede_cobrar_contrarreembolso_en_empresa(uuid)
  from public, anon, authenticated;

comment on function private.puede_cobrar_contrarreembolso_en_empresa(uuid) is
  'true si el usuario actual puede cobrar contrarreembolsos en esa empresa (acción cobrar_contrarreembolso de Ventas y ventas en edición). Solo la llaman las RPC de contrarreembolsos.';

-- ============================================================================
-- public.marcar_contrarreembolso_cobrado (FR-042, FR-043, FR-044)
-- ============================================================================

create or replace function public.marcar_contrarreembolso_cobrado(
  p_id uuid,
  p_actualizado_en timestamptz
)
returns dominio.contrarreembolsos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_cr dominio.contrarreembolsos;
  v_c dominio.comprobantes_venta;
  v_forma_pago_id uuid;
  v_cobro_id uuid;
  v_nombre text;
  v_fila dominio.contrarreembolsos;
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para cobrar contrarreembolsos' using errcode = '42501';
  end if;

  -- ── El contrarreembolso, con bloqueo de fila: serializa dos «Marcar cobrado» ──
  select * into v_cr
    from dominio.contrarreembolsos cr
   where cr.id = p_id
     and cr.organizacion_id = v_org
     for update;
  if not found then
    raise exception 'El contrarreembolso no existe' using errcode = 'P0002';
  end if;

  -- ── El permiso es el de la EMPRESA del contrarreembolso (FR-041) ───────────
  if not (select private.puede_cobrar_contrarreembolso_en_empresa(v_cr.empresa_id)) then
    raise exception 'Tu rol no puede cobrar contrarreembolsos en esta tienda' using errcode = '42501';
  end if;

  -- ── Idempotente (FR-042): si ya está Cobrado, se devuelve tal cual ─────────
  -- Un doble clic no cobra dos veces: no hay segundo cobro ni segundo evento.
  if v_cr.estado = 'cobrado' then
    return v_cr;
  end if;

  -- ── Bloqueo optimista (FR-042): la versión leída en pantalla tiene que ser la ──
  if p_actualizado_en is null or v_cr.actualizado_en <> p_actualizado_en then
    raise exception 'El contrarreembolso fue modificado por otra persona' using errcode = '40001';
  end if;

  -- ── El comprobante (FR-044): un comprobante anulado no se cobra ────────────
  select * into v_c
    from dominio.comprobantes_venta c
   where c.id = v_cr.comprobante_id
     and c.organizacion_id = v_org;
  if not found then
    raise exception 'El comprobante no existe' using errcode = 'P0002';
  end if;

  if v_c.estado = 'anulada' then
    raise exception 'La factura está anulada: el contrarreembolso no se puede cobrar' using errcode = '55000';
  end if;

  -- ── La forma del cobro: la de la factura si la tiene; si no, la forma ──────
  -- «Contrarreembolso» de la tienda (es la forma con la que el transporte cobra al entregar).
  v_forma_pago_id := v_c.forma_pago_id;
  if v_forma_pago_id is null then
    select f.id into v_forma_pago_id
      from dominio.formas_pago f
     where f.organizacion_id = v_org
       and f.empresa_id = v_cr.empresa_id
       and f.tipo = 'contrarreembolso'
       and f.activo
     order by f.orden, f.nombre
     limit 1;
  end if;
  if v_forma_pago_id is null then
    raise exception 'La factura no tiene forma de pago y la tienda no tiene una forma «Contrarreembolso»: no se puede registrar el cobro'
      using errcode = '22023';
  end if;

  -- ── Quién cobra (foto del nombre: el historial sobrevive a la baja) ────────
  select coalesce(nullif(btrim(concat_ws(' ', pr.nombre, pr.apellido)), ''), u.email::text)
    into v_nombre
    from auth.users u
    left join public.perfiles_usuario pr on pr.user_id = u.id
   where u.id = v_actor;
  if v_nombre is null then
    raise exception 'El usuario que cobra el contrarreembolso no existe' using errcode = '22023';
  end if;

  -- ── El cobro en el libro, con origen `contrarreembolso` (FR-042) ───────────
  -- `private.registrar_cobro_interno` valida el tope contra el saldo y aplica Cobrado/Deuda
  -- (FR-003 y FR-004 de F-VTA-12): es la única vía, nadie más mueve el estado.
  v_cobro_id := private.registrar_cobro_interno(
    v_cr.comprobante_id, v_cr.importe, v_forma_pago_id, null, 'contrarreembolso', v_actor);

  -- ── El contrarreembolso pasa a Cobrado ────────────────────────────────────
  update dominio.contrarreembolsos
     set estado = 'cobrado',
         cobrado_por = v_actor,
         cobrado_por_nombre = v_nombre,
         cobrado_en = now(),
         cobro_id = v_cobro_id,
         -- now() es constante en la transacción: sin esto dos cambios en la misma transacción
         -- repetirían actualizado_en y no avanzaría el bloqueo.
         actualizado_en = greatest(clock_timestamp(), v_cr.actualizado_en + interval '1 microsecond')
   where id = v_cr.id
  returning * into v_fila;

  -- ── El evento (FR-043): misma transacción, con el actor, la tienda y la guía ─
  perform private.insertar_actividad(
    v_org,
    v_actor,
    'contrarreembolso.cobrado',
    format('Contrarreembolso de %s cobrado (guía %s) en la factura %s',
      v_cr.importe, v_cr.guia, v_c.numero),
    v_cr.empresa_id
  );

  return v_fila;
end;
$$;

revoke execute on function public.marcar_contrarreembolso_cobrado(uuid, timestamptz) from public, anon;
grant execute on function public.marcar_contrarreembolso_cobrado(uuid, timestamptz) to authenticated;

comment on function public.marcar_contrarreembolso_cobrado(uuid, timestamptz) is
  'Marca el contrarreembolso como cobrado (F-VTA-14, FR-042): idempotente, con bloqueo optimista, registra el cobro del comprobante con origen contrarreembolso por private.registrar_cobro_interno y deja el evento contrarreembolso.cobrado. Exige la acción cobrar_contrarreembolso de Ventas en la empresa del contrarreembolso y rechaza comprobantes anulados (FR-044). Contrato en contracts/ventas-cobros-y-conciliacion.md.';

-- ============================================================================
-- La lectura del permiso para la pantalla (FR-047)
-- ============================================================================
-- Devuelve `true` si la persona puede marcar cobrados los contrarreembolsos de esa empresa. La
-- autorización real la hace `public.marcar_contrarreembolso_cobrado`: esta RPC solo evita que la
-- pantalla ofrezca un botón que la base va a rechazar.

create or replace function public.puede_cobrar_contrarreembolso(p_empresa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.puede_cobrar_contrarreembolso_en_empresa(p_empresa_id));
$$;

revoke execute on function public.puede_cobrar_contrarreembolso(uuid) from public, anon;
grant execute on function public.puede_cobrar_contrarreembolso(uuid) to authenticated;

comment on function public.puede_cobrar_contrarreembolso(uuid) is
  'true si la persona actual puede cobrar contrarreembolsos en esa empresa (acción cobrar_contrarreembolso de Ventas y ventas en edición). Solo lectura del permiso propio: la autorización real la hace public.marcar_contrarreembolso_cobrado.';
