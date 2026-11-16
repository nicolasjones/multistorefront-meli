-- F-SVC-13 (MSF-418, épica MSF-232, spec 20261028-100000-service-cobro-y-avisos, FR-001, FR-002):
-- vínculo de origen de un comprobante de Ventas.
--
-- Esquema (Principio VII): `dominio.comprobantes_venta` ya es dominio del producto; solo se agregan columnas.
-- Sin tablas nuevas, sin cambio de RLS.
--
-- `origen_tipo` + `origen_id` dicen de qué documento nació el comprobante (hoy solo una reparación de Service).
-- No es FK: el origen vive en otra tabla de `dominio` y el tipo puede crecer. Ambas columnas van juntas o
-- ninguna. El índice único parcial impide dos comprobantes vigentes (no anulados) del mismo origen, también
-- bajo concurrencia (FR-002). Una factura anulada libera el origen: se puede generar una nueva.
-- Nada las escribe salvo `generar_comprobante_reparacion`; no son editables desde la app (FR-006).
--
-- Migración aditiva. Reversión (migración posterior; exportar antes los datos de origen):
--   drop index dominio.comprobantes_venta_origen_vigente_uk;
--   alter table dominio.comprobantes_venta drop constraint comprobantes_venta_origen_check;
--   alter table dominio.comprobantes_venta drop column origen_id, drop column origen_tipo;

-- DDL idempotente: una aplicación parcial no traba el reintento (regla del repo).
alter table dominio.comprobantes_venta
  add column if not exists origen_tipo text,
  add column if not exists origen_id uuid;

alter table dominio.comprobantes_venta
  drop constraint if exists comprobantes_venta_origen_tipo_check;
alter table dominio.comprobantes_venta
  drop constraint if exists comprobantes_venta_origen_check;

alter table dominio.comprobantes_venta
  add constraint comprobantes_venta_origen_tipo_check check (origen_tipo in ('reparacion')),
  add constraint comprobantes_venta_origen_check check ((origen_tipo is null) = (origen_id is null));

create unique index if not exists comprobantes_venta_origen_vigente_uk
  on dominio.comprobantes_venta (organizacion_id, origen_tipo, origen_id)
  where origen_tipo is not null and estado <> 'anulada';

comment on column dominio.comprobantes_venta.origen_tipo is
  'F-SVC-13: tipo del documento de origen (hoy solo «reparacion»). Nulo en los comprobantes cargados en Ventas.';
comment on column dominio.comprobantes_venta.origen_id is
  'F-SVC-13: id del documento de origen (la reparación de Service). Solo lo escribe generar_comprobante_reparacion.';
