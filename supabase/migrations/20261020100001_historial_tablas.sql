-- F-VTA-37 (MSF-275, spec 20261020-100000-ventas-historial-de-consulta, FR-001, FR-008):
-- tablas de archivo del historial del panel anterior. Se importan una sola vez desde
-- exportaciones CSV/Excel y ninguna pantalla puede modificarlas.
--
-- Esquema (Principio VII): las tres tablas son dominio del producto (ventas archivadas) →
-- `dominio`, nunca `public`. Re-verificado contra `spec.md` (tabla «Esquema de datos»).
--
-- Acceso:
--   * Lectura (`authenticated`): organización + (empresa asignada, salvo cotizaciones, que son
--     globales) + nivel `lectura`/`edicion` de la sección `ventas`.
--   * Escritura: NINGUNA para `authenticated` ni `anon` (sin políticas ni grants de insert/update/
--     delete). Solo escribe la función `private.importar_historial_lote` (migración T003), que
--     corre como dueño y solo la puede ejecutar un rol `worker_*`.
--   * Sin claves foráneas a tablas vivas (comprobantes, cobros, cotización vigente, stock, saldos)
--     ni disparadores: el historial no cuenta para nada. Las únicas referencias son
--     `organizacion_id` y `empresa_id` (la «tienda» que emitió el dato), que no son tablas de
--     movimiento.
--
-- Los índices de búsqueda por texto (sin mayúsculas ni tildes) se crean junto con las RPC de
-- consulta (F-VTA-38), que son quienes fijan la expresión de búsqueda.
--
-- Migración aditiva. Reversión (en una migración posterior, exportando antes los datos; nunca en
-- el mismo PR que la crea):
--   drop table dominio.historial_cotizaciones_dolar, dominio.historial_cobros, dominio.historial_comprobantes;

-- ============================================================================
-- dominio.historial_comprobantes
-- ============================================================================

create table dominio.historial_comprobantes (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  empresa_id uuid not null references dominio.empresas (id),
  -- Número original completo del panel anterior (p. ej. A-0001-00018842): el tipo viaja en él.
  numero text not null check (btrim(numero) <> '' and length(numero) <= 40),
  fecha date not null,
  cliente_nombre text not null check (btrim(cliente_nombre) <> '' and length(cliente_nombre) <= 200),
  -- Número de cliente como dato (sin FK a public.clientes). Vacío si la planilla no lo trae.
  cliente_numero text check (cliente_numero is null or length(cliente_numero) <= 40),
  operador text not null check (length(operador) <= 120),
  estado_final text not null check (btrim(estado_final) <> '' and length(estado_final) <= 60),
  total numeric(14, 2) not null,
  importado_en timestamptz not null default now(),
  -- Clave natural: la reimportación no duplica (FR-007).
  unique (organizacion_id, empresa_id, numero)
);

comment on table dominio.historial_comprobantes is
  'Archivo de comprobantes del panel anterior (F-VTA-37). Solo lectura para la app; lo escribe el worker historial-importador una sola vez. No referencia tablas vivas (FR-008).';

create index historial_comprobantes_fecha_idx
  on dominio.historial_comprobantes (organizacion_id, empresa_id, fecha desc, id);
create index historial_comprobantes_fecha_org_idx
  on dominio.historial_comprobantes (organizacion_id, fecha desc, id);

-- ============================================================================
-- dominio.historial_cobros
-- ============================================================================

create table dominio.historial_cobros (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  empresa_id uuid not null references dominio.empresas (id),
  fecha date not null,
  comprobante_numero text not null check (btrim(comprobante_numero) <> '' and length(comprobante_numero) <= 40),
  cliente_nombre text not null check (btrim(cliente_nombre) <> '' and length(cliente_nombre) <= 200),
  cliente_numero text check (cliente_numero is null or length(cliente_numero) <= 40),
  cuenta_cobro text not null check (btrim(cuenta_cobro) <> '' and length(cuenta_cobro) <= 120),
  aprobado_por text not null check (length(aprobado_por) <= 120),
  importe numeric(14, 2) not null,
  importado_en timestamptz not null default now(),
  -- Un comprobante puede tener varios cobros: la clave natural se completa con fecha, cuenta e
  -- importe (plan, «Diseño por historia»). Dos cobros idénticos del mismo día se tratan como uno.
  unique (organizacion_id, empresa_id, comprobante_numero, fecha, cuenta_cobro, importe)
);

comment on table dominio.historial_cobros is
  'Archivo de cobros del panel anterior (F-VTA-37). Solo lectura para la app; lo escribe el worker historial-importador una sola vez. No referencia tablas vivas (FR-008).';

create index historial_cobros_fecha_idx
  on dominio.historial_cobros (organizacion_id, empresa_id, fecha desc, id);
create index historial_cobros_fecha_org_idx
  on dominio.historial_cobros (organizacion_id, fecha desc, id);

-- ============================================================================
-- dominio.historial_cotizaciones_dolar (global por organización: sin empresa_id)
-- ============================================================================

create table dominio.historial_cotizaciones_dolar (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  fecha date not null,
  dolar_comprador numeric(14, 2) not null check (dolar_comprador >= 0),
  dolar_vendedor numeric(14, 2) not null check (dolar_vendedor >= 0),
  cargo text not null check (length(cargo) <= 120),
  importado_en timestamptz not null default now(),
  unique (organizacion_id, fecha)
);

comment on table dominio.historial_cotizaciones_dolar is
  'Archivo de cotizaciones del dólar del panel anterior (F-VTA-37). Globales de la organización. Solo lectura para la app; no toca la cotización vigente (FR-008).';

-- ============================================================================
-- RLS: solo lectura para la app (FR-001). Sin políticas de insert/update/delete.
-- ============================================================================

alter table dominio.historial_comprobantes enable row level security;
alter table dominio.historial_cobros enable row level security;
alter table dominio.historial_cotizaciones_dolar enable row level security;

create policy historial_comprobantes_select on dominio.historial_comprobantes
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and empresa_id in (select private.empresas_accesibles())
    and (select private.nivel_seccion('ventas')) in ('lectura', 'edicion')
  );

create policy historial_cobros_select on dominio.historial_cobros
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and empresa_id in (select private.empresas_accesibles())
    and (select private.nivel_seccion('ventas')) in ('lectura', 'edicion')
  );

create policy historial_cotizaciones_dolar_select on dominio.historial_cotizaciones_dolar
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('ventas')) in ('lectura', 'edicion')
  );

-- Grants: `anon` sin nada; `authenticated` solo select.
revoke all on dominio.historial_comprobantes, dominio.historial_cobros, dominio.historial_cotizaciones_dolar
  from public, anon, authenticated;
grant select on dominio.historial_comprobantes, dominio.historial_cobros, dominio.historial_cotizaciones_dolar
  to authenticated;
