-- MSF-161 · F-VTA-27 (MSF-270, spec 20261110-100000-ventas-avisos-de-faltantes, FR-101, FR-102):
-- columnas de «Para avisar» en los faltantes de venta.
--
-- Esquema (Principio VII), verificado objeto por objeto:
--   dominio.faltantes_venta        dominio (existente)  se le suman `para_avisar_en` y `para_avisar_ingreso_id`.
--   dominio.ingresos_mercaderia    dominio (existente)  solo se referencia (FK `on delete set null`).
-- Ninguna tabla se crea: la exportación total no cambia (`faltantes_venta` ya se exporta completa, sin lista
-- fija de columnas). Las columnas nuevas heredan la RLS de su tabla (lectura por organización y tienda; sin
-- escritura para `authenticated`; `anon` sin privilegios).
--
-- `para_avisar_en` es el momento en que un ingreso de mercadería cubrió el faltante; no es un aviso enviado
-- (eso vive en `dominio.faltantes_avisos`). Es una sugerencia, no historial: anular el ingreso no la quita.
--
-- Migración aditiva e idempotente (`if not exists`). Reversión (migración posterior):
--   drop index if exists dominio.faltantes_venta_para_avisar_ingreso_idx;
--   drop index if exists dominio.faltantes_venta_cobertura_idx;
--   alter table dominio.faltantes_venta drop column if exists para_avisar_ingreso_id,
--     drop column if exists para_avisar_en;

alter table dominio.faltantes_venta
  add column if not exists para_avisar_en timestamptz,
  add column if not exists para_avisar_ingreso_id uuid references dominio.ingresos_mercaderia (id) on delete set null;

comment on column dominio.faltantes_venta.para_avisar_en is
  'F-VTA-27: momento en que un ingreso de mercadería cubrió el faltante (queda «Para avisar»). No envía nada.';
comment on column dominio.faltantes_venta.para_avisar_ingreso_id is
  'F-VTA-27: ingreso de mercadería que originó la marca «Para avisar». Nulo si se borra el ingreso.';

-- La cobertura recorre los abiertos sin marca de un producto por antigüedad.
create index if not exists faltantes_venta_cobertura_idx
  on dominio.faltantes_venta (organizacion_id, producto_id, creado_en, id)
  where estado = 'abierto' and para_avisar_en is null;

-- Índice de la FK (la baja de un ingreso busca los faltantes que lo referencian).
create index if not exists faltantes_venta_para_avisar_ingreso_idx
  on dominio.faltantes_venta (para_avisar_ingreso_id)
  where para_avisar_ingreso_id is not null;
