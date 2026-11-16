-- F-VTA-22 (MSF-347, épica MSF-338, spec 20270104-100000-ventas-reportes-basicos, FR-004):
-- `public.reportes.filtro_empresa` — el reporte declara si su tablero acota el token por empresa.
--
-- Por qué hace falta: la cláusula `rls` del guest token se aplica a TODOS los datasets del tablero
-- (por eso toda vista de `analitica` tiene que exponer `organizacion_id`: lo exige la guarda
-- `supabase/tests/database/rentabilidad_superficie.test.sql`). Al agregar `empresa_id IN (…)` a esa
-- cláusula (F-VTA-22), un tablero cuyas vistas NO tienen `empresa_id` queda con una consulta
-- inválida ("column empresa_id does not exist") y su gráfico deja de responder: pasa con
-- `analitica.rentabilidad_consolidado`, que es un consolidado POR ORGANIZACIÓN. El reporte declara,
-- entonces, si su tablero admite el filtro por empresa (los de Rentabilidad lo dejan en `false`).
--
-- Esquema (Principio VII): `public.reportes` es plataforma (spec 007, el catálogo de reportes
-- embebibles) → la columna nueva va en `public`. Sin tablas ni datos de negocio.
--
-- Aditiva: una columna booleana con default `false` (lo que no se declara, no filtra: los reportes
-- ya registrados siguen viendo toda su organización, como hasta ahora). El importador de tableros
-- escribe el valor explícito desde `reportes.json` (`filtro_empresa`), así que el tablero de cada
-- reporte queda declarado, no heredado.
--
-- Reversión (migración posterior; no en este PR):
--   alter table public.reportes drop column filtro_empresa;

alter table public.reportes
  add column if not exists filtro_empresa boolean not null default false;

comment on column public.reportes.filtro_empresa is
  'F-VTA-22: el guest token de este reporte acota las filas a las empresas accesibles del usuario (empresa_id IN (''...'')) además de la organización. Exige que TODAS las vistas del tablero expongan empresa_id: la cláusula rls se aplica a cada dataset del tablero. Los tableros por organización (sin empresa) lo dejan en false.';
