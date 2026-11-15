-- MSF-145 (Ventas motos), decisiones de Nicolás del 2026-11-12 (4 y 5): una factura anulada DESPUÉS de cargar su envío
-- lo bloquea, y solo las facturas emitidas son elegibles (no el borrador).
--
-- Esquema (Principio VII), verificado objeto por objeto:
--   public.registrar_envio_moto          public (RPC existente, se reemplaza)  rechaza el borrador.
--   public.actualizar_envio_moto         public (RPC existente, se reemplaza)  rechaza editar si la factura se anuló (55000).
--   public.comprobantes_para_envio_moto  public (RPC existente, se reemplaza)  el selector deja de ofrecer borradores.
--   public.listar_envios_moto            public (RPC existente, se recrea)     suma `bloqueado_motivo`; `puede_editar` y
--                                                        `puede_rendir` son falsos si la factura está anulada. Cambia el tipo de
--                                                        retorno: por eso `drop function` + `create` (misma firma de argumentos).
--   public.resumen_motos_sin_rendir      public (RPC existente, se reemplaza)  no cuenta envíos de facturas anuladas.
--   dominio.envios_moto / comprobantes_venta   dominio (existentes)             se leen; sin tablas ni columnas nuevas.
-- La rendición (`rendir_envios_moto`) rechaza los envíos de facturas anuladas en la migración siguiente (20270228110100).
--
-- Revisión de seguridad del 2026-11-12: `registrar_envio_moto` y `actualizar_envio_moto` comprueban el permiso ANTES de
-- tomar cualquier lock (lectura sin bloqueo → permiso → `for update`) y devuelven el mismo `42501` si la fila no existe, es de
-- otra organización o de una tienda donde la persona no puede registrar (ya no `P0002`: no se filtra la existencia).
--
-- Reglas:
-- · Elegibilidad (decisión 5): `tipo = 'factura'`, estado distinto de `borrador` y `anulada` (confirmada y los estados de
--   cobro), forma de envío tipo moto de la misma empresa. Registrar sobre un borrador falla con `22023` y mensaje en castellano.
-- · Factura anulada después (decisión 4): editar el envío falla con `55000` («La factura X fue anulada: el envío en moto ya no
--   se puede editar»); el listado devuelve `puede_editar = false`, `puede_rendir = false` y el motivo. Un envío ya rendido
--   no se toca (sigue siendo de solo lectura y no muestra motivo). El envío no se borra ni se modifica: queda como registro.
-- · Los envíos ya cargados sobre un borrador siguen existiendo y editables; confirmar la factura los deja rendibles.
-- · Mismos permisos, `security definer`, `search_path = ''`, `revoke ... from public, anon` y `grant ... to authenticated`
--   que las versiones anteriores (20270222200200, 20270222300100).
--
-- Migración sin pérdida de datos. Reversión (en una migración posterior; no se ejecuta en este PR): volver a crear las cinco
-- funciones con la definición de 20270222200200 (registrar, actualizar, elegibles, listado) y 20270222300100 (resumen),
-- previo `drop function public.listar_envios_moto(uuid, integer, integer)`.

-- ============================================================================
-- public.registrar_envio_moto (FR-003, FR-008, FR-009) con la decisión 5
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

  -- ── El comprobante: primero se lee sin bloquear y se comprueba el permiso (ver abajo) ──
  select * into v_c
    from dominio.comprobantes_venta c
   where c.id = p_comprobante_id
     and c.organizacion_id = v_org;

  -- ── El permiso ANTES de cualquier bloqueo y sin revelar la existencia (revisión de seguridad del 2026-11-12) ──
  -- Un comprobante que no existe, de otra organización o de una tienda donde la persona no puede registrar da el MISMO
  -- `42501`: así no se sabe si existe, y quien no puede escribir ahí no toma ningún lock sobre la factura.
  if not found or not (select private.puede_registrar_envio_moto_en_empresa(v_c.empresa_id)) then
    raise exception 'Tu rol no puede registrar envíos en moto en esta tienda' using errcode = '42501';
  end if;

  -- Con permiso, recién ahora se bloquea la fila: serializa dos altas del mismo comprobante.
  select * into v_c
    from dominio.comprobantes_venta c
   where c.id = p_comprobante_id
     and c.organizacion_id = v_org
     for update;

  -- ── Elegibilidad (FR-003): factura emitida (ni borrador ni anulada) con forma de envío «moto» de la misma empresa ──
  if v_c.tipo <> 'factura' then
    raise exception 'Solo las facturas admiten un envío en moto' using errcode = '22023', hint = 'comprobante_id';
  end if;
  if v_c.estado = 'anulada' then
    raise exception 'La factura % está anulada: no admite un envío en moto', v_c.numero
      using errcode = '22023', hint = 'comprobante_id';
  end if;
  -- Decisión de Nicolás (2026-11-12): solo facturas emitidas. Un borrador todavía puede cambiar o descartarse.
  if v_c.estado = 'borrador' then
    raise exception 'La factura % está en borrador: confirmala antes de registrar un envío en moto', v_c.numero
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
  'Registra el envío en moto de una factura (F-VTA-24, FR-003): factura emitida (ni borrador ni anulada) con forma de envío tipo moto, un envío por comprobante, mensajero obligatorio y normalizado, importes >= 0. Exige ventas en edición y rol operador o administrador en la empresa del comprobante. Nunca escribe rendido ni rendido_en. Deja el evento envio_moto.registrado. Contrato en contracts/ventas-motos.md.';

-- ============================================================================
-- public.actualizar_envio_moto (FR-005) con la decisión 4
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

  -- ── El envío: primero se lee sin bloquear y se comprueba el permiso (ver abajo) ──
  select * into v_ant
    from dominio.envios_moto e
   where e.id = p_id
     and e.organizacion_id = v_org;
  if found then
    select * into v_c
      from dominio.comprobantes_venta c
     where c.id = v_ant.comprobante_id
       and c.organizacion_id = v_org;
  end if;

  -- ── El permiso es el de la EMPRESA del comprobante (FR-008), ANTES de cualquier bloqueo ──
  -- Un envío que no existe, de otra organización o de una tienda sin permiso da el MISMO `42501` (no revela existencia).
  if not found or not (select private.puede_registrar_envio_moto_en_empresa(v_c.empresa_id)) then
    raise exception 'Tu rol no puede editar envíos en moto en esta tienda' using errcode = '42501';
  end if;

  -- Con permiso se bloquea la fila: serializa dos ediciones y la rendición.
  select * into v_ant
    from dominio.envios_moto e
   where e.id = p_id
     and e.organizacion_id = v_org
     for update;
  select * into v_c
    from dominio.comprobantes_venta c
   where c.id = v_ant.comprobante_id
     and c.organizacion_id = v_org;

  -- ── Un envío rendido es de solo lectura (FR-005) ──────────────────────────
  if v_ant.rendido then
    raise exception 'El envío ya está rendido: no se puede editar' using errcode = '55000';
  end if;

  -- ── Una factura anulada después de cargar el envío lo bloquea (decisión de Nicolás, 2026-11-12) ──
  if v_c.estado = 'anulada' then
    raise exception 'La factura % fue anulada: el envío en moto ya no se puede editar', v_c.numero
      using errcode = '55000';
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
  'Edita mensajero, guía, costo, abono y Enviado de un envío en moto (F-VTA-24, FR-005): bloqueo optimista por updated_at (40001), rechaza un envío rendido o de una factura anulada (55000) y nunca escribe rendido ni rendido_en. Exige ventas en edición y rol operador o administrador en la empresa del comprobante. Deja el evento envio_moto.actualizado.';

-- ============================================================================
-- public.comprobantes_para_envio_moto (FR-003) con la decisión 5
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
     -- Solo facturas emitidas: ni borrador (puede cambiar o descartarse) ni anulada (decisión del 2026-11-12).
     and c.estado not in ('borrador', 'anulada')
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
  'Facturas elegibles para registrar un envío en moto (F-VTA-24, FR-003): emitidas (ni borrador ni anuladas), con forma de envío tipo moto de su misma empresa, sin envío registrado y de empresas donde la persona puede registrar. Búsqueda por número o cliente, hasta 50 filas.';

-- ============================================================================
-- public.listar_envios_moto (FR-006, FR-007) con la decisión 4
-- ============================================================================

drop function if exists public.listar_envios_moto(uuid, integer, integer);

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
  bloqueado_motivo text,
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
         -- Un envío rendido o de una factura anulada es de solo lectura: no se ofrece «Editar».
         (not e.rendido and c.estado <> 'anulada' and (select private.puede_registrar_envio_moto_en_empresa(c.empresa_id))),
         -- Solo se rinde lo enviado y no rendido (de una factura no anulada), y solo el Administrador.
         (e.enviado and not e.rendido and c.estado <> 'anulada'
           and not (c.estado = 'borrador' and e.abono > 0)
           and (select private.puede_rendir_envio_moto_en_empresa(c.empresa_id))),
         -- El motivo del bloqueo, para que la pantalla lo muestre en castellano.
         case when c.estado = 'anulada' and not e.rendido
              then format('La factura %s fue anulada: el envío no se puede editar ni rendir.', c.numero)
              -- Un borrador con abono no se puede rendir (rendir cobra): se avisa; con abono 0 sigue rendible.
              when c.estado = 'borrador' and e.abono > 0 and not e.rendido
              then 'Confirmá la factura antes de rendir' end,
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
  'Envíos en moto de la organización (F-VTA-24, FR-006): más reciente primero, de las empresas accesibles y, si viene, de p_empresa_id. Trae puede_editar (no rendido, factura no anulada y con permiso de registrar), puede_rendir (enviado, no rendido, factura no anulada, sin borrador con abono y Administrador), bloqueado_motivo (factura anulada, o borrador con abono: «Confirmá la factura antes de rendir») y el total de filas para la paginación en servidor.';

-- ============================================================================
-- public.resumen_motos_sin_rendir (FR-023) con la decisión 4
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
     -- Un envío de una factura anulada no se puede rendir: no cuenta como pendiente (decisión del 2026-11-12).
     and c.estado <> 'anulada'
     and c.empresa_id in (select private.empresas_accesibles())
     and (select private.nivel_ventas_en_empresa(c.empresa_id)) in ('lectura', 'edicion')
     and (p_empresa_id is null or c.empresa_id = p_empresa_id);
end;
$$;

revoke execute on function public.resumen_motos_sin_rendir(uuid) from public, anon;
grant execute on function public.resumen_motos_sin_rendir(uuid) to authenticated;

comment on function public.resumen_motos_sin_rendir(uuid) is
  'Tarjeta «Motos sin rendir» (F-VTA-25, FR-023): suma del abono y cantidad de los envíos en moto sin rendir, de facturas no anuladas, con abono mayor a 0, sobre las empresas accesibles y el filtro opcional de tienda.';

