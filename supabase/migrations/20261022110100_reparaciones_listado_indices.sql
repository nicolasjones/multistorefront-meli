-- F-SVC-04 (MSF-342, épica MSF-199): índices del listado de reparaciones.
-- Esquema: sin tablas nuevas; los índices son de `dominio.reparaciones` (Principio VII).
--
--   * (organizacion_id, empresa_id, entrega_prevista): filtro por tienda + período sobre la entrega prevista.
--   * (organizacion_id, lower(numero_serie)) parcial sin nulos: búsqueda por N.º de serie sin distinguir
--     mayúsculas. El índice de técnico ya existe (`reparaciones_tecnico_idx`, 20261021164300).
--
-- Migración aditiva. Reversión (migración posterior):
--   drop index dominio.reparaciones_org_empresa_entrega_idx;
--   drop index dominio.reparaciones_org_serie_idx;

create index IF NOT EXISTS reparaciones_org_empresa_entrega_idx
  on dominio.reparaciones (organizacion_id, empresa_id, entrega_prevista);

create index IF NOT EXISTS reparaciones_org_serie_idx
  on dominio.reparaciones (organizacion_id, lower(numero_serie))
  where numero_serie is not null;
