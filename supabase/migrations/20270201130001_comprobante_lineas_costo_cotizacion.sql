-- F-REN-09 (MSF-223, épica MSF-192, spec 20270201-100000-rentabilidad-real-y-reportes-de-ventas, FR-006):
-- columnas `costo_unitario` y `cotizacion` en `dominio.comprobantes_venta_lineas`.
--
-- Esquema (Principio VII): re-verificado. Son datos de la venta (qué costaba lo vendido y con qué dólar) →
-- siguen en `dominio`, la misma tabla; no hay tabla nueva ni política nueva. Misma RLS vigente (organización
-- y sección `ventas`); `authenticated` sigue sin INSERT/UPDATE/DELETE. Las escribe solo
-- `public.confirmar_comprobante` (20270201110100) y el trigger que copia el costo a las notas de crédito.
--
-- `costo_unitario` = costo del producto en PESOS por unidad al confirmar; `cotizacion` = dólar vigente de la
-- organización en ese momento. Ambas nulables: las ventas confirmadas antes de esta migración NO tienen costo
-- guardado y quedan fuera del margen real (no se inventa costo).
--
-- Un `select` de `authenticated` sobre la tabla ve estas columnas con la política de `ventas`: el costo es
-- secreto de `rentabilidad`, así que se REVOCA el `select` de tabla y se concede columna por columna sin
-- las dos nuevas (los roles sin `rentabilidad` nunca las leen; la vista de analitica las lee con el dueño).
--
-- Migración aditiva. Reversión (migración posterior, nunca en el mismo PR que la crea):
--   grant select on dominio.comprobantes_venta_lineas to authenticated;
--   alter table dominio.comprobantes_venta_lineas drop column cotizacion, drop column costo_unitario;

alter table dominio.comprobantes_venta_lineas
  add column if not exists costo_unitario numeric(14, 2) check (costo_unitario is null or costo_unitario >= 0),
  add column if not exists cotizacion numeric(14, 4) check (cotizacion is null or cotizacion > 0);

comment on column dominio.comprobantes_venta_lineas.costo_unitario is
  'F-REN-09: costo del producto en pesos por unidad al confirmar la factura. null en ventas anteriores o sin costo cargado. Secreto de la sección rentabilidad.';
comment on column dominio.comprobantes_venta_lineas.cotizacion is
  'F-REN-09: cotización del dólar de la organización vigente al confirmar. null si no había cotización cargada.';

-- Costo oculto a quien solo tiene `ventas`: select por columna, sin las dos nuevas.
do $$
declare
  v_cols text;
begin
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into v_cols
    from pg_attribute a
   where a.attrelid = 'dominio.comprobantes_venta_lineas'::regclass
     and a.attnum > 0 and not a.attisdropped
     and a.attname not in ('costo_unitario', 'cotizacion');
  execute 'revoke select on dominio.comprobantes_venta_lineas from authenticated';
  execute format('grant select (%s) on dominio.comprobantes_venta_lineas to authenticated', v_cols);
end $$;
