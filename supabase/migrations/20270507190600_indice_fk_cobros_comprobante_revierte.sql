-- MSF-918 (lote 33, integración con el lote 32): la FK compuesta `cobros_comprobante_revierte_fk`
-- (revierte_cobro_id, organizacion_id) del contra-asiento de cobros (20270507180100) solo tiene el índice único PARCIAL
-- `cobros_comprobante_revierte_uq (revierte_cobro_id) where revierte_cobro_id is not null`. La prueba global de higiene exige
-- un índice no parcial que cubra la FK (cada baja/cambio de un cobro del padre la usa); se cubre con un índice propio, sin
-- tocar la migración del lote 32. Mismo criterio y mismo motivo para no usar `concurrently` que en 20270507190100.
--
-- Migración aditiva. Reversión (migración posterior): drop index if exists dominio.cobros_comprobante_revierte_cobro_id_organizacion_id_fk_idx;

create index if not exists cobros_comprobante_revierte_cobro_id_organizacion_id_fk_idx
  on dominio.cobros_comprobante (revierte_cobro_id, organizacion_id);
