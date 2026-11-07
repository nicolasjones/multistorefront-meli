-- F-PRE-10 (MSF-436, épica MSF-363): registro de cada lote de actualización masiva de precios.
-- Esquema (Principio VII): `dominio.actualizaciones_precio` es un dato de negocio auditable
-- (quién cambió qué precios y cuándo) → `dominio`, nunca `public`.
--
-- Solo lectura para `authenticated` (sección `productos` ≥ lectura); escribe únicamente la RPC
-- `public.aplicar_actualizacion_precios`. `anon` sin privilegios. `parametros` NO guarda importes
-- de costo (la ve quien no tiene `rentabilidad`): en modo planilla solo la cantidad de filas.
--
-- Migración aditiva. Reversión (en una migración posterior, no en este PR; exportar antes los datos):
--   drop table dominio.actualizaciones_precio;

create table dominio.actualizaciones_precio (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  actor_id uuid,
  actor_nombre text,
  modo text not null check (modo in ('porcentaje', 'planilla')),
  parametros jsonb not null default '{}'::jsonb,
  cantidad integer not null check (cantidad > 0),
  clave uuid not null,
  creado_en timestamptz not null default now(),
  unique (organizacion_id, clave)
);

comment on table dominio.actualizaciones_precio is
  'Lotes de actualización masiva de costos y precios (F-PRE-10). Solo de agregado: escribe la RPC aplicar_actualizacion_precios.';
comment on column dominio.actualizaciones_precio.clave is
  'Clave de idempotencia generada por el cliente: repetirla devuelve el lote ya aplicado.';
comment on column dominio.actualizaciones_precio.parametros is
  'Parámetros del lote sin importes de costo (modo porcentaje: qué cambia, alcance y %; planilla: cantidad de filas).';

create index actualizaciones_precio_org_creado_idx
  on dominio.actualizaciones_precio (organizacion_id, creado_en desc, id);

alter table dominio.actualizaciones_precio enable row level security;

create policy actualizaciones_precio_select on dominio.actualizaciones_precio
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('productos')) in ('lectura', 'edicion')
  );

grant usage on schema dominio to authenticated;

revoke all on dominio.actualizaciones_precio from public, anon, authenticated;
grant select on dominio.actualizaciones_precio to authenticated;
