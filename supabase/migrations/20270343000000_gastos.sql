-- F-GAS-01 (MSF-469): gastos generales de cada empresa (alquiler, servicios, sueldos…) para entender sus costos fijos.
-- Esquema (Principio VII, re-verificado): `dominio.gastos` es dato de negocio de la empresa (un costo de operar), hermana de
-- `dominio.costos_adicionales_canal` y `dominio.producto_costos` → `dominio`, nunca `public`.
--
-- Acceso: RLS por organización, empresa accesible y sección `rentabilidad` (`select` con lectura o edición). SIN políticas
-- de insert/update/delete y sin esos privilegios para `authenticated`: escribe solo la RPC `security definer` de la migración
-- siguiente (`guardar_gasto`, `anular_gasto`). No hay `DELETE` para ningún rol de aplicación: lo cargado por error se anula
-- con motivo (D11). `anon` sin privilegios. `service_role` opera la tabla como el resto de `dominio` (pgTAP
-- `service_role_privilegios`).
--
-- No mueve ninguna cifra existente: nada lee esta tabla todavía (la medida «margen después de costos fijos» es la fase 3).
--
-- Migración aditiva. Reversión (migración posterior; exportar antes los datos):
--   drop table dominio.gastos;

create table if not exists dominio.gastos (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  empresa_id uuid not null,
  fecha date not null,
  -- Catálogo cerrado de D2: cambiarlo es un cambio de este check y de la lista del panel, no de modelo.
  categoria text not null check (categoria in ('Alquiler', 'Servicios', 'Sueldos', 'Fletes', 'Insumos', 'Impuestos', 'Otros')),
  -- Solo `fijo` se prorrateará en la medida de la fase 3 (D4).
  tipo_costo text not null check (tipo_costo in ('fijo', 'variable')),
  detalle text check (detalle is null or (btrim(detalle) <> '' and char_length(detalle) <= 200)),
  importe numeric(14, 2) not null check (importe > 0),
  moneda text not null check (moneda in ('ARS', 'USD')),
  -- Dólar de la empresa más cercano a la fecha del gasto, congelado al guardar (D8). Null si es ARS.
  cotizacion_usada numeric(14, 4),
  importe_pesos numeric(14, 2) not null check (importe_pesos > 0),
  recurrente boolean not null default false,
  anulado_en timestamptz,
  anulado_por uuid references auth.users (id) on delete set null,
  motivo_anulacion text check (motivo_anulacion is null or (btrim(motivo_anulacion) <> '' and char_length(motivo_anulacion) <= 200)),
  creado_por uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  -- Bloqueo optimista: la RPC lo compara con el que viaja desde el panel y lo renueva al guardar.
  updated_at timestamptz not null default now(),
  constraint gastos_empresa_fk foreign key (empresa_id, organizacion_id)
    references dominio.empresas (id, organizacion_id) on delete cascade,
  -- Liga moneda, cotización e importe en pesos: ARS sin cotización y con pesos = importe; USD con cotización > 0.
  constraint gastos_moneda_ck check (
    (moneda = 'ARS' and cotizacion_usada is null and importe_pesos = importe)
    or (moneda = 'USD' and cotizacion_usada is not null and cotizacion_usada > 0)
  ),
  -- El motivo es obligatorio si y solo si el gasto está anulado.
  constraint gastos_anulacion_ck check (
    (anulado_en is null and motivo_anulacion is null and anulado_por is null)
    or (anulado_en is not null and motivo_anulacion is not null)
  )
);

comment on table dominio.gastos is
  'Gastos generales de una empresa (F-GAS-01). Se escribe solo con las RPC guardar_gasto y anular_gasto; no se borra: se anula con motivo.';
comment on column dominio.gastos.fecha is 'Define el mes de imputación (hora de Buenos Aires).';
comment on column dominio.gastos.tipo_costo is 'fijo | variable. Solo el fijo se prorrateará en la medida nueva (fase 3).';
comment on column dominio.gastos.importe is 'En la moneda original.';
comment on column dominio.gastos.cotizacion_usada is 'Dólar de la empresa congelado al guardar; null si el gasto es en pesos.';
comment on column dominio.gastos.importe_pesos is 'Importe en pesos congelado: importe si ARS; importe × cotizacion_usada si USD.';
comment on column dominio.gastos.recurrente is 'Marca informativa mensual: no genera gastos solos (D12).';
comment on column dominio.gastos.updated_at is 'Bloqueo optimista.';

create index if not exists gastos_org_empresa_fecha_idx on dominio.gastos (organizacion_id, empresa_id, fecha desc, id);
create index if not exists gastos_org_fecha_idx on dominio.gastos (organizacion_id, fecha desc, id);

alter table dominio.gastos enable row level security;

drop policy if exists gastos_select on dominio.gastos;
create policy gastos_select on dominio.gastos
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and empresa_id in (select private.empresas_accesibles())
    and (select private.nivel_seccion('rentabilidad')) in ('lectura', 'edicion')
  );

grant usage on schema dominio to authenticated;

revoke all on dominio.gastos from public, anon, authenticated;
grant select on dominio.gastos to authenticated;
-- service_role (API admin) opera la tabla como toda tabla operativa de dominio (pgTAP `service_role_privilegios`).
grant select, insert, update, delete on dominio.gastos to service_role;
