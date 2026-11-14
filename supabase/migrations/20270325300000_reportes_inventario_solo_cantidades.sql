-- Decisión de Nicolás sobre la Decisión abierta 3 de MSF-140 (spec 20270201-100000-reportes-de-inventario-y-exportacion):
-- el rol Consulta (y cualquier rol sin la acción `ver_costos` en Stock) ve el reporte de inventario SOLO con
-- cantidades; costo y valor del inventario quedan para quien ya ve costos en el resto del producto.
--
-- Esquema (Principio VII): SIN tablas nuevas.
--   · `analitica` (solo vistas): vista nueva `inventario_productos_stock_cantidades`, SIN ninguna columna de costo ni
--     valor y sin leer `dominio.producto_costos`: lo que la vista no trae, el tablero no puede mostrarlo ni exportarlo.
--   · `public` (plataforma): columna `reportes.accion_requerida` (nullable) y helper `private.cumple_accion_reporte`.
--
-- Cómo funciona:
--   1. `reportes.accion_requerida` declara una acción de la matriz (p. ej. `ver_costos`) que, además de la sección,
--      el reporte exige para emitir el token y para aparecer en la lista del usuario. Se evalúa con
--      `private.puede_accion(seccion, accion)`: respeta la matriz por rol de cada organización. Falla cerrado: una
--      acción sin sección, o desconocida, no da acceso.
--   2. `resolver_organizacion_reporte` (misma firma) y `reportes_visibles_para_mi` (misma firma) aplican esa exigencia:
--      sin `ver_costos` no hay token (403 en `emitir-acceso-reporte`) ni el reporte con costos figura en la lista.
--   3. «Inventario · Productos y stock» queda con `accion_requerida = 'ver_costos'`; el tablero «Inventario · Productos y
--      stock (cantidades)» (sin exigencia extra, sección `stock`) lo registra el importador de dashboards.
--
--   4. `reportes.datasets_permitidos` (text[], nombres de dataset de Superset = ALLOWLIST del tablero): el rol Guest de
--      Superset es uno solo y tiene `datasource_access` sobre TODOS los datasets embebidos, así que el token de un
--      tablero podría pedir por la API (`/api/v1/chart/data`, CSV, samples, valores de columna) el dataset de otro (el
--      de costos, o los de Rentabilidad con margen). `emitir-acceso-reporte` agrega al token una regla `rls`
--      `1 = 0` por CADA dataset de Superset que no figure en la allowlist del tablero. La allowlist la calcula el
--      importador de dashboards desde los YAML (charts y filtros nativos del tablero + `datasets_permitidos_extra`).
--      Sin allowlist (vacía) el token NO se emite (503, falla cerrado).
--   5. Operador conserva lo que hoy ve: `ver_costos` en Stock pasa a ser `true` para Operador en la matriz inicial
--      (`private.matriz_acciones_iniciales`) y en las organizaciones existentes. Consulta sigue sin costos.
--
-- Orden de despliegue: esta migración ANTES que el importador de dashboards y que la web (el importador solo envía
-- `accion_requerida` y `datasets_permitidos` de CADA tablero; hasta que se reimporte cada directorio de dashboards, sus tableros
-- responden 503 por no tener allowlist: reimportar los seis directorios apenas se aplique la migración).
--
-- Hasta que el importador registre el reporte de cantidades, un rol sin `ver_costos` ve el aviso de tablero «todavía no
-- disponible» (falla segura: nunca los costos).
--
-- Migración aditiva e idempotente. Reversión (migración posterior):
--   restaurar public.resolver_organizacion_reporte al cuerpo de 20261130100400_reportes_seccion.sql y
--   public.reportes_visibles_para_mi al de 20260909140000_analitica_embebida.sql;
--   drop function private.cumple_accion_reporte(uuid);
--   alter table public.reportes drop column accion_requerida;
--   drop view analitica.inventario_productos_stock_cantidades;
--   (asignación automática del tablero de cantidades: ver el bloque 6 de este archivo)
--   alter table public.reportes drop column datasets_permitidos;
--   restaurar private.matriz_acciones_iniciales() al cuerpo de 20270114130000_reconciliar_acciones_cobros_despacho.sql.

-- ---------------------------------------------------------------------------
-- 1. Columna: acción de la matriz que exige el reporte.
-- ---------------------------------------------------------------------------

alter table public.reportes
  add column if not exists accion_requerida text;

alter table public.reportes
  add column if not exists datasets_permitidos text[] not null default '{}';

comment on column public.reportes.datasets_permitidos is
  'Allowlist: nombres de dataset de Superset (table_name) que el tablero usa. emitir-acceso-reporte agrega al guest token una regla rls 1 = 0 por cada dataset de Superset que NO esté acá (el rol Guest es único y ve todos). Vacía = no se emite token (falla cerrado). La mantiene el importador de dashboards.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.reportes'::regclass and conname = 'reportes_accion_requerida_check'
  ) then
    alter table public.reportes
      add constraint reportes_accion_requerida_check
      check (accion_requerida is null or btrim(accion_requerida) <> '');
  end if;
end
$$;

comment on column public.reportes.accion_requerida is
  'Acción de la matriz de permisos (p. ej. ver_costos) que el reporte exige, sobre su sección, para emitir el token y figurar en la lista. Nula = sin exigencia extra. Sin sección o con una acción desconocida no da acceso.';

-- ---------------------------------------------------------------------------
-- 2. Helper: ¿cumple quien llama la acción que exige el reporte?
-- ---------------------------------------------------------------------------

create or replace function private.cumple_accion_reporte(p_reporte_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select case
              when r.accion_requerida is null then true
              when r.seccion is null then false
              else coalesce(private.puede_accion(r.seccion, r.accion_requerida), false)
            end
       from public.reportes r
      where r.id = p_reporte_id),
    false
  );
$$;

comment on function private.cumple_accion_reporte(uuid) is
  'Verdadero si el reporte no exige una acción extra (reportes.accion_requerida) o quien llama la tiene sobre la sección del reporte. Falla cerrado: reporte inexistente, acción sin sección o desconocida = falso.';

revoke execute on function private.cumple_accion_reporte(uuid) from public, anon;
grant execute on function private.cumple_accion_reporte(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Emisión del token y lista de reportes visibles: aplican la exigencia.
-- ---------------------------------------------------------------------------

create or replace function public.resolver_organizacion_reporte(p_reporte_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.puede_ver_asignacion(p_reporte_id, private.organizacion_id())
      and exists (
        select 1 from public.reportes_organizaciones ro
         where ro.reporte_id = p_reporte_id and ro.organizacion_id = private.organizacion_id()
      )
      and coalesce(
        (select private.nivel_seccion(r.seccion) in ('lectura', 'edicion')
           from public.reportes r
          where r.id = p_reporte_id and r.seccion is not null),
        true
      )
      and private.cumple_accion_reporte(p_reporte_id)
      then private.organizacion_id()
    else null
  end;
$$;

comment on function public.resolver_organizacion_reporte(uuid) is
  'Contrato: specs/007-analitica-embebida/contracts/acceso-reporte.md. Resuelve la organización con la que emitir-acceso-reporte arma la cláusula rls del guest token; si el reporte declara una sección (reportes.seccion) exige lectura o edición en ella (F-REN-01) y, si declara una acción (reportes.accion_requerida, p. ej. ver_costos), también esa acción. Devuelve null si no hay acceso.';

revoke execute on function public.resolver_organizacion_reporte(uuid) from public, anon;
grant execute on function public.resolver_organizacion_reporte(uuid) to authenticated;

create or replace function public.reportes_visibles_para_mi()
returns table (id uuid, nombre text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.nombre
  from public.reportes r
  join public.reportes_organizaciones ro on ro.reporte_id = r.id
  where ro.organizacion_id = (select private.organizacion_id())
    and private.puede_ver_asignacion(ro.reporte_id, ro.organizacion_id)
    and private.cumple_accion_reporte(r.id);
$$;

comment on function public.reportes_visibles_para_mi() is
  'Usada por apps/web/src/hooks/useReportesAsignados.ts: los reportes asignados a la organización activa que el usuario puede abrir; no lista los que exigen una acción (reportes.accion_requerida, p. ej. ver_costos) que no tiene.';

revoke execute on function public.reportes_visibles_para_mi() from public, anon;
grant execute on function public.reportes_visibles_para_mi() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. El reporte con costos exige `ver_costos` (idempotente; el importador lo mantiene).
-- ---------------------------------------------------------------------------

update public.reportes
   set accion_requerida = 'ver_costos'
 where nombre = 'Inventario · Productos y stock'
   and seccion = 'stock'
   and accion_requerida is distinct from 'ver_costos';

-- ---------------------------------------------------------------------------
-- 4a. Semilla de la allowlist (`datasets_permitidos`) de los reportes ya registrados: sin ella, entre esta migración
-- y la reimportación de los dashboards TODOS los tableros responderían 503 (allowlist vacía = falla cerrado). El
-- importador (`infra/superset/datasets-tablero.mjs`) es la fuente de verdad y la sobrescribe; un test
-- (`importar-dashboards.test.mjs`) falla si esta lista se desvía de lo que deriva el importador. Idempotente.
-- ---------------------------------------------------------------------------

update public.reportes r
   set datasets_permitidos = s.datasets
  from (values
-- SEMILLA-INICIO
  ('Reportes · Productos más consultados', array['consultas_producto_mas_consultado']),
  ('Inventario · Productos y stock', array['inventario_productos_stock']),
  ('Inventario · Productos y stock (cantidades)', array['inventario_productos_stock_cantidades']),
  ('Inventario · Reposición', array['inventario_reposicion']),
  ('Rentabilidad · Resumen', array['margen_producto_canal', 'rentabilidad_consolidado', 'rentabilidad_resumen_empresa']),
  ('Rentabilidad · Por producto', array['margen_producto_canal']),
  ('Rentabilidad · Comparativo', array['margen_comparativo_producto']),
  ('Rentabilidad · Historia', array['margen_historico_producto_canal']),
  ('Rentabilidad · Ventas reales', array['rentabilidad_ventas_real']),
  ('Service técnico', array['service_reparaciones']),
  ('Reportes · Ventas por período y canal', array['ventas_periodo_canal']),
  ('Ventas · Más vendidos', array['ventas_producto_mas_vendido']),
  ('Ventas · Ranking de clientes', array['ventas_ranking_clientes'])
-- SEMILLA-FIN
  ) as s(nombre, datasets)
 where r.nombre = s.nombre
   and r.datasets_permitidos is distinct from s.datasets;

-- ---------------------------------------------------------------------------
-- 4b. Operador conserva costos y valor del inventario (decisión de Nicolás): `ver_costos` en Stock.
-- ---------------------------------------------------------------------------

create or replace function private.matriz_acciones_iniciales()
returns table (rol_id text, seccion text, accion text, permitido boolean)
language sql
immutable
set search_path = ''
as $$
  select m.rol_id, m.seccion, a.accion,
    case a.accion
      when 'eliminar' then m.rol_id = 'administrador'
      when 'exportar' then m.rol_id in ('administrador', 'operador', 'administracion')
      when 'ver_costos' then m.rol_id in ('administrador', 'administracion')
        or (m.rol_id = 'operador' and m.seccion = 'stock')
      when 'editar_precio' then m.rol_id in ('administrador', 'operador')
      when 'anular' then m.rol_id in ('administrador', 'administracion')
      when 'emitir_nota_credito' then m.rol_id in ('administrador', 'administracion')
      when 'registrar_cobro' then m.rol_id in ('administrador', 'administracion', 'mostrador')
      when 'conciliar_pago' then m.rol_id in ('administrador', 'administracion')
      when 'despachar' then m.rol_id in ('administrador', 'deposito')
      else m.rol_id in ('administrador', 'administracion')
    end
  from private.matriz_inicial() m
  cross join (values ('eliminar'), ('exportar'), ('ver_costos'), ('editar_precio'), ('anular'),
    ('emitir_nota_credito'), ('registrar_cobro'), ('conciliar_pago'), ('despachar')) as a(accion)
  where a.accion not in ('editar_precio', 'anular', 'emitir_nota_credito', 'registrar_cobro', 'conciliar_pago', 'despachar')
    or m.seccion = 'ventas';
$$;

comment on function private.matriz_acciones_iniciales() is
  'Valores iniciales PROPUESTOS de permisos por acción (FR-006); pendientes de confirmar con el cliente. editar_precio, anular, emitir_nota_credito, registrar_cobro, conciliar_pago y despachar solo en ventas (cobrar_contrarreembolso se siembra aparte en private.sembrar_permisos). ver_costos: Administrador y Administración en todas las secciones y Operador en Stock (reportes de inventario).';

revoke execute on function private.matriz_acciones_iniciales() from public, anon, authenticated;

-- Organizaciones existentes: la fila de Operador en Stock pasa a permitida (o se crea si faltaba). Idempotente.
-- Deja constancia (NOTICE en el log de la migración) de cuántas filas estaban en `false` y se pisan: pueden ser
-- decisiones deliberadas de una organización. Para consultarlo ANTES de aplicar:
--   select count(*) from public.permisos_rol_accion
--    where rol_id = 'operador' and seccion = 'stock' and accion = 'ver_costos' and permitido = false;
do $$
declare
  v_pisadas integer;
begin
  select count(*) into v_pisadas
    from public.permisos_rol_accion
   where rol_id = 'operador' and seccion = 'stock' and accion = 'ver_costos' and permitido = false;
  raise notice 'ver_costos de Operador en Stock: % fila(s) estaban en false y pasan a true', v_pisadas;
end
$$;

insert into public.permisos_rol_accion (organizacion_id, rol_id, seccion, accion, permitido)
select o.id, 'operador', 'stock', 'ver_costos', true
  from public.organizaciones o
on conflict (organizacion_id, rol_id, seccion, accion) do update set permitido = true
  where public.permisos_rol_accion.permitido is distinct from true;

-- ---------------------------------------------------------------------------
-- 5. Vista de solo cantidades para el tablero sin costos.
-- ---------------------------------------------------------------------------

create or replace view analitica.inventario_productos_stock_cantidades as
select
  p.organizacion_id,
  p.id as producto_id,
  p.nombre as producto_nombre,
  p.sku,
  c.nombre as categoria,
  e.cantidad,
  e.minimo,
  case
    when e.cantidad = 0 then 'sin_stock'
    when e.cantidad <= e.minimo then 'stock_bajo'
    else 'disponible'
  end as estado
from dominio.productos p
join dominio.existencias e
  on e.producto_id = p.id and e.organizacion_id = p.organizacion_id
left join dominio.categorias c
  on c.id = p.categoria_id and c.organizacion_id = p.organizacion_id
where p.activo;

comment on view analitica.inventario_productos_stock_cantidades is
  'Productos activos con cantidad, mínimo y estado (misma regla que public.stock_estados), SIN costo ni valor: para los roles sin la acción ver_costos. No lee dominio.producto_costos. Contrato en specs/20270201-100000-reportes-de-inventario-y-exportacion/contracts/analitica-inventario.md.';

revoke all on analitica.inventario_productos_stock_cantidades from public, anon, authenticated;
grant select on analitica.inventario_productos_stock_cantidades to superset_analitica;

-- ---------------------------------------------------------------------------
-- 6. El tablero «(cantidades)» acompaña al de costos en cada organización.
--
-- Sin esto, al perder el tablero con costos (`cumple_accion_reporte`), un rol sin `ver_costos` quedaría sin inventario
-- en TODAS las organizaciones hasta que un superadmin asigne el nuevo una por una. Reglas:
--   · Cuando el reporte «Inventario · Productos y stock» se ASIGNA a una organización (ahora, como backfill, o después),
--     el de cantidades se asigna a ESA organización y queda con EXACTAMENTE los roles habilitados del de costos en ella
--     (no suma los roles por defecto del de cantidades).
--   · Cuando se habilita o se quita un rol en el de costos de una organización, se replica en el de cantidades de ESA
--     organización (solo si ya está asignado allí).
--   · Los triggers actúan solo por filas del de costos y solo sobre la organización de esa fila: cualquier otra
--     asignación no toca nada, y desasignar a mano el de cantidades persiste hasta que se vuelva a asignar el de costos.
--   · El alta de la fila del reporte de cantidades (la crea esta migración si ya hay usuarios, o el importador) hace el
--     mismo trabajo para las organizaciones que ya tienen el de costos y todavía no tienen el de cantidades.
-- Idempotente. Esquema (Principio VII): sin tablas nuevas; `public` (plataforma, spec 007). Reversión (migración posterior):
--   drop trigger reportes_cantidades_alta on public.reportes;
--   drop trigger reportes_cantidades_asignacion on public.reportes_organizaciones;
--   drop trigger reportes_cantidades_rol_alta on public.reportes_organizaciones_roles;
--   drop trigger reportes_cantidades_rol_baja on public.reportes_organizaciones_roles;
--   drop function private.asignar_cantidades_en_organizacion(uuid, uuid),
--     private.reportes_cantidades_alta_trigger(), private.reportes_cantidades_asignacion_trigger(),
--     private.reportes_cantidades_rol_trigger(), private.completar_cantidades_faltantes();
-- ---------------------------------------------------------------------------

-- La fila del reporte (si todavía no hay usuarios, p. ej. un reset limpio, la crea el importador y el trigger de alta
-- hace la réplica). `superset_dashboard_uuid` nace con el slug y el importador lo reemplaza con el UUID de embebido.
insert into public.reportes (id, superset_dashboard_uuid, nombre, creado_por, seccion, datasets_permitidos)
select
  'f1e5c0de-0000-4000-8000-000000000297'::uuid,
  'inventario-productos-stock-cantidades',
  'Inventario · Productos y stock (cantidades)',
  u.user_id,
  'stock',
  array['inventario_productos_stock_cantidades']
from (select id as user_id from auth.users order by created_at limit 1) u
where not exists (select 1 from public.reportes where nombre = 'Inventario · Productos y stock (cantidades)')
on conflict do nothing;

insert into public.reportes_roles_default (reporte_id, rol_id)
select r.id, d.rol_id
from public.reportes r
cross join (values ('administracion'), ('operador'), ('consulta')) as d(rol_id)
where r.nombre = 'Inventario · Productos y stock (cantidades)'
on conflict (reporte_id, rol_id) do nothing;

-- Asigna el de cantidades a UNA organización (la del de costos) con exactamente los roles del de costos allí.
create or replace function private.asignar_cantidades_en_organizacion(p_costos_id uuid, p_organizacion_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cantidades uuid;
  v_asignado_por uuid;
begin
  select id into v_cantidades from public.reportes where nombre = 'Inventario · Productos y stock (cantidades)' limit 1;
  select asignado_por into v_asignado_por from public.reportes_organizaciones
   where reporte_id = p_costos_id and organizacion_id = p_organizacion_id;
  if v_cantidades is null or v_asignado_por is null then
    return;
  end if;

  insert into public.reportes_organizaciones (reporte_id, organizacion_id, asignado_por)
  values (v_cantidades, p_organizacion_id, v_asignado_por)
  on conflict (reporte_id, organizacion_id) do nothing;

  -- Roles EXACTOS del de costos en la organización: se quitan los que el trigger de herencia (defaults del de cantidades)
  -- haya agregado de más y se agregan los que falten.
  delete from public.reportes_organizaciones_roles
   where reporte_id = v_cantidades and organizacion_id = p_organizacion_id
     and rol_id not in (
       select rol_id from public.reportes_organizaciones_roles
        where reporte_id = p_costos_id and organizacion_id = p_organizacion_id);

  insert into public.reportes_organizaciones_roles (reporte_id, organizacion_id, rol_id)
  select v_cantidades, p_organizacion_id, rol_id from public.reportes_organizaciones_roles
   where reporte_id = p_costos_id and organizacion_id = p_organizacion_id
  on conflict (reporte_id, organizacion_id, rol_id) do nothing;
end;
$$;

comment on function private.asignar_cantidades_en_organizacion(uuid, uuid) is
  'Asigna «Inventario · Productos y stock (cantidades)» a una organización que tiene el de costos, con exactamente los roles que el de costos tiene habilitados en ella.';

revoke execute on function private.asignar_cantidades_en_organizacion(uuid, uuid) from public, anon, authenticated;

create or replace function private.reportes_cantidades_asignacion_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.reportes where id = new.reporte_id and nombre = 'Inventario · Productos y stock') then
    perform private.asignar_cantidades_en_organizacion(new.reporte_id, new.organizacion_id);
  end if;
  return null;
end;
$$;

create or replace function private.reportes_cantidades_rol_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cantidades uuid;
begin
  select id into v_cantidades from public.reportes where nombre = 'Inventario · Productos y stock (cantidades)' limit 1;
  if v_cantidades is null then
    return null;
  end if;

  if tg_op = 'INSERT' then
    if exists (select 1 from public.reportes where id = new.reporte_id and nombre = 'Inventario · Productos y stock')
       -- Solo si el de cantidades ya está asignado en esa organización (si se desasignó a mano, no se vuelve a asignar acá).
       and exists (select 1 from public.reportes_organizaciones
                    where reporte_id = v_cantidades and organizacion_id = new.organizacion_id) then
      insert into public.reportes_organizaciones_roles (reporte_id, organizacion_id, rol_id)
      values (v_cantidades, new.organizacion_id, new.rol_id)
      on conflict (reporte_id, organizacion_id, rol_id) do nothing;
    end if;
    return null;
  end if;

  -- DELETE: el rol quitado del de costos se quita también del de cantidades de esa organización.
  if exists (select 1 from public.reportes where id = old.reporte_id and nombre = 'Inventario · Productos y stock') then
    delete from public.reportes_organizaciones_roles
     where reporte_id = v_cantidades and organizacion_id = old.organizacion_id and rol_id = old.rol_id;
  end if;
  return null;
end;
$$;

-- Organizaciones que ya tienen el de costos y todavía no el de cantidades (alta del reporte y backfill).
create or replace function private.completar_cantidades_faltantes()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fila record;
  v_cantidades uuid;
begin
  select id into v_cantidades from public.reportes where nombre = 'Inventario · Productos y stock (cantidades)' limit 1;
  if v_cantidades is null then
    return;
  end if;
  for v_fila in
    select ro.reporte_id, ro.organizacion_id
      from public.reportes_organizaciones ro
      join public.reportes k on k.id = ro.reporte_id and k.nombre = 'Inventario · Productos y stock'
     where not exists (
       select 1 from public.reportes_organizaciones x
        where x.reporte_id = v_cantidades and x.organizacion_id = ro.organizacion_id)
  loop
    perform private.asignar_cantidades_en_organizacion(v_fila.reporte_id, v_fila.organizacion_id);
  end loop;
end;
$$;

create or replace function private.reportes_cantidades_alta_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.completar_cantidades_faltantes();
  return null;
end;
$$;

revoke execute on function private.reportes_cantidades_asignacion_trigger() from public, anon, authenticated;
revoke execute on function private.reportes_cantidades_rol_trigger() from public, anon, authenticated;
revoke execute on function private.completar_cantidades_faltantes() from public, anon, authenticated;
revoke execute on function private.reportes_cantidades_alta_trigger() from public, anon, authenticated;

drop trigger if exists reportes_cantidades_alta on public.reportes;
create trigger reportes_cantidades_alta
  after insert on public.reportes
  for each row
  when (new.nombre = 'Inventario · Productos y stock (cantidades)')
  execute function private.reportes_cantidades_alta_trigger();

drop trigger if exists reportes_cantidades_asignacion on public.reportes_organizaciones;
create trigger reportes_cantidades_asignacion
  after insert on public.reportes_organizaciones
  for each row
  execute function private.reportes_cantidades_asignacion_trigger();

drop trigger if exists reportes_cantidades_rol_alta on public.reportes_organizaciones_roles;
create trigger reportes_cantidades_rol_alta
  after insert on public.reportes_organizaciones_roles
  for each row
  execute function private.reportes_cantidades_rol_trigger();

drop trigger if exists reportes_cantidades_rol_baja on public.reportes_organizaciones_roles;
create trigger reportes_cantidades_rol_baja
  after delete on public.reportes_organizaciones_roles
  for each row
  execute function private.reportes_cantidades_rol_trigger();

-- Backfill: las organizaciones que ya tienen el de costos y todavía no el de cantidades.
select private.completar_cantidades_faltantes();
