-- F-SVC-21 (MSF-146, épica MSF-124): vínculo de garantía entre reparaciones.
-- Esquema (Principio VII): se altera `dominio.reparaciones` (entidad central del producto → `dominio`,
-- sin cambio de esquema). RLS vigente; sin tablas nuevas.
--
-- `reparacion_origen_id` apunta a la reparación entregada de la que viene un reingreso por garantía.
-- FK compuesta con la organización (no se apunta a una reparación ajena) y `check` anti-autorreferencia.
-- Solo `select` por columna: la fija únicamente `public.reingresar_por_garantia` (security definer); no
-- hay grant de insert/update para roles de API.
--
-- Migración aditiva. Reversión (migración posterior; exportar antes los vínculos):
--   drop index dominio.reparaciones_origen_idx;
--   alter table dominio.reparaciones drop constraint reparaciones_origen_distinta_check;
--   alter table dominio.reparaciones drop constraint reparaciones_origen_fk;
--   alter table dominio.reparaciones drop column reparacion_origen_id;

alter table dominio.reparaciones add column reparacion_origen_id uuid;

alter table dominio.reparaciones
  add constraint reparaciones_origen_fk foreign key (reparacion_origen_id, organizacion_id)
    references dominio.reparaciones (id, organizacion_id),
  add constraint reparaciones_origen_distinta_check check (reparacion_origen_id <> id);

create index reparaciones_origen_idx on dominio.reparaciones (reparacion_origen_id)
  where reparacion_origen_id is not null;

comment on column dominio.reparaciones.reparacion_origen_id is
  'F-SVC-21: reparación entregada de la que viene este reingreso por garantía. Solo la fija reingresar_por_garantia.';

grant select (reparacion_origen_id) on dominio.reparaciones to authenticated;
