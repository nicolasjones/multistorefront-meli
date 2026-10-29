-- MSF-293 (F-VTA-37, épica MSF-275): tablas de archivo del historial de ventas importado
-- desde el panel actual. Se escriben UNA vez por importación y se consultan en solo lectura.
--
-- Esquemas (Principio VII), verificados tabla por tabla:
--   dominio.historial_comprobantes        dominio (nueva)     ventas archivadas: dato de negocio del producto.
--   dominio.historial_cobros              dominio (nueva)     cobros archivados: ídem.
--   dominio.historial_cotizaciones_dolar  dominio (nueva)     cotizaciones archivadas: ídem, sin empresa.
--   public.organizaciones  existente  única FK: es el dueño multi-tenant, no una tabla viva del producto.
--   dominio.empresas       existente  relación LÓGICA por empresa_id, sin FK (spec.md → Modelo de datos, FR-008).
--
-- Sin políticas ni grants de insert/update/delete: nadie escribe desde la app ni la API.
-- Escribe solo `private.importar_historial_lote` (security definer, ejecutable por los workers).
-- Sin FKs ni disparadores hacia tablas vivas (comprobantes, cobros, stock, saldos): FR-008.
--
-- Migración aditiva. Reversión (migración posterior, nunca en este PR; exportar antes los datos):
--   drop table dominio.historial_cotizaciones_dolar;
--   drop table dominio.historial_cobros;
--   drop table dominio.historial_comprobantes;

-- ============================================================================
-- dominio.historial_comprobantes (FR-001)
-- ============================================================================

create table dominio.historial_comprobantes (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  -- Relación lógica: una empresa viva no puede arrastrar ni bloquear el archivo histórico (FR-008).
  empresa_id uuid not null,
  tipo text not null default '' check (length(tipo) <= 100),
  numero text not null check (btrim(numero) <> '' and length(numero) <= 100),
  fecha date not null,
  cliente_nombre text not null check (btrim(cliente_nombre) <> '' and length(cliente_nombre) <= 300),
  cliente_numero text check (length(cliente_numero) <= 100),
  operador text check (length(operador) <= 200),
  estado_final text check (length(estado_final) <= 100),
  total numeric(14, 2) not null,
  importado_en timestamptz not null default now(),
  -- Clave natural: reimportar el mismo archivo no duplica (FR-007).
  unique (organizacion_id, empresa_id, tipo, numero)
);

comment on table dominio.historial_comprobantes is
  'Ventas archivadas del panel anterior (F-VTA-37). Solo lectura: sin políticas ni grants de escritura; las inserta el worker historial-importador. Sin vínculo con comprobantes vivos.';

create index IF NOT EXISTS historial_comprobantes_org_fecha_idx
  on dominio.historial_comprobantes (organizacion_id, empresa_id, fecha desc, id);
create index IF NOT EXISTS historial_comprobantes_org_numero_idx
  on dominio.historial_comprobantes (organizacion_id, empresa_id, numero);

-- ============================================================================
-- dominio.historial_cobros (FR-001)
-- ============================================================================

create table dominio.historial_cobros (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  -- Relación lógica: una empresa viva no puede arrastrar ni bloquear el archivo histórico (FR-008).
  empresa_id uuid not null,
  fecha date not null,
  comprobante_numero text not null check (btrim(comprobante_numero) <> '' and length(comprobante_numero) <= 100),
  cliente_nombre text not null check (btrim(cliente_nombre) <> '' and length(cliente_nombre) <= 300),
  cliente_numero text check (length(cliente_numero) <= 100),
  cuenta_cobro text check (length(cuenta_cobro) <= 200),
  aprobado_por text check (length(aprobado_por) <= 200),
  importe numeric(14, 2) not null,
  importado_en timestamptz not null default now(),
  -- Un comprobante puede tener más de un cobro: la clave se completa con fecha e importe
  -- (spec.md, Decisiones abiertas 8).
  unique (organizacion_id, empresa_id, comprobante_numero, fecha, importe)
);

comment on table dominio.historial_cobros is
  'Cobros archivados del panel anterior (F-VTA-37). Solo lectura: sin políticas ni grants de escritura; las inserta el worker historial-importador. Sin vínculo con cobros vivos.';

create index IF NOT EXISTS historial_cobros_org_fecha_idx
  on dominio.historial_cobros (organizacion_id, empresa_id, fecha desc, id);
create index IF NOT EXISTS historial_cobros_org_comprobante_idx
  on dominio.historial_cobros (organizacion_id, empresa_id, comprobante_numero);

-- ============================================================================
-- dominio.historial_cotizaciones_dolar (FR-001): global por organización
-- ============================================================================

create table dominio.historial_cotizaciones_dolar (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  fecha date not null,
  dolar_comprador numeric(14, 4) not null check (dolar_comprador >= 0),
  dolar_vendedor numeric(14, 4) not null check (dolar_vendedor >= 0),
  cargado_por text check (length(cargado_por) <= 200),
  importado_en timestamptz not null default now(),
  unique (organizacion_id, fecha)
);

comment on table dominio.historial_cotizaciones_dolar is
  'Cotizaciones del dólar archivadas del panel anterior (F-VTA-37). Globales de la organización. Solo lectura; no toca la cotización vigente.';

-- ============================================================================
-- RLS: organización + empresas accesibles + nivel de `ventas`; solo select (FR-001)
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

-- ============================================================================
-- Grants: `anon` sin privilegios; `authenticated` solo lectura
-- ============================================================================

grant usage on schema dominio to authenticated;

revoke all on dominio.historial_comprobantes, dominio.historial_cobros, dominio.historial_cotizaciones_dolar
  from public, anon, authenticated;

grant select on dominio.historial_comprobantes, dominio.historial_cobros, dominio.historial_cotizaciones_dolar
  to authenticated;
