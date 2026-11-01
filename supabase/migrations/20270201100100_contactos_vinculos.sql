-- MSF-260 · F-CON-05 (FR-007): vínculo consulta→contacto y comprobante→contacto.
--
-- Esquema (Principio VII): sin tablas nuevas. `contacto_id` es una columna aditiva nullable sobre
-- `dominio.consultas` y `dominio.comprobantes_venta` (dominio, existentes); hereda su RLS. La vista
-- `public.consultas_bandeja` (superficie de lectura, `public`) suma `contacto_id` AL FINAL: cambio aditivo.
-- La FK compuesta `(contacto_id, organizacion_id)` impide apuntar a un contacto de otra organización;
-- la regla «misma empresa» la valida la RPC de vínculo.
--
-- Migración aditiva. Reversión (migración posterior):
--   create or replace view public.consultas_bandeja ... (definición de 20261205100300, sin contacto_id)
--     -- Postgres no permite quitar una columna con create or replace: `drop view` y recrear.
--   drop index dominio.consultas_contacto_id_idx; drop index dominio.comprobantes_venta_contacto_id_idx;
--   alter table dominio.consultas drop constraint consultas_contacto_fk, drop column contacto_id;
--   alter table dominio.comprobantes_venta drop constraint comprobantes_venta_contacto_fk, drop column contacto_id;

alter table dominio.consultas
  add column if not exists contacto_id uuid,
  add constraint consultas_contacto_fk foreign key (contacto_id, organizacion_id)
    references dominio.contactos (id, organizacion_id);

alter table dominio.comprobantes_venta
  add column if not exists contacto_id uuid,
  add constraint comprobantes_venta_contacto_fk foreign key (contacto_id, organizacion_id)
    references dominio.contactos (id, organizacion_id);

create index if not exists consultas_contacto_id_idx on dominio.consultas (contacto_id) where contacto_id is not null;
create index if not exists comprobantes_venta_contacto_id_idx on dominio.comprobantes_venta (contacto_id) where contacto_id is not null;

create or replace view public.consultas_bandeja
with (security_invoker = true) as
select
  c.id,
  c.empresa_id,
  e.nombre as empresa_nombre,
  c.origen,
  c.nombre,
  c.contacto,
  c.mensaje,
  c.producto_id,
  private.nombre_producto_consulta(c.producto_id) as producto_nombre,
  c.estado,
  c.responsable_id,
  private.nombre_responsable_consulta(c.responsable_id) as responsable_nombre,
  c.nota_interna,
  c.created_at,
  c.updated_at,
  c.contacto_id
from dominio.consultas c
join dominio.empresas e on e.id = c.empresa_id and e.organizacion_id = c.organizacion_id;

revoke all on public.consultas_bandeja from public, anon, authenticated;
grant select on public.consultas_bandeja to authenticated;
