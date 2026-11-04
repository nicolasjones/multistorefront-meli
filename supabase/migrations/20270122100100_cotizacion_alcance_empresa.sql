-- F-PRE-06 (MSF-419, épica MSF-352) · FR-003: alcance «una por empresa» de la cotización.
-- Con alcance «sistema» la cotización es una por organización (`empresa_id` nulo, como hasta MSF-116).
-- Con alcance «empresa» cada empresa tiene su propio valor. Esta migración solo AGREGA columnas, índices
-- y funciones: no toca ninguna fila de `dominio.cotizaciones` (historial inmutable, F-PRE-04).
--
-- Esquema (Principio VII), objeto por objeto (todas son tablas existentes de `dominio`; no se crea ninguna):
--   dominio.cotizacion_pendiente   dominio  + `empresa_id` nullable, FK compuesta (empresa_id, organizacion_id)
--                                  → empresas: no puede apuntar a una empresa de otra organización. La PK por
--                                  organización se reemplaza por un índice único sobre (organizacion_id,
--                                  coalesce(empresa_id, uuid nulo)): una fila por organización y por empresa.
--   dominio.cotizacion_aplicada    dominio  + `empresa_id` (igual que la anterior).
--   dominio.cotizaciones           dominio  + `empresa_id` (FK compuesta) y `umbral_pct` (el umbral con el que se
--                                  decidió el recálculo; nulo en las cargas anteriores). Sigue append-only.
--   RLS: las políticas vigentes de MSF-116 filtran por organización y siguen valiendo; `anon` sin privilegios.
--
-- Funciones (`private`, sin tablas):
--   private.cotizacion_para(org, empresa)       ÚNICO punto de lectura de la cotización aplicada según el alcance:
--                                               con alcance «empresa» la de esa empresa; si la empresa todavía no
--                                               tiene valor propio (o con alcance «sistema») la general; sin
--                                               ninguna, la inicial de MSF-114.
--   private.a_pesos(importe, moneda, org)       misma firma: ahora lee la cotización GENERAL (`empresa_id` nulo).
--   private.a_pesos(importe, moneda, org, emp)  sobrecarga con empresa, vía `cotizacion_para`.
--   private.cotizacion_vigente(org)             última cotización GENERAL confirmada (o la inicial).
--   private.cotizacion_vigente_para(org, emp)   la vigente de la empresa (su última carga o su valor inicial).
--   private.precio_neto_empresa y public.precios_empresa_neto: convierten con la cotización de la EMPRESA.
--
-- Limitación declarada: los consumidores que llaman a `a_pesos` con tres argumentos (catálogo público de la
-- tienda, líneas de venta, analítica) siguen leyendo la cotización general; con alcance «empresa» esos
-- consumidores no distinguen empresa. Se traza en docs/configuracion-dolar-y-precio-propio.md.
--
-- Migración aditiva. Reversión (migración posterior; exportar antes `cotizacion_aplicada` y `cotizacion_pendiente`):
--   restaurar private.precio_neto_empresa y public.precios_empresa_neto a su cuerpo de 20261022130200;
--   restaurar private.a_pesos al cuerpo de 20261023140300 y private.cotizacion_vigente al de 20261023140200;
--   drop function private.a_pesos(numeric, text, uuid, uuid);
--   drop function private.cotizacion_vigente_para(uuid, uuid);
--   drop function private.cotizacion_para(uuid, uuid);
--   (solo tras consolidar los datos por empresa) alter table dominio.cotizaciones drop column umbral_pct, drop column empresa_id;
--   (idem) delete de las filas con empresa_id y alter table dominio.cotizacion_aplicada / cotizacion_pendiente
--   drop column empresa_id, recreando la PK por organizacion_id.

-- ---------------------------------------------------------------------------
-- Tablas: empresa_id + unicidad por organización y empresa
-- ---------------------------------------------------------------------------

alter table dominio.cotizacion_pendiente alter column organizacion_id set not null;
alter table dominio.cotizacion_pendiente drop constraint cotizacion_pendiente_pkey;
alter table dominio.cotizacion_pendiente add column empresa_id uuid;
alter table dominio.cotizacion_pendiente
  add constraint cotizacion_pendiente_empresa_fk
  foreign key (empresa_id, organizacion_id) references dominio.empresas (id, organizacion_id) on delete cascade;
create unique index cotizacion_pendiente_org_empresa_uq
  on dominio.cotizacion_pendiente (organizacion_id, (coalesce(empresa_id, '00000000-0000-0000-0000-000000000000'::uuid)));

alter table dominio.cotizacion_aplicada alter column organizacion_id set not null;
alter table dominio.cotizacion_aplicada drop constraint cotizacion_aplicada_pkey;
alter table dominio.cotizacion_aplicada add column empresa_id uuid;
alter table dominio.cotizacion_aplicada
  add constraint cotizacion_aplicada_empresa_fk
  foreign key (empresa_id, organizacion_id) references dominio.empresas (id, organizacion_id) on delete cascade;
create unique index cotizacion_aplicada_org_empresa_uq
  on dominio.cotizacion_aplicada (organizacion_id, (coalesce(empresa_id, '00000000-0000-0000-0000-000000000000'::uuid)));

alter table dominio.cotizaciones add column empresa_id uuid;
alter table dominio.cotizaciones add column umbral_pct numeric(7, 3);
alter table dominio.cotizaciones
  add constraint cotizaciones_empresa_fk
  foreign key (empresa_id, organizacion_id) references dominio.empresas (id, organizacion_id);
create index cotizaciones_org_empresa_cargada_idx
  on dominio.cotizaciones (organizacion_id, empresa_id, cargada_en desc, id);

comment on column dominio.cotizacion_pendiente.empresa_id is 'F-PRE-06: empresa dueña de la carga con alcance «empresa»; nulo con alcance «sistema».';
comment on column dominio.cotizacion_aplicada.empresa_id is 'F-PRE-06: empresa dueña de la cotización aplicada con alcance «empresa»; nulo = la general.';
comment on column dominio.cotizaciones.empresa_id is 'F-PRE-06: empresa de la carga con alcance «empresa»; nulo = carga general (todas las anteriores a F-PRE-06).';
comment on column dominio.cotizaciones.umbral_pct is 'F-PRE-06: umbral de recálculo (%) vigente cuando se confirmó la carga; nulo en las anteriores (rigió 1 %).';

-- La carga (invoker) escribe la empresa de la pendiente.
grant insert (empresa_id) on dominio.cotizacion_pendiente to authenticated;

-- ---------------------------------------------------------------------------
-- Lectura de la cotización
-- ---------------------------------------------------------------------------

create or replace function private.cotizacion_para(p_organizacion uuid, p_empresa uuid default null)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (select a.valor from dominio.cotizacion_aplicada a
      where p_empresa is not null and a.organizacion_id = p_organizacion and a.empresa_id = p_empresa
        and (select k.alcance from private.cotizacion_config(p_organizacion) k) = 'empresa'),
    (select a.valor from dominio.cotizacion_aplicada a
      where a.organizacion_id = p_organizacion and a.empresa_id is null),
    (select c.valor from dominio.cotizacion_inicial c where c.organizacion_id = p_organizacion)
  );
$$;

comment on function private.cotizacion_para(uuid, uuid) is
  'F-PRE-06: único punto de lectura de la cotización aplicada. Alcance «empresa»: la de la empresa (o la general si aún no tiene); alcance «sistema»: la general; sin ninguna, la inicial; sin cotización → null.';

create or replace function private.a_pesos(p_importe numeric, p_moneda text, p_organizacion uuid)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when p_importe is null then null
    when p_moneda = 'ARS' then p_importe
    when p_moneda = 'USD' then round(p_importe * private.cotizacion_para(p_organizacion, null), 2)
    else null
  end;
$$;

comment on function private.a_pesos(numeric, text, uuid) is
  'F-PRE-01/F-PRE-03/F-PRE-06: importe en pesos con la cotización GENERAL de la organización. ARS tal cual; USD × cotización; sin cotización → null.';

create or replace function private.a_pesos(p_importe numeric, p_moneda text, p_organizacion uuid, p_empresa uuid)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when p_importe is null then null
    when p_moneda = 'ARS' then p_importe
    when p_moneda = 'USD' then round(p_importe * private.cotizacion_para(p_organizacion, p_empresa), 2)
    else null
  end;
$$;

comment on function private.a_pesos(numeric, text, uuid, uuid) is
  'F-PRE-06: importe en pesos con la cotización que corresponde a la empresa según el alcance (ver private.cotizacion_para); sin cotización → null.';

create or replace function private.cotizacion_vigente(p_organizacion uuid)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (select c.valor from dominio.cotizaciones c
      where c.organizacion_id = p_organizacion and c.empresa_id is null
      order by c.cargada_en desc, c.id desc limit 1),
    (select i.valor from dominio.cotizacion_inicial i where i.organizacion_id = p_organizacion)
  );
$$;

comment on function private.cotizacion_vigente(uuid) is
  'F-PRE-03/F-PRE-06: cotización GENERAL contra la que se mide la variación (última confirmada sin empresa o la inicial); null si no hay ninguna.';

create or replace function private.cotizacion_vigente_para(p_organizacion uuid, p_empresa uuid)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when p_empresa is not null and (select k.alcance from private.cotizacion_config(p_organizacion) k) = 'empresa' then
      coalesce(
        -- Lo más reciente entre su última carga y su valor aplicado: al volver a alcance «empresa» el valor
        -- inicial (cotizacion_aplicada) es posterior al historial viejo de la empresa y es el que rige.
        (select x.valor from (
           (select c.valor, c.cargada_en as desde from dominio.cotizaciones c
             where c.organizacion_id = p_organizacion and c.empresa_id = p_empresa
             order by c.cargada_en desc, c.id desc limit 1)
           union all
           (select a.valor, a.aplicada_en from dominio.cotizacion_aplicada a
             where a.organizacion_id = p_organizacion and a.empresa_id = p_empresa)
         ) x order by x.desde desc limit 1),
        private.cotizacion_vigente(p_organizacion)
      )
    else private.cotizacion_vigente(p_organizacion)
  end;
$$;

comment on function private.cotizacion_vigente_para(uuid, uuid) is
  'F-PRE-06: cotización vigente de la empresa (su última carga confirmada o su valor inicial) con alcance «empresa»; la general con alcance «sistema».';

revoke execute on function private.cotizacion_para(uuid, uuid) from public, anon;
revoke execute on function private.a_pesos(numeric, text, uuid, uuid) from public, anon;
revoke execute on function private.cotizacion_vigente_para(uuid, uuid) from public, anon, authenticated;
grant execute on function private.cotizacion_para(uuid, uuid) to authenticated;
grant execute on function private.a_pesos(numeric, text, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Precio neto por empresa: convierte con la cotización de la empresa
-- ---------------------------------------------------------------------------

create or replace function private.precio_neto_empresa(p_producto uuid, p_empresa uuid)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select private.aplicar_regla_precio(
    private.a_pesos(p.precio_lista, p.moneda, p.organizacion_id, e.id),
    coalesce(r.base, 'central'), coalesce(r.ajuste_pct, 0), coalesce(r.redondeo_pesos, 10)
  )
  from dominio.productos p
  join dominio.empresas e on e.id = p_empresa and e.organizacion_id = p.organizacion_id
  left join dominio.precios_empresa r on r.empresa_id = e.id and r.organizacion_id = e.organizacion_id
  where p.id = p_producto;
$$;

comment on function private.precio_neto_empresa(uuid, uuid) is
  'F-PRE-07/F-PRE-06: precio neto (sin IVA, en pesos) de un producto para una empresa, con la cotización de esa empresa según el alcance; null si USD sin cotización o empresa ajena.';

create or replace view public.precios_empresa_neto
with (security_invoker = true)
as
select
  p.id as producto_id,
  e.id as empresa_id,
  p.organizacion_id,
  p.nombre,
  p.sku,
  p.moneda,
  x.central as central_ars,
  private.aplicar_regla_precio(
    x.central, coalesce(r.base, 'central'), coalesce(r.ajuste_pct, 0), coalesce(r.redondeo_pesos, 10)
  ) as neto_ars
from dominio.productos p
join dominio.empresas e on e.organizacion_id = p.organizacion_id
left join dominio.precios_empresa r on r.empresa_id = e.id and r.organizacion_id = e.organizacion_id
cross join lateral (select private.a_pesos(p.precio_lista, p.moneda, p.organizacion_id, e.id) as central) x
where (select private.nivel_seccion('empresas')) in ('lectura', 'edicion');

comment on view public.precios_empresa_neto is
  'F-PRE-07/F-PRE-06: central y neto en pesos (sin IVA) por producto y empresa, con la cotización de la empresa según el alcance. Solo con la sección empresas.';

-- ---------------------------------------------------------------------------
-- Analítica: la cotización «más cercana» es la general
-- ---------------------------------------------------------------------------

create or replace function analitica.cotizacion_cercana(p_organizacion uuid, p_fecha timestamptz)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select c.valor
  from dominio.cotizaciones c
  where c.organizacion_id = p_organizacion and c.empresa_id is null
  order by abs(extract(epoch from (c.cargada_en - p_fecha))), c.cargada_en, c.id
  limit 1;
$$;
