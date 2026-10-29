-- F-REN-07 (MSF-280, épica MSF-127): historia de costos propia, `dominio.producto_costos_historial`.
-- Esquema (Principio VII): es un dato de negocio del producto (hermana de `dominio.producto_costos`) →
-- `dominio`, nunca `public`. Re-verificado: no es plataforma/transversal.
--
-- Decisión de Nicolás (AGE-1102, 24/10): la historia del costo NO se reconstruye desde Actividad (que
-- registra «Cambió el costo de X» sin importes, por diseño); tiene su tabla. Append-only: `authenticated`
-- solo lee (sección `rentabilidad`); no hay políticas ni privilegios de insert/update/delete. La escribe
-- un disparador SECURITY DEFINER sobre `dominio.producto_costos`, que cubre a todos los escritores del
-- costo (RPC de catálogo, proveedores, ingreso de mercadería) sin cambiar ninguna firma.
--
-- Siembra: una fila inicial por cada costo que ya existe, con `vigente_desde` = momento de esta
-- migración (antes de esa fecha no hay margen histórico: no se inventa un costo).
--
-- Migración aditiva. Reversión (migración posterior; exportar antes los datos):
--   drop trigger producto_costos_historial on dominio.producto_costos;
--   drop function private.registrar_costo_historial();
--   drop table dominio.producto_costos_historial;

create table dominio.producto_costos_historial (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null,
  producto_id uuid not null,
  costo numeric(14, 2) not null check (costo >= 0),
  vigente_desde timestamptz not null default clock_timestamp(),
  foreign key (producto_id, organizacion_id)
    references dominio.productos (id, organizacion_id) on delete cascade
);

comment on table dominio.producto_costos_historial is
  'Historia del costo de cada producto (F-REN-07): una fila por alta o cambio real de costo. Append-only; la escribe el disparador de dominio.producto_costos. Solo con la sección rentabilidad.';

create index if not exists producto_costos_historial_prod_idx
  on dominio.producto_costos_historial (producto_id, vigente_desde desc);
create index if not exists producto_costos_historial_org_idx
  on dominio.producto_costos_historial (organizacion_id, vigente_desde);

alter table dominio.producto_costos_historial enable row level security;

create policy producto_costos_historial_select on dominio.producto_costos_historial
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('rentabilidad')) in ('lectura', 'edicion')
  );

grant usage on schema dominio to authenticated;
revoke all on dominio.producto_costos_historial from public, anon, authenticated;
grant select on dominio.producto_costos_historial to authenticated;

-- Alta o cambio REAL de costo: guardar el mismo costo no agrega fila.
create or replace function private.registrar_costo_historial()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.costo is distinct from old.costo then
    insert into dominio.producto_costos_historial (organizacion_id, producto_id, costo)
    values (new.organizacion_id, new.producto_id, new.costo);
  end if;
  return null;
end;
$$;

comment on function private.registrar_costo_historial() is
  'F-REN-07: agrega una fila a dominio.producto_costos_historial en cada alta o cambio real de costo.';

revoke execute on function private.registrar_costo_historial() from public, anon, authenticated;

create trigger producto_costos_historial
  after insert or update of costo on dominio.producto_costos
  for each row execute function private.registrar_costo_historial();

-- Siembra: el costo vigente al lanzar es el punto de partida de la historia.
insert into dominio.producto_costos_historial (organizacion_id, producto_id, costo, vigente_desde)
select k.organizacion_id, k.producto_id, k.costo, clock_timestamp()
from dominio.producto_costos k;
