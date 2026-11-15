-- MSF-467 · Opiniones de productos, Fase 1 «Base» (T001). RF-OPI-1, RF-OPI-4, D8, D11, D15.
--
-- Esquemas (Principio VII, re-verificado objeto por objeto):
--   * dominio.opiniones_producto (tabla nueva) -> `dominio`: contenido de negocio sobre un producto del catálogo de una tienda,
--     no plataforma. Se ata a la cuenta web (identidad, `public`), a la tienda y al producto.
--   * public.banderas_plataforma (tabla existente, una fila nueva) -> `public`: bandera de plataforma por entorno.
--
-- Aislamiento (D8): FK compuestas (cuenta, organización, empresa) -> public.cuentas_cliente, (empresa, organización) ->
-- dominio.empresas y (producto, organización) -> dominio.productos, todas `on delete cascade`: una fila no puede mezclar
-- organizaciones ni apuntar a una tienda distinta de la de su cuenta.
--
-- Acceso: RLS ACTIVADA sin ninguna política y SIN privilegios para `public`, `anon` ni `authenticated` (como favoritos_cliente):
-- solo las RPC `security definer` leen y escriben. `service_role` conserva el patrón de las tablas operativas de `dominio`
-- (siembra, E2E, workers).
--
-- Bandera `tienda_opiniones`: APAGADA por defecto en todo entorno; esta migración no la enciende (D11). Esta fase no cambia nada
-- visible: ninguna pantalla pública ni RPC de la tienda usa la tabla.
--
-- Migración aditiva. Reversión (migración posterior; no se ejecuta en el mismo PR; exportar antes las opiniones):
--   delete from public.banderas_plataforma where clave = 'tienda_opiniones';
--   drop table if exists dominio.opiniones_producto;

create table if not exists dominio.opiniones_producto (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null,
  empresa_id uuid not null,
  cuenta_cliente_id uuid not null,
  producto_id uuid not null,
  puntuacion smallint not null,
  comentario text not null,
  estado text not null default 'pendiente',
  motivo_rechazo text,
  moderada_por uuid,
  moderada_en timestamptz,
  creada_en timestamptz not null default now(),
  actualizada_en timestamptz not null default now(),
  constraint opiniones_producto_cuenta_producto_uq unique (cuenta_cliente_id, producto_id),
  constraint opiniones_producto_puntuacion_ck check (puntuacion between 1 and 5),
  constraint opiniones_producto_comentario_ck check (char_length(btrim(comentario)) between 10 and 1000),
  constraint opiniones_producto_estado_ck check (estado in ('pendiente', 'aceptada', 'rechazada')),
  constraint opiniones_producto_motivo_ck check (
    motivo_rechazo is null or (estado = 'rechazada' and char_length(motivo_rechazo) between 1 and 200)
  ),
  constraint opiniones_producto_moderacion_ck check (
    (estado = 'pendiente' and moderada_por is null and moderada_en is null)
    or (estado <> 'pendiente' and moderada_por is not null and moderada_en is not null)
  ),
  constraint opiniones_producto_cuenta_fk
    foreign key (cuenta_cliente_id, organizacion_id, empresa_id)
    references public.cuentas_cliente (id, organizacion_id, empresa_id) on delete cascade,
  constraint opiniones_producto_empresa_fk
    foreign key (empresa_id, organizacion_id)
    references dominio.empresas (id, organizacion_id) on delete cascade,
  constraint opiniones_producto_producto_fk
    foreign key (producto_id, organizacion_id)
    references dominio.productos (id, organizacion_id) on delete cascade
);

-- Ficha pública: aceptadas de un producto en una tienda, nuevas primero (promedio y cantidad sin leer el texto).
create index if not exists opiniones_producto_ficha_idx
  on dominio.opiniones_producto (empresa_id, producto_id, creada_en desc, id desc)
  where estado = 'aceptada';
-- Panel de moderación: por organización, tienda y estado, nuevas primero (cursor por (creada_en, id)).
create index if not exists opiniones_producto_panel_idx
  on dominio.opiniones_producto (organizacion_id, empresa_id, estado, creada_en desc, id desc);
-- Panel sin filtro de tienda: orden global de la organización (cursor por (creada_en, id)) sin ordenar todas las filas.
create index if not exists opiniones_producto_orden_idx
  on dominio.opiniones_producto (organizacion_id, creada_en desc, id desc);
-- Apoyo de las FK compuestas (borrado en cascada de producto y de empresa).
create index if not exists opiniones_producto_producto_idx
  on dominio.opiniones_producto (producto_id, organizacion_id);

comment on table dominio.opiniones_producto is
  'MSF-467: opinión de una cuenta web sobre un producto de su tienda (1 a 5 estrellas y comentario), con moderación previa (pendiente/aceptada/rechazada). Sin privilegios de API ni políticas: solo las RPC security definer la leen y escriben. Gobernada por la bandera tienda_opiniones.';

alter table dominio.opiniones_producto enable row level security;

revoke all on dominio.opiniones_producto from public, anon, authenticated;

-- `service_role` (API admin: E2E, siembra, workers; nunca el navegador) opera las tablas operativas de `dominio`
-- (pgTAP `service_role_privilegios`). La API pública (`anon`, `authenticated`) sigue sin nada.
grant select, insert, update, delete on dominio.opiniones_producto to service_role;

insert into public.banderas_plataforma (clave, activa, descripcion) values
  ('tienda_opiniones', false, 'Opiniones de productos (MSF-467): moderación en el panel y, en fases posteriores, opiniones en la tienda. Apagada por defecto; solo se enciende en dev.')
on conflict (clave) do nothing;
