-- F-SVC-23 (MSF-168, épica MSF-124): vista `analitica.service_reparaciones` para el tablero «Service técnico».
-- Esquema (Principio VII): `analitica` es de SOLO vistas (sin tablas ni RLS, ver 20261130100200); esta vista
-- no almacena datos. Las tablas de origen siguen en `dominio` con su RLS.
--
-- Una fila por reparación. Aislamiento: la vista NO es para `anon` ni `authenticated`; la lee el rol de solo
-- lectura `superset_analitica` y la separación por organización la fuerza la cláusula `rls` del guest token
-- (`organizacion_id = '<org>'`), por eso cada fila lleva `organizacion_id`. La vista corre con los privilegios
-- de su dueño (no `security_invoker`), igual que `analitica.margen_producto_canal`.
--
-- Sin costos internos: solo `total_mano_obra`, `total_repuestos` y `total_cliente` (importes de cara al
-- cliente). Nunca `costo_mano_obra` ni `costo_repuestos` (FR-061/FR-062). El técnico sale con nombre visible
-- (nunca el correo).
--
-- Migración aditiva. Reversión (migración posterior; nada guarda datos):
--   drop view analitica.service_reparaciones;

create or replace view analitica.service_reparaciones as
select
  r.organizacion_id,
  r.empresa_id,
  e.nombre as empresa_nombre,
  r.id as reparacion_id,
  private.codigo_reparacion(r.numero) as codigo,
  r.ingreso_en,
  r.entrega_prevista,
  r.entrega_real,
  r.estado_id,
  s.nombre as estado_nombre,
  s.cierra as estado_cierra,
  r.tecnico_id,
  case when r.tecnico_id is null then null
    else coalesce(nullif(btrim(concat_ws(' ', p.nombre, p.apellido)), ''), 'Técnico sin nombre') end as tecnico_nombre,
  m.equipo,
  m.modelo,
  (r.anulada_en is not null) as anulada,
  r.total_mano_obra,
  r.total_repuestos,
  r.total_mano_obra + r.total_repuestos as total_cliente
from dominio.reparaciones r
join dominio.empresas e on e.id = r.empresa_id
join dominio.estados_reparacion s on s.id = r.estado_id and s.organizacion_id = r.organizacion_id
join dominio.modelos_equipo m on m.id = r.modelo_id and m.organizacion_id = r.organizacion_id
left join public.perfiles_usuario p on p.user_id = r.tecnico_id;

comment on view analitica.service_reparaciones is
  'F-SVC-23: una fila por reparación para el tablero de Service (organizacion_id aislante, técnico con nombre visible). Sin costos internos. Solo lectura para superset_analitica.';

revoke all on analitica.service_reparaciones from public, anon, authenticated;
grant select on analitica.service_reparaciones to superset_analitica;
