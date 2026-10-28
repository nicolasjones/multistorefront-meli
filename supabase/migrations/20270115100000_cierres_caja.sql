-- F-VTA-33 (MSF-349, épica MSF-193, spec 20261027-100000-ventas-mejoras, FR-020):
-- cierre de caja diario por empresa.
--
-- Esquema (Principio VII), verificado tabla por tabla:
--   dominio.cierres_caja          dominio (nueva)     el cierre del día de una tienda: regla de negocio
--                                                     del producto (dinero), nunca `public`.
--   dominio.cierres_caja_detalle  dominio (nueva)     el resumen del cierre por forma de pago y cuenta.
--   dominio.empresas / formas_pago / cuentas_cobro    dominio (existentes) se referencian (FK compuesta).
--   public.organizaciones         public (existente)  dueña multi-tenant.
--
-- Reglas del dato:
-- · Un cierre por (organización, empresa, fecha): índice único. Reabrir y volver a cerrar reutiliza
--   la misma fila (estado `reabierta` → `cerrada`) y rehace el detalle.
-- · `estado` ∈ ('abierta', 'cerrada', 'reabierta'); solo hay fila cuando alguien cerró la caja. El
--   «día sin cierre» (abierta) es la ausencia de fila.
-- · Sin escritura directa: escriben solo `public.cerrar_caja` / `public.reabrir_caja`
--   (migración 20270115100100). `anon` sin privilegios; `authenticated` solo lectura.
-- · `cerrado_por`/`reabierto_por` sin FK a auth.users: el historial sobrevive a la baja de la cuenta.
--
-- RLS (FR-020): lectura por organización, empresa accesible y sección `ventas` (lectura o edición).
--
-- VERSIONES: posteriores a la última migración de la base (`20270114130000`).
--
-- Migración aditiva. Reversión (en una migración posterior; exportar antes los cierres):
--   drop table dominio.cierres_caja_detalle;
--   drop table dominio.cierres_caja;

create table dominio.cierres_caja (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  empresa_id uuid not null,
  fecha date not null,
  estado text not null default 'cerrada' check (estado in ('abierta', 'cerrada', 'reabierta')),
  cerrado_por uuid,
  cerrado_en timestamptz,
  reabierto_por uuid,
  reabierto_en timestamptz,
  foreign key (empresa_id, organizacion_id)
    references dominio.empresas (id, organizacion_id),
  unique (id, organizacion_id)
);

comment on table dominio.cierres_caja is
  'Cierre de caja diario por empresa (F-VTA-33). Sin escritura directa: escriben cerrar_caja y reabrir_caja.';

-- Un cierre por día y empresa (FR-020).
create unique index cierres_caja_org_empresa_fecha_uidx
  on dominio.cierres_caja (organizacion_id, empresa_id, fecha);

create table dominio.cierres_caja_detalle (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  cierre_id uuid not null,
  forma_pago_id uuid not null,
  -- Nulo para el efectivo y las formas que no van a una cuenta.
  cuenta_cobro_id uuid,
  total numeric(14, 2) not null,
  foreign key (cierre_id, organizacion_id)
    references dominio.cierres_caja (id, organizacion_id) on delete cascade,
  foreign key (forma_pago_id, organizacion_id)
    references dominio.formas_pago (id, organizacion_id),
  foreign key (cuenta_cobro_id, organizacion_id)
    references dominio.cuentas_cobro (id, organizacion_id)
);

comment on table dominio.cierres_caja_detalle is
  'Resumen de un cierre de caja por forma de pago y cuenta de cobro (F-VTA-33).';

create index cierres_caja_detalle_cierre_idx on dominio.cierres_caja_detalle (cierre_id);

-- ============================================================================
-- RLS (FR-020): lectura por organización y empresa accesible; sin escritura directa
-- ============================================================================

alter table dominio.cierres_caja enable row level security;
alter table dominio.cierres_caja_detalle enable row level security;

create policy cierres_caja_select on dominio.cierres_caja
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and empresa_id in (select private.empresas_accesibles())
    and (select private.nivel_seccion('ventas')) in ('lectura', 'edicion')
  );

create policy cierres_caja_detalle_select on dominio.cierres_caja_detalle
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('ventas')) in ('lectura', 'edicion')
    and exists (
      select 1 from dominio.cierres_caja c
       where c.id = cierre_id
         and c.organizacion_id = organizacion_id
         and c.empresa_id in (select private.empresas_accesibles())
    )
  );

revoke all on dominio.cierres_caja from public, anon, authenticated;
revoke all on dominio.cierres_caja_detalle from public, anon, authenticated;
grant select on dominio.cierres_caja to authenticated;
grant select on dominio.cierres_caja_detalle to authenticated;
