-- F-PRE-02 (MSF-246, épica MSF-116): tablas de la carga diaria del dólar.
-- Esquema (Principio VII): ambas son datos de negocio del producto (la cotización con la que
-- se calculan los precios) → `dominio`, nunca `public`. Una cotización es de la ORGANIZACIÓN,
-- no de una empresa (la empresa activa de la barra superior no la cambia).
--
--   dominio.cotizacion_pendiente: valor cargado que espera confirmación (una por organización,
--     vence a las 24 h; el vencimiento se resuelve AL CONSULTAR, sin worker).
--   dominio.cotizaciones: historial de cargas confirmadas. Append-only: ningún rol de la API
--     tiene insert/update/delete; la única escritura será `public.confirmar_cotizacion`
--     (F-PRE-03) y el trigger de inmutabilidad llega con F-PRE-04. Hoy queda vacía.
--
-- Permisos por sección `cotizacion_dolar`: `edicion` carga/lee la pendiente; `lectura` ve el
-- historial. `anon` sin privilegios.
--
-- Migración aditiva. Reversión (migración posterior; exportar antes los datos):
--   drop trigger cotizacion_pendiente_vencimiento on dominio.cotizacion_pendiente;
--   drop function private.fijar_vencimiento_cotizacion();
--   drop table dominio.cotizaciones;
--   drop table dominio.cotizacion_pendiente;

create table dominio.cotizacion_pendiente (
  organizacion_id uuid primary key references public.organizaciones (id) on delete cascade,
  valor numeric(14, 4) not null check (valor > 0),
  cargada_por uuid references auth.users (id) on delete set null,
  cargada_en timestamptz not null default now(),
  expira_en timestamptz not null default now() + interval '24 hours',
  check (expira_en > cargada_en)
);

comment on table dominio.cotizacion_pendiente is
  'Cotización del dólar cargada que espera confirmación (F-PRE-02). Una por organización; vence a las 24 h al consultar (expira_en > now()).';

create table dominio.cotizaciones (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  valor numeric(14, 4) not null check (valor > 0),
  valor_anterior numeric(14, 4) check (valor_anterior > 0),
  variacion_pct numeric(12, 4),
  cargada_por uuid references auth.users (id) on delete set null,
  cargada_por_nombre text not null check (btrim(cargada_por_nombre) <> ''),
  cargada_en timestamptz not null default now(),
  recalculo_aplicado boolean not null default false,
  precios_recalculados integer not null default 0 check (precios_recalculados >= 0)
);

comment on table dominio.cotizaciones is
  'Historial de cotizaciones del dólar confirmadas (F-PRE-02 tabla, F-PRE-03 escritura, F-PRE-04 inmutabilidad). Append-only: sin insert/update/delete para authenticated.';

create index if not exists cotizaciones_org_cargada_idx on dominio.cotizaciones (organizacion_id, cargada_en desc, id);

-- La hora de carga y el vencimiento los fija la base: ni la API ni el llamador los eligen.
-- Al volver a cargar (aunque sea el mismo valor) la pendiente se renueva 24 h. Una escritura
-- directa de los tiempos (solo posible sin la API, p. ej. un script de mantenimiento) se respeta.
create or replace function private.fijar_vencimiento_cotizacion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT'
     or (new.cargada_en is not distinct from old.cargada_en and new.expira_en is not distinct from old.expira_en) then
    new.cargada_en := now();
    new.expira_en := now() + interval '24 hours';
  end if;
  return new;
end;
$$;

revoke execute on function private.fijar_vencimiento_cotizacion() from public, anon, authenticated;

create trigger cotizacion_pendiente_vencimiento
  before insert or update on dominio.cotizacion_pendiente
  for each row execute function private.fijar_vencimiento_cotizacion();

alter table dominio.cotizacion_pendiente enable row level security;
alter table dominio.cotizaciones enable row level security;

create policy cotizacion_pendiente_select on dominio.cotizacion_pendiente
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('cotizacion_dolar')) = 'edicion'
  );

create policy cotizacion_pendiente_insert on dominio.cotizacion_pendiente
  for insert to authenticated
  with check (
    organizacion_id = (select private.organizacion_id())
    and cargada_por = (select auth.uid())
    and (select private.nivel_seccion('cotizacion_dolar')) = 'edicion'
  );

create policy cotizacion_pendiente_update on dominio.cotizacion_pendiente
  for update to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('cotizacion_dolar')) = 'edicion'
  )
  with check (
    organizacion_id = (select private.organizacion_id())
    and cargada_por = (select auth.uid())
    and (select private.nivel_seccion('cotizacion_dolar')) = 'edicion'
  );

create policy cotizacion_pendiente_delete on dominio.cotizacion_pendiente
  for delete to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('cotizacion_dolar')) = 'edicion'
  );

-- Historial: solo lectura para quien ve la sección. Sin políticas de escritura.
create policy cotizaciones_select on dominio.cotizaciones
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('cotizacion_dolar')) in ('lectura', 'edicion')
  );

grant usage on schema dominio to authenticated;

revoke all on dominio.cotizacion_pendiente from public, anon, authenticated;
grant select, delete on dominio.cotizacion_pendiente to authenticated;
grant insert (organizacion_id, valor, cargada_por) on dominio.cotizacion_pendiente to authenticated;
grant update (valor, cargada_por) on dominio.cotizacion_pendiente to authenticated;

revoke all on dominio.cotizaciones from public, anon, authenticated;
grant select on dominio.cotizaciones to authenticated;
