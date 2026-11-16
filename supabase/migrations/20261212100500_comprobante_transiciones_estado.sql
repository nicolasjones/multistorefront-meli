-- F-VTA-10 (MSF-365, épica MSF-177, spec 20261024-130000-ventas-listado-estados-y-anulacion, FR-020):
-- `dominio.transiciones_estado_comprobante`, la matriz de «qué estado puede pasar a cuál y qué rol puede hacerlo».
--
-- Esquema (Principio VII): **`dominio`**. Es una regla de negocio de ventas (no plataforma): define el flujo del
-- documento de venta de la organización.
-- RLS por organización; `select` con `ventas` ≥ `lectura`. SIN escritura directa: ni `insert`/`update`/`delete`
-- para `authenticated`; la siembra la hace `private.sembrar_transiciones_comprobante` (T002) y la edición por
-- pantalla es Etapa 2. `anon` sin privilegios.
--
-- Estados: los del panel (`pendiente`, `aceptado`, `cobrado`, `en_proceso`, `deuda`, `armando`, `incompleto`,
-- `anulada`) más `confirmada`/`borrador` de MSF-159. Una factura confirmada se guarda como `confirmada` y el
-- panel la muestra «Pendiente» (spec, Decisiones abiertas 3); por eso la matriz de facturas parte de `confirmada`.
-- Rol: los de la organización más `sistema` (Cobrado/Deuda los dispara cobros, no una persona).
--
-- Migración aditiva. Reversión (migración posterior; no hay datos de negocio que perder, la matriz se resiembra):
--   drop table dominio.transiciones_estado_comprobante;

create table if not exists dominio.transiciones_estado_comprobante (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  tipo text not null check (tipo in ('factura', 'presupuesto')),
  estado_desde text not null,
  estado_hasta text not null,
  rol_id text not null,
  creado_en timestamptz not null default now(),
  constraint transiciones_estado_desde_ck check (estado_desde in (
    'borrador', 'confirmada', 'pendiente', 'aceptado', 'cobrado', 'en_proceso', 'deuda', 'armando', 'incompleto', 'anulada'
  )),
  constraint transiciones_estado_hasta_ck check (estado_hasta in (
    'borrador', 'confirmada', 'pendiente', 'aceptado', 'cobrado', 'en_proceso', 'deuda', 'armando', 'incompleto', 'anulada'
  )),
  constraint transiciones_estado_distinto_ck check (estado_desde <> estado_hasta),
  constraint transiciones_estado_rol_ck check (rol_id in (
    'administrador', 'administracion', 'operador', 'mostrador', 'deposito', 'tecnico', 'consulta', 'sistema'
  )),
  constraint transiciones_estado_uq unique (organizacion_id, tipo, estado_desde, estado_hasta, rol_id)
);

comment on table dominio.transiciones_estado_comprobante is
  'Matriz de transiciones de estado del documento de venta por organización y rol (F-VTA-10, FR-020). Solo la escribe la siembra; la edición por pantalla es Etapa 2.';

create index if not exists transiciones_estado_comprobante_org_idx
  on dominio.transiciones_estado_comprobante (organizacion_id, tipo, estado_desde);

alter table dominio.transiciones_estado_comprobante enable row level security;

create policy transiciones_estado_comprobante_select on dominio.transiciones_estado_comprobante
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('ventas')) in ('lectura', 'edicion')
  );

grant usage on schema dominio to authenticated;
revoke all on dominio.transiciones_estado_comprobante from public, anon, authenticated;
grant select on dominio.transiciones_estado_comprobante to authenticated;
