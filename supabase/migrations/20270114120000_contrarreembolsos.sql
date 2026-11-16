-- F-VTA-14 (MSF-410, épica MSF-195, spec 20261024-150000-ventas-cobros-y-conciliacion, FR-040):
-- tabla de contrarreembolsos por transporte y `private.abrir_contrarreembolso`, el punto de
-- entrada que usará la guía de despacho de F-VTA-16 (MSF-135).
--
-- Esquema (Principio VII), verificado tabla por tabla:
--   dominio.contrarreembolsos   dominio (nueva)  el contrarreembolso de un envío: entidad de
--                                                 negocio del producto (la plata que un tercero
--                                                 cobra al entregar y después rinde). Nunca en
--                                                 `public`: no es un dato de plataforma.
--   dominio.comprobantes_venta   dominio (existente) se referencia (FK compuesta): la factura
--                                                 cuyo saldo quedó en manos del transporte.
--   dominio.empresas              dominio (existente) se referencia (FK compuesta): la tienda.
--   dominio.transportes           dominio (existente) se referencia (FK compuesta): quién cobra.
--   dominio.cobros_comprobante    dominio (existente) se referencia (FK compuesta, nulable): el
--                                                 cobro del libro que el transporte registra al
--                                                 rendir (lo escribe F-VTA-12).
--   public.organizaciones         public (existente)  dueña multi-tenant.
--
-- Reglas del dato:
-- · Un contrarreembolso es de UNA guía: (comprobante, guía) es único, así la misma guía no abre
--   dos contrarreembolsos (idempotencia, FR-040).
-- · `importe` > 0: es el saldo que el transporte cobró al entregar (FR-040).
-- · `estado` ∈ ('pendiente', 'cobrado'): lo mueve la RPC `public.marcar_contrarreembolso_cobrado`
--   (migración 20270114120100). Nadie lo cambia a mano.
-- · NO se borra ni se edita por escrito: sin política ni grant de INSERT/UPDATE/DELETE. Escriben
--   la función interna `private.abrir_contrarreembolso` (esta migración) y la RPC pública del
--   cobro (20270114120100). Es un libro de dinero, como `dominio.cobros_comprobante`.
-- · `cobrado_por_nombre` es una FOTO del nombre: el historial sobrevive a la baja de la cuenta
--   (mismo criterio que `dominio.cobros_comprobante.registrado_por_nombre`).
--
-- RLS (FR-001, el mismo criterio que el libro de cobros): lectura por organización, empresa
-- accesible (`private.empresas_accesibles()`) y sección `ventas` en lectura o edición.
-- `anon` sin privilegios.
--
-- VERSIONES: las tres migraciones de esta historia usan la banda `20270114120000`…
-- `20270114120200` (tabla → cobro → lectura). Es una banda **nueva y mayor** a propósito: con los
-- números que nombra `tasks.md` (`20261209300…`) quedaban por debajo de la cola ya aplicada en
-- dokploy (`20270112150000`) y `supabase db push` las rechaza («found local migration files to be
-- inserted before the last migration on remote database»); el guard
-- `scripts/verificar-migraciones.mjs` lo marca como «versión REUSADA» y `pnpm docs:check` falla.
-- Por eso se renumeró a `20270114120000`…`20270114120200`, después de F-VTA-12
-- (`20270114100000`…) y de F-VTA-13 (`20270114110000`…). `tasks.md` sigue nombrando la banda vieja
-- porque es la spec compartida entre historias y **no se edita**.
--
-- Migración aditiva (tabla, índices, función y políticas nuevas). Reversión (en una migración
-- posterior; no se ejecuta en este PR; exportar antes los contrarreembolsos ya cargados):
--   drop function private.abrir_contrarreembolso(uuid, uuid, text);
--   drop table dominio.contrarreembolsos;

create table dominio.contrarreembolsos (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  -- La empresa (tienda) es la del comprobante: el contrarreembolso nunca es de otra tienda.
  empresa_id uuid not null,
  comprobante_id uuid not null,
  transporte_id uuid not null,
  -- La guía del envío: es lo que identifica el contrarreembolso (no hay `guia` en el
  -- comprobante; ver *Decisiones abiertas* 2 de la spec).
  guia text not null check (btrim(guia) <> '' and length(guia) <= 100),
  -- Lo que cobró el transporte al entregar: el saldo del comprobante al abrirlo (FR-040).
  importe numeric(14, 2) not null check (importe > 0),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'cobrado')),
  -- Quién y cuándo lo cobró (nulos mientras está pendiente).
  cobrado_por uuid,
  cobrado_por_nombre text check (length(cobrado_por_nombre) <= 200),
  cobrado_en timestamptz,
  -- El cobro del libro que dejó el transporte al rinde (nulo mientras está pendiente).
  cobro_id uuid,
  creado_en timestamptz not null default now(),
  -- Bloqueo optimista del «Marcar cobrado».
  actualizado_en timestamptz not null default now(),
  -- FK compuestas: el contrarreembolso no puede apuntar a otra organización (ni a otra empresa,
  -- ni a otro comprobante, ni a otro transporte, ni a otro cobro).
  foreign key (comprobante_id, organizacion_id)
    references dominio.comprobantes_venta (id, organizacion_id),
  foreign key (empresa_id, organizacion_id)
    references dominio.empresas (id, organizacion_id),
  foreign key (transporte_id, organizacion_id)
    references dominio.transportes (id, organizacion_id),
  foreign key (cobro_id, organizacion_id)
    references dominio.cobros_comprobante (id, organizacion_id),
  -- Idempotencia por (comprobante, guía): la misma guía no abre dos contrarreembolsos.
  unique (comprobante_id, guia),
  unique (id, organizacion_id),
  -- El cobro va entero o no va: pendiente sin datos de cobro, cobrado con todos.
  constraint contrarreembolsos_cobro_ck check (
    (estado = 'pendiente'
      and cobrado_por is null and cobrado_por_nombre is null
      and cobrado_en is null and cobro_id is null)
    or
    (estado = 'cobrado'
      and cobrado_por is not null and cobrado_por_nombre is not null
      and cobrado_en is not null and cobro_id is not null)
  )
);

comment on table dominio.contrarreembolsos is
  'Contrarreembolsos por transporte (F-VTA-14): la plata que el transporte cobra al entregar y después rinde. Libro de dinero: sin escritura directa ni borrado; escribe la función interna que lo abre y la RPC que lo marca cobrado.';
comment on column dominio.contrarreembolsos.guia is
  'Guía del envío: identifica el contrarreembolso. Única por comprobante (misma guía, un solo contrarreembolso).';
comment on column dominio.contrarreembolsos.importe is
  'Importe que cobró el transporte: el saldo del comprobante en el momento de abrirlo.';
comment on column dominio.contrarreembolsos.cobro_id is
  'Cobro del libro que registró el transporte al rendir (origen contrarreembolso). Nulo mientras está pendiente.';
comment on column dominio.contrarreembolsos.cobrado_por_nombre is
  'Foto del nombre de quien marcó el contrarreembolso como cobrado: el historial sobrevive a la baja de la cuenta.';

-- La pantalla lista por empresa y estado, y las tarjetas cuentan lo pendiente del mes.
create index if not exists contrarreembolsos_org_empresa_estado_idx
  on dominio.contrarreembolsos (organizacion_id, empresa_id, estado, creado_en desc);
-- Un transporte se consulta por envíos: quién tiene pendientes y quién ya rindió.
create index if not exists contrarreembolsos_transporte_idx
  on dominio.contrarreembolsos (transporte_id);

-- ============================================================================
-- RLS (FR-040): lectura por organización y empresa accesible; sin escritura directa
-- ============================================================================

alter table dominio.contrarreembolsos enable row level security;

create policy contrarreembolsos_select on dominio.contrarreembolsos
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and empresa_id in (select private.empresas_accesibles())
    and (select private.nivel_seccion('ventas')) in ('lectura', 'edicion')
  );

-- ============================================================================
-- Grants: `anon` sin privilegios; `authenticated` solo lectura (escribe la RPC)
-- ============================================================================

grant usage on schema dominio to authenticated;

revoke all on dominio.contrarreembolsos from public, anon, authenticated;

grant select on dominio.contrarreembolsos to authenticated;

-- ============================================================================
-- `private.abrir_contrarreembolso` (FR-040): abre el contrarreembolso de una guía
-- ============================================================================
-- Es el punto de entrada que usará la guía de despacho de F-VTA-16 (MSF-135); mientras esa
-- historia no exista, se simula desde las pruebas y los datos de prueba.
--
-- · La ORGANIZACIÓN y la EMPRESA salen del comprobante, no de un argumento: la función no
--   acepta ids sueltos que puedan apuntar a otra organización. Si la sesión trae organización
--   (una persona), tiene que ser la del comprobante.
-- · Solo si el transporte `cobra_contrarreembolso`: un transporte que no cobra al entregar no
--   genera nada (el escenario 1 de US3 y FR-040).
-- · Idempotente por (comprobante, guía): la misma guía devuelve el contrarreembolso ya abierto,
--   sin duplicar y sin evento nuevo.
-- · El importe es el SALDO del comprobante (FR-040): lo que queda por cobrar cuando el
--   transporte se lleva la mercadería.
-- · Deja el evento `contrarreembolso.abierto` en la misma transacción, con la tienda y la guía.
-- · No la ejecuta `authenticated`: vive en `private` (sin `grant`), como las demás funciones
--   internas de cobros.
--
-- Bloqueo de fila sobre el comprobante: serializa dos aperturas de la misma guía y serializa
-- contra el registro de cobros (que bloquea el mismo comprobante), así que el importe del
-- contrarreembolso nunca se calcula con un saldo viejo.

create or replace function private.abrir_contrarreembolso(
  p_comprobante_id uuid,
  p_transporte_id uuid,
  p_guia text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_guia text := btrim(coalesce(p_guia, ''));
  v_c dominio.comprobantes_venta;
  v_t dominio.transportes;
  v_saldo record;
  v_id uuid;
begin
  -- ── Validaciones del pedido (FR-040) ───────────────────────────────────────
  if p_comprobante_id is null then
    raise exception 'El comprobante es obligatorio' using errcode = '22023';
  end if;

  if p_transporte_id is null then
    raise exception 'El transporte es obligatorio' using errcode = '22023';
  end if;

  if v_guia = '' then
    raise exception 'La guía es obligatoria' using errcode = '22023';
  end if;

  if length(v_guia) > 100 then
    raise exception 'La guía no puede tener más de 100 caracteres' using errcode = '22023';
  end if;

  -- ── El comprobante, con bloqueo de fila (serializa aperturas y cobros) ──────
  select * into v_c
    from dominio.comprobantes_venta c
   where c.id = p_comprobante_id
     for update;
  if not found then
    raise exception 'El comprobante no existe' using errcode = 'P0002';
  end if;

  -- Aislamiento: si la sesión trae organización, tiene que ser la del comprobante.
  if v_org is not null and v_org <> v_c.organizacion_id then
    raise exception 'El comprobante no es de tu organización' using errcode = '42501';
  end if;

  if v_c.tipo <> 'factura' then
    raise exception 'Solo las facturas admiten contrarreembolso' using errcode = '22023';
  end if;

  if v_c.empresa_id is null then
    raise exception 'La factura no tiene empresa: no admite contrarreembolso' using errcode = '22023';
  end if;

  if v_c.estado in ('borrador', 'anulada') then
    raise exception 'La factura no está en un estado operativo: no admite contrarreembolso'
      using errcode = '55000';
  end if;

  -- ── Idempotencia: la misma guía no abre dos contrarreembolsos (FR-040) ─────
  select cr.id into v_id
    from dominio.contrarreembolsos cr
   where cr.comprobante_id = p_comprobante_id
     and cr.guia = v_guia;
  if v_id is not null then
    return v_id;
  end if;

  -- ── El transporte: tiene que cobrar contrarreembolso (FR-040) ─────────────
  select * into v_t
    from dominio.transportes t
   where t.id = p_transporte_id
     and t.organizacion_id = v_c.organizacion_id;
  if not found then
    raise exception 'El transporte no existe' using errcode = 'P0002';
  end if;

  if not v_t.cobra_contrarreembolso then
    raise exception 'El transporte % no cobra contrarreembolso', v_t.nombre using errcode = '22023';
  end if;

  -- ── El importe es el saldo del comprobante (FR-040) ───────────────────────
  select * into v_saldo from private.saldo_comprobante(p_comprobante_id);
  if v_saldo.saldo <= 0 then
    raise exception 'La factura % no tiene saldo pendiente: no hay contrarreembolso que abrir',
      v_c.numero using errcode = '22023';
  end if;

  -- ── El contrarreembolso, «Pendiente» (FR-040) ─────────────────────────────
  insert into dominio.contrarreembolsos (
    organizacion_id, empresa_id, comprobante_id, transporte_id, guia, importe
  )
  values (
    v_c.organizacion_id, v_c.empresa_id, v_c.id, v_t.id, v_guia, v_saldo.saldo
  )
  returning id into v_id;

  -- ── El evento (FR-040): misma transacción, con la tienda y la guía ─────────
  perform private.insertar_actividad(
    v_c.organizacion_id,
    v_actor,
    'contrarreembolso.abierto',
    format('Contrarreembolso de %s por %s (guía %s) en la factura %s',
      v_saldo.saldo, v_t.nombre, v_guia, v_c.numero),
    v_c.empresa_id
  );

  return v_id;
end;
$$;

revoke execute on function private.abrir_contrarreembolso(uuid, uuid, text) from public, anon, authenticated;

comment on function private.abrir_contrarreembolso(uuid, uuid, text) is
  'Abre el contrarreembolso de una guía (F-VTA-14, FR-040): solo transportes que cobran contrarreembolso, importe = saldo del comprobante, idempotente por (comprobante, guía) y evento contrarreembolso.abierto. Punto de entrada de la guía de despacho (F-VTA-16/MSF-135). No la ejecuta authenticated.';
