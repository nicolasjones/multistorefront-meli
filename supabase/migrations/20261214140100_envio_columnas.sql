-- F-VTA-16 (MSF-166, épica MSF-135, spec 20261024-130000-ventas-despacho-y-faltantes, FR-020):
-- transporte, guía y fecha de envío del comprobante de venta.
--
-- La factura que sale con transporte lo registra con su guía y fecha de envío (US2). Las tres columnas son
-- aditivas: `dominio.comprobantes_venta` ya existe (F-CLI-08) y no se le toca ninguna columna previa.
--
-- Esquema (Principio VII), verificado tabla por tabla:
--   dominio.comprobantes_venta    dominio (existente, documento de venta)  se altera SOLO de forma aditiva:
--                                                                           sin tablas nuevas y sin columnas
--                                                                           destruidas.
--   dominio.transportes           dominio (existente, catálogo F-VTA-04)     solo se referencia: la FK compuesta.
--   dominio.transportes_empresas  dominio (existente, F-VTA-04)             solo se lee en la RPC que guarda
--                                                                           el envío (T014).
-- Las RPC viven en `public` (migración siguiente).
--
-- RLS vigente (select por organización y sección `ventas`); SIN políticas ni grants de escritura nuevos:
-- el transporte, la guía y la fecha de envío se escriben solo por la RPC `security definer`
-- `guardar_envio_comprobante` (T014). `anon` sin acceso.
--
-- La FK es COMPUESTA (`transporte_id`, `organizacion_id` → `dominio.transportes (id, organizacion_id)`): un
-- comprobante no puede apuntar a un transporte de otra organización. `dominio.transportes` tiene el `unique
-- (id, organizacion_id)` que la habilita y NO tiene política ni grant de DELETE (los transportes se desactivan,
-- no se borran), así que la FK no necesita cascada: `restrict` implícito.
--
-- Migración aditiva. Reversión (en una migración posterior; los envíos ya cargados NO se deshacen solos:
-- exportarlos antes):
--   alter table dominio.comprobantes_venta
--     drop constraint if exists comprobantes_venta_transporte_fk,
--     drop constraint if exists comprobantes_venta_guia_ck,
--     drop column if exists transporte_id,
--     drop column if exists guia,
--     drop column if exists fecha_envio;

alter table dominio.comprobantes_venta
  add column if not exists transporte_id uuid,
  add column if not exists guia text,
  add column if not exists fecha_envio date;

do $$
begin
  -- El transporte tiene que ser de la organización del comprobante.
  if not exists (
    select 1 from pg_constraint
    where conname = 'comprobantes_venta_transporte_fk'
      and conrelid = 'dominio.comprobantes_venta'::regclass
  ) then
    alter table dominio.comprobantes_venta
      add constraint comprobantes_venta_transporte_fk
      foreign key (transporte_id, organizacion_id)
        references dominio.transportes (id, organizacion_id);
  end if;

  -- La guía es un texto corto: el número de seguimiento que da el transporte.
  if not exists (
    select 1 from pg_constraint
    where conname = 'comprobantes_venta_guia_ck'
      and conrelid = 'dominio.comprobantes_venta'::regclass
  ) then
    alter table dominio.comprobantes_venta
      add constraint comprobantes_venta_guia_ck
      check (guia is null or length(btrim(guia)) <= 100);
  end if;
end
$$;

comment on column dominio.comprobantes_venta.transporte_id is
  'Transporte con el que sale la factura (F-VTA-16, FR-020). FK compuesta a dominio.transportes: el transporte tiene que ser de la misma organización.';
comment on column dominio.comprobantes_venta.guia is
  'Guía o número de seguimiento del transporte (F-VTA-16, FR-020). Texto de hasta 100 caracteres.';
comment on column dominio.comprobantes_venta.fecha_envio is
  'Fecha en que salió la factura (F-VTA-16, FR-020).';
