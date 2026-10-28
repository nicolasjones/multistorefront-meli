-- F-VTA-15 (MSF-152, épica MSF-135, spec 20261024-130000-ventas-despacho-y-faltantes, FR-001):
-- estado de despacho y responsables del comprobante de venta.
--
-- Esquema (Principio VII), verificado tabla por tabla:
--   dominio.comprobantes_venta  dominio (existente, documento de venta)  se altera SOLO de forma aditiva:
--                                                                          ninguna tabla nueva, ninguna columna
--                                                                          destruida.
--   auth.users                  plataforma (autenticación)               solo se referencia: los responsables.
-- RLS vigente (select por organización y sección `ventas`); SIN políticas ni grants de escritura nuevos:
-- el estado de despacho y los responsables se escriben solo por RPC `security definer` (T005).
-- `anon` sin acceso.
--
-- `estado_despacho` es un campo PROPIO, separado del `estado` documental de MSF-159/MSF-177
-- (Decisiones abiertas 1 de la spec):
--   · `estado`          = borrador | confirmada | pendiente | aceptado | cobrado | en_proceso | deuda | armando |
--                        incompleto | anulada   (máquina documental de MSF-177, F-VTA-10).
--   · `estado_despacho` = sin_armar | armando | incompleto | listo_para_despachar | entregado
--                        (máquina de despacho de esta épica: armar, controlar, entregar).
-- Las dos comparten dos nombres (`armando`, `incompleto`) y viven en columnas distintas: el estado
-- documental no se mueve desde esta épica y el de despacho no se mueve desde MSF-177.
--
-- Migración aditiva. Reversión (en una migración posterior; los despachos hechos NO se deshacen
-- solos: exportarlos antes):
--   drop index if exists comprobantes_venta_despacho_idx;
--   alter table dominio.comprobantes_venta
--     drop constraint if exists comprobantes_venta_estado_despacho_ck,
--     drop constraint if exists comprobantes_venta_estado_despacho_factura_ck,
--     drop column if exists estado_despacho,
--     drop column if exists armo_id,
--     drop column if exists controlo_id,
--     drop column if exists entrego_id,
--     drop column if exists entregado_en;

alter table dominio.comprobantes_venta
  add column if not exists estado_despacho text,
  add column if not exists armo_id uuid references auth.users (id) on delete set null,
  add column if not exists controlo_id uuid references auth.users (id) on delete set null,
  add column if not exists entrego_id uuid references auth.users (id) on delete set null,
  add column if not exists entregado_en timestamptz;

-- Los cinco estados del despacho y el alcance (solo facturas). Se agregan con guardas para que una
-- aplicación parcial se pueda reintentar sin fallar.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'comprobantes_venta_estado_despacho_ck'
      and conrelid = 'dominio.comprobantes_venta'::regclass
  ) then
    alter table dominio.comprobantes_venta
      add constraint comprobantes_venta_estado_despacho_ck
      check (estado_despacho is null or estado_despacho in (
        'sin_armar', 'armando', 'incompleto', 'listo_para_despachar', 'entregado'));
  end if;

  -- Un presupuesto nunca entra al despacho: si tiene estado de despacho, es una factura.
  if not exists (
    select 1 from pg_constraint
    where conname = 'comprobantes_venta_estado_despacho_factura_ck'
      and conrelid = 'dominio.comprobantes_venta'::regclass
  ) then
    alter table dominio.comprobantes_venta
      add constraint comprobantes_venta_estado_despacho_factura_ck
      check (estado_despacho is null or tipo = 'factura');
  end if;
end
$$;

-- Índice del tablero de despacho (F-VTA-17): facturas por empresa y por estado de despacho.
create index if not exists comprobantes_venta_despacho_idx
  on dominio.comprobantes_venta (organizacion_id, empresa_id, estado_despacho);

comment on column dominio.comprobantes_venta.estado_despacho is
  'Estado del despacho (F-VTA-15, FR-001): sin_armar, armando, incompleto, listo_para_despachar o entregado. Nulo hasta que la factura se confirma (FR-002) y solo en facturas; es distinto del `estado` documental de MSF-177.';
comment on column dominio.comprobantes_venta.armo_id is
  'Usuario que armó el pedido (F-VTA-15, FR-004). Referencia a auth.users: si se borra el usuario, queda nulo.';
comment on column dominio.comprobantes_venta.controlo_id is
  'Usuario que controló el pedido (F-VTA-15, FR-005). Referencia a auth.users: si se borra el usuario, queda nulo.';
comment on column dominio.comprobantes_venta.entrego_id is
  'Usuario que entregó el pedido (F-VTA-15, FR-006). Referencia a auth.users: si se borra el usuario, queda nulo.';
comment on column dominio.comprobantes_venta.entregado_en is
  'Momento de la entrega (F-VTA-15, FR-006). Lo fija la RPC de cambio de estado (T005).';
