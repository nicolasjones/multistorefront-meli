-- MSF-361 · F-INI-02 (épica MSF-156, spec 20261030-100000-inicio-y-alertas, FR-020, FR-023, FR-024):
-- alertas accionables de Inicio y registro del último cálculo por organización.
--
-- Esquema (Principio VII), verificado tabla por tabla:
--   dominio.alertas_inicio          dominio (nueva)  una fila por alerta calculada (tipo, sección de origen,
--                                                    cantidad, enlace): dato del producto → `dominio`.
--   dominio.alertas_inicio_calculos dominio (nueva)  una fila por organización con la fecha del último
--                                                    cálculo y la cantidad de alertas (auditoría, FR-022, y
--                                                    base del aviso de demora aunque no haya alertas, FR-024).
--
-- Seguridad:
--   * RLS por organización. `alertas_inicio`: solo se lee la fila cuya sección el rol ve con ≥ lectura y
--     cuya empresa es accesible (`private.empresas_accesibles()`); las alertas de la organización entera
--     llevan `empresa_id` nulo. `alertas_inicio_calculos`: la organización de la sesión, y solo las
--     columnas organizacion_id y calculada_en (grant por columna; la cantidad total mezcla secciones).
--   * SIN insert, update ni delete desde la app: escribe únicamente `public.recalcular_alertas_inicio`
--     (service_role, migración 20270115100100). `anon` sin privilegios.
--   * Los enlaces salen de una lista cerrada de rutas (check), nunca de texto libre (FR-025).
--
-- Migración aditiva. Reversión (migración posterior; antes revertir 20270115100100 y 20270115100200):
--   drop table dominio.alertas_inicio_calculos;
--   drop table dominio.alertas_inicio;

create table dominio.alertas_inicio (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  -- Nulo = alerta de la organización entera (stock y dólar son de la organización).
  empresa_id uuid,
  tipo text not null
    check (tipo in ('sin_stock', 'stock_bajo', 'consultas_sin_atender', 'dolar_sin_cargar', 'margen_negativo')),
  seccion text not null
    check (seccion in ('stock', 'consultas', 'cotizacion_dolar', 'rentabilidad')),
  cantidad integer not null check (cantidad > 0),
  -- Producto puntual cuando la alerta se refiere a uno solo.
  referencia_id uuid,
  enlace text not null
    check (enlace in ('/stock', '/consultas', '/cotizacion', '/rentabilidad/productos')),
  calculada_en timestamptz not null default now(),
  constraint alertas_inicio_empresa_fk foreign key (empresa_id, organizacion_id)
    references dominio.empresas (id, organizacion_id) on delete cascade,
  -- Cada tipo pertenece a una sola sección y lleva a una sola pantalla.
  constraint alertas_inicio_tipo_coherente check (
    (tipo in ('sin_stock', 'stock_bajo') and seccion = 'stock' and enlace = '/stock' and empresa_id is null)
    or (tipo = 'consultas_sin_atender' and seccion = 'consultas' and enlace = '/consultas' and empresa_id is not null)
    or (tipo = 'dolar_sin_cargar' and seccion = 'cotizacion_dolar' and enlace = '/cotizacion' and empresa_id is null)
    or (tipo = 'margen_negativo' and seccion = 'rentabilidad' and enlace = '/rentabilidad/productos' and empresa_id is not null)
  )
);

comment on table dominio.alertas_inicio is
  'F-INI-02: alertas accionables de Inicio. Solo las escribe public.recalcular_alertas_inicio (service_role, flow de Kestra); la app lee por public.alertas_inicio_visibles.';

-- Una alerta por tipo y empresa (la de la organización entera usa el uuid nulo como clave).
create unique index alertas_inicio_unica_idx
  on dominio.alertas_inicio (organizacion_id, tipo, coalesce(empresa_id, '00000000-0000-0000-0000-000000000000'::uuid));

create index alertas_inicio_empresa_idx on dominio.alertas_inicio (empresa_id) where empresa_id is not null;

create table dominio.alertas_inicio_calculos (
  organizacion_id uuid primary key references public.organizaciones (id) on delete cascade,
  calculada_en timestamptz not null,
  alertas integer not null check (alertas >= 0)
);

comment on table dominio.alertas_inicio_calculos is
  'F-INI-02: último cálculo de alertas de cada organización (fecha y cantidad). La app solo lee calculada_en.';

alter table dominio.alertas_inicio enable row level security;
alter table dominio.alertas_inicio_calculos enable row level security;

create policy alertas_inicio_select on dominio.alertas_inicio
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion(seccion)) in ('lectura', 'edicion')
    and (empresa_id is null or empresa_id in (select private.empresas_accesibles()))
  );

create policy alertas_inicio_calculos_select on dominio.alertas_inicio_calculos
  for select to authenticated
  using (organizacion_id = (select private.organizacion_id()));

revoke all on dominio.alertas_inicio from public, anon, authenticated;
revoke all on dominio.alertas_inicio_calculos from public, anon, authenticated;
grant select on dominio.alertas_inicio to authenticated;
grant select (organizacion_id, calculada_en) on dominio.alertas_inicio_calculos to authenticated;
