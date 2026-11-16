-- F-VTA-24 (épica MSF-145, spec 20261024-130000-ventas-motos, FR-003, FR-005, FR-008, FR-009):
-- RPC de registro, edición y lectura de los envíos en moto, y los permisos por empresa.
--
-- Esquema (Principio VII), verificado objeto por objeto:
--   public.registrar_envio_moto            public (nueva RPC)   alta de un envío (security definer).
--   public.actualizar_envio_moto           public (nueva RPC)   edición con bloqueo optimista.
--   public.comprobantes_para_envio_moto    public (nueva RPC)   facturas elegibles para el selector.
--   public.listar_envios_moto              public (nueva RPC)   listado paginado de la pestaña Motos.
--   private.puede_registrar_envio_moto_en_empresa  private (nueva)  permiso de escritura por empresa.
--   private.puede_rendir_envio_moto_en_empresa     private (nueva)  permiso de rendición por empresa
--                                                  (lo usa el listado; la RPC de rendición llega en
--                                                  20270222300100).
--   dominio.envios_moto                    dominio (existente)  la tabla (20270222200100).
--   dominio.comprobantes_venta             dominio (existente)  la factura: tipo, estado, empresa, forma
--                                                  de envío (`envio_id`), número, fecha, cliente.
--   dominio.formas_envio                   dominio (existente)  `tipo = 'moto'` define la elegibilidad.
--   dominio.empresas / public.clientes     existentes           se leen (nombre de la tienda y del cliente).
--   public.registro_actividad              public (existente)   eventos por `private.registrar_actividad`.
-- Sin tablas nuevas: esta migración no crea ni altera columnas.
--
-- Permisos (FR-008), resueltos con el rol EFECTIVO en la empresa del comprobante (no con la suma de los
-- roles del usuario): quien es Operador en la tienda A no hereda el permiso en la B.
-- · Leer/listar: `ventas` en lectura o edición.
-- · Registrar, editar y marcar «Enviado»: `ventas` en edición en la empresa Y rol efectivo `operador` o
--   `administrador` en ella (o superadmin con organización activa). Sin eso, `42501`.
-- · Rendir (20270222300100): solo `administrador` (o superadmin).
--
-- Reglas de las RPC:
-- · `security definer`, `search_path = ''`, `revoke execute … from public, anon`, `grant … to authenticated`.
--   La organización y el actor salen de la sesión (`private.organizacion_id()`, `auth.uid()`), nunca de un
--   argumento. Como son `security definer` (la RLS no las acota), las lecturas filtran a mano por
--   organización, empresa accesible y nivel de `ventas` en cada empresa.
-- · Un envío es de una FACTURA (no presupuesto) no anulada (hoy `borrador` o `confirmada` y los estados de
--   cobro), con forma de envío (`comprobantes_venta.envio_id`) de tipo `moto` de la misma empresa.
-- · `mensajero` obligatorio, normalizado con `private.normalizar_mensajero`; importes `>= 0` con hasta dos
--   decimales. Nunca se escriben `rendido` ni `rendido_en`.
-- · Errores: `42501` permiso, `22023` dato inválido, `23505` duplicado, `40001` conflicto, `55000` envío
--   rendido (solo lectura), `P0002` no existe.
-- · Eventos `envio_moto.registrado` y `envio_moto.actualizado` en la misma transacción (FR-009).
--
-- Migración aditiva. Reversión (en una migración posterior; no se ejecuta en este PR):
--   drop function if exists public.listar_envios_moto(uuid, integer, integer);
--   drop function if exists public.comprobantes_para_envio_moto(uuid, text);
--   drop function if exists public.actualizar_envio_moto(uuid, text, text, numeric, numeric, boolean, timestamptz);
--   drop function if exists public.registrar_envio_moto(uuid, text, text, numeric, numeric, boolean);
--   drop function if exists private.puede_rendir_envio_moto_en_empresa(uuid);
--   drop function if exists private.puede_registrar_envio_moto_en_empresa(uuid);

-- ============================================================================
-- Permisos por empresa (FR-008)
-- ============================================================================

create or replace function private.puede_registrar_envio_moto_en_empresa(p_empresa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_empresa_id is null then false
    when (select private.nivel_ventas_en_empresa(p_empresa_id)) <> 'edicion' then false
    when (select private.is_superadmin())
      and exists (select 1 from private.superadmin_contexto_vigente a where a.user_id = (select auth.uid()))
      then true
    else coalesce((select private.rol_en_empresa(p_empresa_id)) in ('operador', 'administrador'), false)
  end;
$$;

revoke execute on function private.puede_registrar_envio_moto_en_empresa(uuid)
  from public, anon, authenticated;

comment on function private.puede_registrar_envio_moto_en_empresa(uuid) is
  'true si el usuario actual puede registrar, editar y marcar Enviado un envío en moto en esa empresa: ventas en edición y rol efectivo operador o administrador (o superadmin con organización activa). Solo la llaman las RPC de envíos en moto.';

create or replace function private.puede_rendir_envio_moto_en_empresa(p_empresa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_empresa_id is null then false
    when (select private.nivel_ventas_en_empresa(p_empresa_id)) <> 'edicion' then false
    when (select private.is_superadmin())
      and exists (select 1 from private.superadmin_contexto_vigente a where a.user_id = (select auth.uid()))
      then true
    else coalesce((select private.rol_en_empresa(p_empresa_id)) = 'administrador', false)
  end;
$$;

revoke execute on function private.puede_rendir_envio_moto_en_empresa(uuid)
  from public, anon, authenticated;

comment on function private.puede_rendir_envio_moto_en_empresa(uuid) is
  'true si el usuario actual puede rendir envíos en moto en esa empresa: ventas en edición y rol efectivo administrador (o superadmin con organización activa). Solo la llaman las RPC de envíos en moto.';

-- ============================================================================
-- public.registrar_envio_moto (FR-003, FR-008, FR-009)
-- ============================================================================

create or replace function public.registrar_envio_moto(
  p_comprobante_id uuid,
  p_mensajero text,
  p_guia text default null,
  p_costo_envio numeric default 0,
  p_abono numeric default 0,
  p_enviado boolean default false
)
returns dominio.envios_moto
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_mensajero text := private.normalizar_mensajero(p_mensajero);
  v_guia text := nullif(btrim(coalesce(p_guia, '')), '');
  v_c dominio.comprobantes_venta;
  v_tipo_envio text;
  v_e dominio.envios_moto;
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para registrar envíos en moto' using errcode = '42501';
  end if;

  -- ── Validaciones del pedido (FR-003): la base es la autoridad, el `hint` marca el campo ──
  if p_comprobante_id is null then
    raise exception 'El comprobante es obligatorio' using errcode = '22023', hint = 'comprobante_id';
  end if;
  if v_mensajero = '' then
    raise exception 'El mensajero es obligatorio' using errcode = '22023', hint = 'mensajero';
  end if;
  if length(v_mensajero) > 100 then
    raise exception 'El mensajero no puede tener más de 100 caracteres' using errcode = '22023', hint = 'mensajero';
  end if;
  if v_guia is not null and length(v_guia) > 100 then
    raise exception 'La guía no puede tener más de 100 caracteres' using errcode = '22023', hint = 'guia';
  end if;
  if p_costo_envio is null or p_costo_envio < 0 then
    raise exception 'El costo de envío tiene que ser cero o mayor' using errcode = '22023', hint = 'costo_envio';
  end if;
  if round(p_costo_envio, 2) <> p_costo_envio then
    raise exception 'El costo de envío puede tener hasta dos decimales' using errcode = '22023', hint = 'costo_envio';
  end if;
  if p_costo_envio > 999999999999.99 then
    raise exception 'El costo de envío no puede ser mayor a 999999999999.99' using errcode = '22023', hint = 'costo_envio';
  end if;
  if p_abono is null or p_abono < 0 then
    raise exception 'El importe que abona al recibir tiene que ser cero o mayor' using errcode = '22023', hint = 'abono';
  end if;
  if round(p_abono, 2) <> p_abono then
    raise exception 'El importe que abona al recibir puede tener hasta dos decimales' using errcode = '22023', hint = 'abono';
  end if;
  if p_abono > 999999999999.99 then
    raise exception 'El importe que abona al recibir no puede ser mayor a 999999999999.99' using errcode = '22023', hint = 'abono';
  end if;

  -- ── El comprobante, con bloqueo de fila: serializa dos altas del mismo comprobante ──
  select * into v_c
    from dominio.comprobantes_venta c
   where c.id = p_comprobante_id
     and c.organizacion_id = v_org
     for update;
  if not found then
    raise exception 'El comprobante no existe' using errcode = 'P0002', hint = 'comprobante_id';
  end if;

  if v_c.empresa_id is null then
    raise exception 'El comprobante no tiene tienda: no admite un envío en moto' using errcode = '22023', hint = 'comprobante_id';
  end if;

  -- ── El permiso es el de la EMPRESA del comprobante (FR-008) ────────────────
  if not (select private.puede_registrar_envio_moto_en_empresa(v_c.empresa_id)) then
    raise exception 'Tu rol no puede registrar envíos en moto en esta tienda' using errcode = '42501';
  end if;

  -- ── Elegibilidad (FR-003): factura no anulada con forma de envío «moto» de la misma empresa ──
  if v_c.tipo <> 'factura' then
    raise exception 'Solo las facturas admiten un envío en moto' using errcode = '22023', hint = 'comprobante_id';
  end if;
  if v_c.estado = 'anulada' then
    raise exception 'La factura % está anulada: no admite un envío en moto', v_c.numero
      using errcode = '22023', hint = 'comprobante_id';
  end if;

  select f.tipo into v_tipo_envio
    from dominio.formas_envio f
   where f.id = v_c.envio_id
     and f.organizacion_id = v_c.organizacion_id
     and f.empresa_id = v_c.empresa_id;
  if v_tipo_envio is distinct from 'moto' then
    raise exception 'La forma de envío de la factura % no es «moto»', v_c.numero
      using errcode = '22023', hint = 'comprobante_id';
  end if;

  -- ── Un envío por comprobante ──────────────────────────────────────────────
  if exists (select 1 from dominio.envios_moto e where e.comprobante_id = v_c.id) then
    raise exception 'La factura % ya tiene un envío en moto registrado', v_c.numero
      using errcode = '23505', hint = 'comprobante_id';
  end if;

  -- ── El envío: nunca escribe `rendido` ni `rendido_en` (quedan en sus defaults) ──
  insert into dominio.envios_moto (
    organizacion_id, comprobante_id, mensajero, guia, costo_envio, abono, enviado
  )
  values (
    v_c.organizacion_id, v_c.id, v_mensajero, v_guia, p_costo_envio, p_abono, coalesce(p_enviado, false)
  )
  returning * into v_e;

  -- ── El evento (FR-009): misma transacción, con comprobante, mensajero y datos del envío ──
  perform private.registrar_actividad(
    'envio_moto.registrado',
    left(format('Registró el envío en moto de la factura %s con el mensajero %s (guía %s, costo %s, abona %s, %s)',
      v_c.numero, v_e.mensajero, coalesce(v_e.guia, 'sin guía'), v_e.costo_envio, v_e.abono,
      case when v_e.enviado then 'enviado' else 'por enviar' end), 500),
    v_c.empresa_id
  );

  return v_e;
end;
$$;

revoke execute on function public.registrar_envio_moto(uuid, text, text, numeric, numeric, boolean) from public, anon;
grant execute on function public.registrar_envio_moto(uuid, text, text, numeric, numeric, boolean) to authenticated;

comment on function public.registrar_envio_moto(uuid, text, text, numeric, numeric, boolean) is
  'Registra el envío en moto de una factura (F-VTA-24, FR-003): factura no anulada con forma de envío tipo moto, un envío por comprobante, mensajero obligatorio y normalizado, importes >= 0. Exige ventas en edición y rol operador o administrador en la empresa del comprobante. Nunca escribe rendido ni rendido_en. Deja el evento envio_moto.registrado. Contrato en contracts/ventas-motos.md.';

-- ============================================================================
-- public.actualizar_envio_moto (FR-005, FR-008, FR-009)
-- ============================================================================

create or replace function public.actualizar_envio_moto(
  p_id uuid,
  p_mensajero text,
  p_guia text,
  p_costo_envio numeric,
  p_abono numeric,
  p_enviado boolean,
  p_actualizado_en timestamptz
)
returns dominio.envios_moto
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_mensajero text := private.normalizar_mensajero(p_mensajero);
  v_guia text := nullif(btrim(coalesce(p_guia, '')), '');
  v_ant dominio.envios_moto;
  v_c dominio.comprobantes_venta;
  v_e dominio.envios_moto;
  v_cambios text[] := array[]::text[];
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para editar envíos en moto' using errcode = '42501';
  end if;

  -- ── Validaciones del pedido (FR-005) ──────────────────────────────────────
  if p_id is null then
    raise exception 'El envío es obligatorio' using errcode = '22023';
  end if;
  if v_mensajero = '' then
    raise exception 'El mensajero es obligatorio' using errcode = '22023', hint = 'mensajero';
  end if;
  if length(v_mensajero) > 100 then
    raise exception 'El mensajero no puede tener más de 100 caracteres' using errcode = '22023', hint = 'mensajero';
  end if;
  if v_guia is not null and length(v_guia) > 100 then
    raise exception 'La guía no puede tener más de 100 caracteres' using errcode = '22023', hint = 'guia';
  end if;
  if p_costo_envio is null or p_costo_envio < 0 then
    raise exception 'El costo de envío tiene que ser cero o mayor' using errcode = '22023', hint = 'costo_envio';
  end if;
  if round(p_costo_envio, 2) <> p_costo_envio then
    raise exception 'El costo de envío puede tener hasta dos decimales' using errcode = '22023', hint = 'costo_envio';
  end if;
  if p_costo_envio > 999999999999.99 then
    raise exception 'El costo de envío no puede ser mayor a 999999999999.99' using errcode = '22023', hint = 'costo_envio';
  end if;
  if p_abono is null or p_abono < 0 then
    raise exception 'El importe que abona al recibir tiene que ser cero o mayor' using errcode = '22023', hint = 'abono';
  end if;
  if round(p_abono, 2) <> p_abono then
    raise exception 'El importe que abona al recibir puede tener hasta dos decimales' using errcode = '22023', hint = 'abono';
  end if;
  if p_abono > 999999999999.99 then
    raise exception 'El importe que abona al recibir no puede ser mayor a 999999999999.99' using errcode = '22023', hint = 'abono';
  end if;
  if p_enviado is null then
    raise exception 'Indicá si el envío está enviado' using errcode = '22023', hint = 'enviado';
  end if;

  -- ── El envío, con bloqueo de fila: serializa dos ediciones y la rendición ──
  select * into v_ant
    from dominio.envios_moto e
   where e.id = p_id
     and e.organizacion_id = v_org
     for update;
  if not found then
    raise exception 'El envío no existe' using errcode = 'P0002';
  end if;

  select * into v_c
    from dominio.comprobantes_venta c
   where c.id = v_ant.comprobante_id
     and c.organizacion_id = v_org;

  -- ── El permiso es el de la EMPRESA del comprobante (FR-008) ────────────────
  if not (select private.puede_registrar_envio_moto_en_empresa(v_c.empresa_id)) then
    raise exception 'Tu rol no puede editar envíos en moto en esta tienda' using errcode = '42501';
  end if;

  -- ── Un envío rendido es de solo lectura (FR-005) ──────────────────────────
  if v_ant.rendido then
    raise exception 'El envío ya está rendido: no se puede editar' using errcode = '55000';
  end if;

  -- ── Bloqueo optimista (FR-005): la versión leída en pantalla tiene que ser la vigente ──
  if p_actualizado_en is null or v_ant.updated_at <> p_actualizado_en then
    raise exception 'El envío fue modificado por otra persona' using errcode = '40001';
  end if;

  -- ── Qué cambió (para el evento) ───────────────────────────────────────────
  if v_ant.mensajero is distinct from v_mensajero then
    v_cambios := v_cambios || format('mensajero %s → %s', v_ant.mensajero, v_mensajero);
  end if;
  if v_ant.guia is distinct from v_guia then
    v_cambios := v_cambios || format('guía %s → %s', coalesce(v_ant.guia, 'sin guía'), coalesce(v_guia, 'sin guía'));
  end if;
  if v_ant.costo_envio is distinct from p_costo_envio then
    v_cambios := v_cambios || format('costo %s → %s', v_ant.costo_envio, p_costo_envio);
  end if;
  if v_ant.abono is distinct from p_abono then
    v_cambios := v_cambios || format('abona %s → %s', v_ant.abono, p_abono);
  end if;
  if v_ant.enviado is distinct from p_enviado then
    v_cambios := v_cambios || format('enviado %s → %s',
      case when v_ant.enviado then 'sí' else 'no' end, case when p_enviado then 'sí' else 'no' end);
  end if;

  -- ── La edición: no toca `rendido` ni `rendido_en` ─────────────────────────
  update dominio.envios_moto e
     set mensajero = v_mensajero,
         guia = v_guia,
         costo_envio = p_costo_envio,
         abono = p_abono,
         enviado = p_enviado,
         -- now() es constante en la transacción: sin esto dos cambios en la misma transacción
         -- repetirían updated_at y no avanzaría el bloqueo.
         updated_at = greatest(clock_timestamp(), v_ant.updated_at + interval '1 microsecond')
   where e.id = v_ant.id
  returning * into v_e;

  -- ── El evento (FR-009): misma transacción, con actor, comprobante, mensajero y cambios ──
  perform private.registrar_actividad(
    'envio_moto.actualizado',
    left(format('Editó el envío en moto de la factura %s (mensajero %s): %s',
      v_c.numero, v_e.mensajero,
      case when cardinality(v_cambios) = 0 then 'sin cambios' else array_to_string(v_cambios, '; ') end), 500),
    v_c.empresa_id
  );

  return v_e;
end;
$$;

revoke execute on function public.actualizar_envio_moto(uuid, text, text, numeric, numeric, boolean, timestamptz) from public, anon;
grant execute on function public.actualizar_envio_moto(uuid, text, text, numeric, numeric, boolean, timestamptz) to authenticated;

comment on function public.actualizar_envio_moto(uuid, text, text, numeric, numeric, boolean, timestamptz) is
  'Edita mensajero, guía, costo, abono y Enviado de un envío en moto (F-VTA-24, FR-005): bloqueo optimista por updated_at (40001), rechaza un envío rendido (55000) y nunca escribe rendido ni rendido_en. Exige ventas en edición y rol operador o administrador en la empresa del comprobante. Deja el evento envio_moto.actualizado.';

-- ============================================================================
-- public.comprobantes_para_envio_moto (FR-003): el selector del diálogo
-- ============================================================================

create or replace function public.comprobantes_para_envio_moto(
  p_empresa_id uuid default null,
  p_busqueda text default null
)
returns table (
  id uuid,
  numero text,
  empresa_id uuid,
  empresa text,
  fecha date,
  cliente text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_busqueda text := nullif(btrim(coalesce(p_busqueda, '')), '');
begin
  if v_org is null or (select private.nivel_seccion('ventas')) not in ('lectura', 'edicion') then
    raise exception 'Necesitás acceso a Ventas para ver los comprobantes' using errcode = '42501';
  end if;

  if v_busqueda is not null then
    v_busqueda := left(v_busqueda, 100);
    -- Se busca el texto literal: se escapan los comodines de `like`.
    v_busqueda := '%' || replace(replace(replace(v_busqueda, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return query
  select c.id,
         c.numero,
         c.empresa_id,
         em.nombre,
         c.fecha,
         cl.nombre
    from dominio.comprobantes_venta c
    join dominio.empresas em on em.id = c.empresa_id and em.organizacion_id = c.organizacion_id
    join dominio.formas_envio fe
      on fe.id = c.envio_id
     and fe.organizacion_id = c.organizacion_id
     and fe.empresa_id = c.empresa_id
     and fe.tipo = 'moto'
    left join public.clientes cl on cl.id = c.cliente_id and cl.organizacion_id = c.organizacion_id
   where c.organizacion_id = v_org
     and c.tipo = 'factura'
     and c.estado <> 'anulada'
     and c.empresa_id in (select private.empresas_accesibles())
     and (p_empresa_id is null or c.empresa_id = p_empresa_id)
     and not exists (select 1 from dominio.envios_moto x where x.comprobante_id = c.id)
     -- Solo las empresas donde la persona puede registrar (el diálogo no ofrece lo que la base rechaza).
     and (select private.puede_registrar_envio_moto_en_empresa(c.empresa_id))
     and (v_busqueda is null or c.numero ilike v_busqueda or cl.nombre ilike v_busqueda)
   order by c.fecha desc, c.numero desc, c.id
   limit 50;
end;
$$;

revoke execute on function public.comprobantes_para_envio_moto(uuid, text) from public, anon;
grant execute on function public.comprobantes_para_envio_moto(uuid, text) to authenticated;

comment on function public.comprobantes_para_envio_moto(uuid, text) is
  'Facturas elegibles para registrar un envío en moto (F-VTA-24, FR-003): no anuladas, con forma de envío tipo moto de su misma empresa, sin envío registrado y de empresas donde la persona puede registrar. Búsqueda por número o cliente, hasta 50 filas.';

-- ============================================================================
-- public.listar_envios_moto (FR-006, FR-007)
-- ============================================================================

create or replace function public.listar_envios_moto(
  p_empresa_id uuid default null,
  p_pagina integer default 1,
  p_tamano integer default 25
)
returns table (
  id uuid,
  comprobante_id uuid,
  comprobante_numero text,
  empresa_id uuid,
  empresa text,
  fecha date,
  cliente text,
  mensajero text,
  guia text,
  costo_envio numeric,
  abono numeric,
  enviado boolean,
  rendido boolean,
  rendido_en timestamptz,
  actualizado_en timestamptz,
  puede_editar boolean,
  puede_rendir boolean,
  filas bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_tamano integer := least(greatest(coalesce(p_tamano, 25), 1), 100);
  v_pagina integer := least(greatest(coalesce(p_pagina, 1), 1), 100000);
begin
  if v_org is null or (select private.nivel_seccion('ventas')) not in ('lectura', 'edicion') then
    raise exception 'Necesitás acceso a Ventas para ver los envíos en moto' using errcode = '42501';
  end if;

  return query
  select e.id,
         e.comprobante_id,
         c.numero,
         c.empresa_id,
         em.nombre,
         c.fecha,
         cl.nombre,
         e.mensajero,
         e.guia,
         e.costo_envio,
         e.abono,
         e.enviado,
         e.rendido,
         e.rendido_en,
         e.updated_at,
         -- Un envío rendido es de solo lectura: no se ofrece «Editar».
         (not e.rendido and (select private.puede_registrar_envio_moto_en_empresa(c.empresa_id))),
         -- Solo se rinde lo enviado y no rendido, y solo el Administrador.
         (e.enviado and not e.rendido and (select private.puede_rendir_envio_moto_en_empresa(c.empresa_id))),
         count(*) over () as filas
    from dominio.envios_moto e
    join dominio.comprobantes_venta c on c.id = e.comprobante_id and c.organizacion_id = e.organizacion_id
    join dominio.empresas em on em.id = c.empresa_id and em.organizacion_id = c.organizacion_id
    -- `left join`: un cliente que no se pueda leer no hace perder la fila del envío.
    left join public.clientes cl on cl.id = c.cliente_id and cl.organizacion_id = c.organizacion_id
   where e.organizacion_id = v_org
     and c.empresa_id in (select private.empresas_accesibles())
     and (select private.nivel_ventas_en_empresa(c.empresa_id)) in ('lectura', 'edicion')
     and (p_empresa_id is null or c.empresa_id = p_empresa_id)
   order by c.fecha desc, e.created_at desc, e.id
   limit v_tamano
  offset (v_pagina - 1) * v_tamano;
end;
$$;

revoke execute on function public.listar_envios_moto(uuid, integer, integer) from public, anon;
grant execute on function public.listar_envios_moto(uuid, integer, integer) to authenticated;

comment on function public.listar_envios_moto(uuid, integer, integer) is
  'Envíos en moto de la organización (F-VTA-24, FR-006): más reciente primero, de las empresas accesibles y, si viene, de p_empresa_id. Trae puede_editar (no rendido y con permiso de registrar) y puede_rendir (enviado, no rendido y Administrador), y el total de filas para la paginación en servidor.';
