-- Catálogo real para sistema_externo en conexiones (spec 013, ver
-- specs/20260930-165358-catalogo-sistemas-externos/). Reversión: sin
-- dependencias de ninguna otra spec posterior, en orden inverso a como se
-- crea acá —
--   alter table conexiones drop constraint conexiones_sistema_externo_fkey;
--   drop table sistemas_externos;
-- No se toca conexiones.sistema_externo en sí (se conserva su tipo text y
-- su not null actuales): solo se le agrega esta FK.

-- ============================================================================
-- Tabla
-- ============================================================================

create table sistemas_externos (
  id text primary key,
  descripcion text not null
);

comment on table sistemas_externos is
  'Catálogo de sistemas externos conectables por una organización (spec 013). Tabla de datos, no un check fijo: agregar un sistema externo es una fila nueva. Vacía a propósito — este template es plataforma pura, sin lógica de negocio de ningún producto derivado; cada producto derivado carga sus propios valores en su propia migración.';

-- ============================================================================
-- RLS
-- ============================================================================

alter table sistemas_externos enable row level security;

-- Catálogo de solo lectura para cualquier autenticado, igual criterio que
-- roles_organizacion. Sin policy de escritura: el alta de valores queda
-- fuera de alcance de esta spec (ver Assumptions de spec.md).
create policy sistemas_externos_select on sistemas_externos
  for select to authenticated
  using (true);

-- ============================================================================
-- Grants (auto_expose_new_tables = false: hace falta explícito)
-- ============================================================================

grant select on sistemas_externos to authenticated;

-- ============================================================================
-- Integridad referencial sobre conexiones (spec 013)
-- ============================================================================

-- not valid a propósito: esta migración viaja a productos derivados vía
-- `git merge upstream/main` (regla de CLAUDE.md sobre mecanismos de
-- plataforma reutilizables) y algún fork puede ya tener filas de negocio en
-- conexiones cuyo sistema_externo todavía no tiene fila en este catálogo
-- (vacío al momento de esta migración) — la migración no puede bloquearse
-- por datos que no controla. A partir de acá, toda escritura nueva sobre
-- conexiones.sistema_externo sí queda validada contra el catálogo; validar
-- las filas preexistentes (`validate constraint`) es responsabilidad de
-- cada fork, después de cargar su propio catálogo.
alter table conexiones
  add constraint conexiones_sistema_externo_fkey
  foreign key (sistema_externo) references sistemas_externos (id)
  not valid;
