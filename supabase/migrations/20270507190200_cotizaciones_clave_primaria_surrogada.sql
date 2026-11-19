-- MSF-922 (lote 33): `dominio.cotizacion_aplicada` y `dominio.cotizacion_pendiente` quedaron SIN clave primaria cuando
-- 20270213100002 (F-PRE-06, cotización por empresa) descartó la PK por `organizacion_id`: la unicidad pasó a un índice único
-- funcional (organizacion_id, coalesce(empresa_id, uuid nulo)), que no puede ser PK. Sin PK no hay identidad de fila para
-- replicación lógica, herramientas de datos ni deduplicación.
--
-- Se agrega una PK sustituta `id uuid default gen_random_uuid()`. No hay duplicados posibles que tratar: la clave natural
-- sigue protegida por el índice único existente, y `id` se rellena con un valor propio por fila (las tablas son de una fila
-- por organización/empresa, volumen mínimo; el rewrite del `add column` con default volátil es irrelevante).
-- Las funciones leen estas tablas por nombre de columna (`select *` a un registro, `on conflict (organizacion_id, coalesce(...))`),
-- así que una columna nueva no las afecta.
--
-- Migración aditiva. Reversión (migración posterior):
--   alter table dominio.cotizacion_aplicada drop constraint if exists cotizacion_aplicada_pkey;
--   alter table dominio.cotizacion_pendiente drop constraint if exists cotizacion_pendiente_pkey;
--   alter table dominio.cotizacion_aplicada drop column if exists id;
--   alter table dominio.cotizacion_pendiente drop column if exists id;

alter table dominio.cotizacion_aplicada add column if not exists id uuid not null default gen_random_uuid();
alter table dominio.cotizacion_pendiente add column if not exists id uuid not null default gen_random_uuid();

do $$
begin
  -- Verificación previa explícita: id debe ser único (lo es por construcción; se chequea por si una aplicación parcial dejó la
  -- columna con un default constante).
  if exists (select 1 from dominio.cotizacion_aplicada group by id having count(*) > 1)
     or exists (select 1 from dominio.cotizacion_pendiente group by id having count(*) > 1) then
    update dominio.cotizacion_aplicada set id = gen_random_uuid();
    update dominio.cotizacion_pendiente set id = gen_random_uuid();
  end if;

  if not exists (select 1 from pg_constraint where conrelid = 'dominio.cotizacion_aplicada'::regclass and contype = 'p') then
    alter table dominio.cotizacion_aplicada add constraint cotizacion_aplicada_pkey primary key (id);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'dominio.cotizacion_pendiente'::regclass and contype = 'p') then
    alter table dominio.cotizacion_pendiente add constraint cotizacion_pendiente_pkey primary key (id);
  end if;
end
$$;

comment on column dominio.cotizacion_aplicada.id is 'MSF-922: identidad de la fila (PK sustituta). La clave natural es (organizacion_id, empresa_id) por el índice único cotizacion_aplicada_org_empresa_uq.';
comment on column dominio.cotizacion_pendiente.id is 'MSF-922: identidad de la fila (PK sustituta). La clave natural es (organizacion_id, empresa_id) por el índice único cotizacion_pendiente_org_empresa_uq.';
