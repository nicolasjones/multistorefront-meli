-- F-REN-08 (MSF-209, épica MSF-192): catálogo de costos adicionales por empresa (tienda).
-- Esquema (Principio VII, re-verificado): `dominio.costos_adicionales_canal` es una regla de negocio del
-- producto (qué le cuesta realmente vender a cada tienda), hermana de `dominio.rentabilidad_config` →
-- `dominio`, nunca `public`.
--
-- Acceso: RLS por organización, empresa accesible y sección `rentabilidad` (`select` con lectura o
-- edición). SIN políticas de insert/update/delete y sin esos privilegios: escribe solo la RPC
-- `security definer` de la migración siguiente. `anon` sin privilegios.
-- Un costo se da de baja con `activo = false` (no se borra: conserva su historia).
--
-- Migración aditiva. Reversión (migración posterior; exportar antes los datos):
--   drop table dominio.costos_adicionales_canal;

create table dominio.costos_adicionales_canal (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  empresa_id uuid not null references dominio.empresas (id) on delete cascade,
  nombre text not null check (btrim(nombre) <> '' and char_length(nombre) <= 80),
  -- porcentaje = % sobre el neto sin IVA · monto = pesos por unidad.
  tipo text not null check (tipo in ('porcentaje', 'monto')),
  valor numeric(14, 4) not null check (valor >= 0),
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  check (tipo <> 'porcentaje' or valor <= 100)
);

comment on table dominio.costos_adicionales_canal is
  'Costos adicionales de cada tienda que la vista de margen descuenta (F-REN-08). Se escribe solo con la RPC guardar_costo_adicional; la baja es activo = false.';
comment on column dominio.costos_adicionales_canal.tipo is
  'porcentaje: % (0–100) sobre el neto sin IVA · monto: pesos por unidad.';

-- Nombre único por empresa entre los costos activos (sin distinguir mayúsculas ni espacios de borde).
create unique index costos_adicionales_canal_nombre_activo
  on dominio.costos_adicionales_canal (empresa_id, lower(btrim(nombre)))
  where activo;
create index costos_adicionales_canal_org_empresa
  on dominio.costos_adicionales_canal (organizacion_id, empresa_id);

alter table dominio.costos_adicionales_canal enable row level security;

create policy costos_adicionales_canal_select on dominio.costos_adicionales_canal
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and empresa_id in (select private.empresas_accesibles())
    and (select private.nivel_seccion('rentabilidad')) in ('lectura', 'edicion')
  );

grant usage on schema dominio to authenticated;

revoke all on dominio.costos_adicionales_canal from public, anon, authenticated;
grant select on dominio.costos_adicionales_canal to authenticated;
