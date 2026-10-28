-- MSF-394 · F-STK-09 (épica MSF-368, spec 20261024-130000-stock-carga-exportacion-y-avisos, FR-207/FR-208):
-- registro del resumen de reposición por correo y marcas de los productos ya avisados.
--
-- Esquema (Principio VII), verificado tabla por tabla:
--   dominio.stock_avisos_reposicion  dominio (nueva)  registro de cada resumen (fecha, productos, estado,
--                                                     intentos, error útil): dato del producto → `dominio`.
--   dominio.stock_alertas_avisadas   dominio (nueva)  estado de alerta con el que ya se avisó cada
--                                                     producto (detecta «nuevo en alerta»): dato del
--                                                     producto → `dominio`.
--
-- Seguridad:
--   * RLS por organización; lectura solo con `stock` en lectura o edición.
--   * SIN insert, update ni delete desde la app: escriben únicamente las RPC de service_role de la
--     migración 20261212140100. `anon` sin privilegios.
--
-- Migración aditiva. Reversión (migración posterior; antes revertir 20261212140100):
--   drop table dominio.stock_alertas_avisadas;
--   drop table dominio.stock_avisos_reposicion;

create table dominio.stock_avisos_reposicion (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  generado_en timestamptz not null default now(),
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'enviado', 'fallido', 'sin_destinatario')),
  intentos integer not null default 0 check (intentos >= 0),
  ultimo_error text check (ultimo_error is null or length(ultimo_error) <= 500),
  enviado_en timestamptz,
  -- Foto de los productos incluidos: producto_id, nombre, sku, cantidad, disponible, minimo, estado.
  productos jsonb not null default '[]'::jsonb check (jsonb_typeof(productos) = 'array'),
  sin_stock integer not null default 0 check (sin_stock >= 0),
  stock_bajo integer not null default 0 check (stock_bajo >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table dominio.stock_avisos_reposicion is
  'F-STK-09: registro del resumen de reposición de cada organización (estado, intentos, error). Solo lo escriben las RPC de service_role de la función enviar-resumen-reposicion.';
comment on column dominio.stock_avisos_reposicion.updated_at is
  'Reserva del resumen: un resumen pendiente tomado hace menos de 2 minutos está en proceso.';

create index if not exists stock_avisos_reposicion_organizacion_idx
  on dominio.stock_avisos_reposicion (organizacion_id, generado_en desc);

create table dominio.stock_alertas_avisadas (
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  producto_id uuid not null references dominio.productos (id) on delete cascade,
  estado_avisado text not null check (estado_avisado in ('stock_bajo', 'sin_stock')),
  avisado_en timestamptz not null default now(),
  primary key (organizacion_id, producto_id)
);

comment on table dominio.stock_alertas_avisadas is
  'F-STK-09: estado de alerta con el que ya se avisó cada producto. Un producto sin marca (o con una menos grave) que está en alerta es «nuevo en alerta».';

alter table dominio.stock_avisos_reposicion enable row level security;
alter table dominio.stock_alertas_avisadas enable row level security;

create policy stock_avisos_reposicion_select on dominio.stock_avisos_reposicion
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('stock')) in ('lectura', 'edicion')
  );

create policy stock_alertas_avisadas_select on dominio.stock_alertas_avisadas
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('stock')) in ('lectura', 'edicion')
  );

revoke all on dominio.stock_avisos_reposicion from public, anon, authenticated;
revoke all on dominio.stock_alertas_avisadas from public, anon, authenticated;
grant select on dominio.stock_avisos_reposicion to authenticated;
grant select on dominio.stock_alertas_avisadas to authenticated;
