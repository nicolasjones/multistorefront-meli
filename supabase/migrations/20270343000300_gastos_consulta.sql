-- F-GAS-02 (MSF-469): consulta de gastos por período y categoría. Esquema: `public` (superficie de ejecución; sin datos propios).
--   * listar_gastos: tanda con cursor por (fecha desc, id), filtros de empresa, categoría, tipo de costo y anulados.
--   * resumen_gastos: total en pesos, conteo y desglose por categoría y tipo (excluye anulados). Devuelve jsonb.
--   * exportar_gastos: el listado filtrado completo (tope 10.000 filas) y deja el evento `gasto.exportado` en Actividad (RF-GAS-9).
--     Desvío declarado del contrato (5.ª función): el evento de exportación solo puede registrarse desde la base.
-- Leer exige `lectura` o `edicion` en `rentabilidad` (42501 si no) y se acota por organización y empresas accesibles.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.exportar_gastos(date, date, uuid, text, text, boolean);
--   drop function public.resumen_gastos(date, date, uuid, text, text);
--   drop function public.listar_gastos(date, date, uuid, text, text, boolean, date, uuid, integer);

create or replace function public.listar_gastos(
  p_desde date default null,
  p_hasta date default null,
  p_empresa uuid default null,
  p_categoria text default null,
  p_tipo_costo text default null,
  p_incluir_anulados boolean default false,
  p_cursor_fecha date default null,
  p_cursor_id uuid default null,
  p_limite integer default 50
)
returns table (
  id uuid,
  empresa_id uuid,
  empresa_nombre text,
  fecha date,
  categoria text,
  tipo_costo text,
  detalle text,
  importe numeric,
  moneda text,
  cotizacion_usada numeric,
  importe_pesos numeric,
  recurrente boolean,
  anulado_en timestamptz,
  motivo_anulacion text,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
begin
  if v_org is null or (select private.nivel_seccion('rentabilidad')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver los gastos' using errcode = '42501';
  end if;
  return query
    select g.id, g.empresa_id, e.nombre, g.fecha, g.categoria, g.tipo_costo, g.detalle, g.importe, g.moneda,
           g.cotizacion_usada, g.importe_pesos, g.recurrente, g.anulado_en, g.motivo_anulacion, g.updated_at
      from dominio.gastos g
      join dominio.empresas e on e.id = g.empresa_id
     where g.organizacion_id = v_org
       and g.empresa_id in (select private.empresas_accesibles())
       and (p_desde is null or g.fecha >= p_desde)
       and (p_hasta is null or g.fecha <= p_hasta)
       and (p_empresa is null or g.empresa_id = p_empresa)
       and (p_categoria is null or g.categoria = p_categoria)
       and (p_tipo_costo is null or g.tipo_costo = p_tipo_costo)
       and (coalesce(p_incluir_anulados, false) or g.anulado_en is null)
       and (p_cursor_fecha is null or g.fecha < p_cursor_fecha or (g.fecha = p_cursor_fecha and g.id > p_cursor_id))
     order by g.fecha desc, g.id
     limit greatest(1, least(coalesce(p_limite, 50), 200));
end;
$$;

comment on function public.listar_gastos(date, date, uuid, text, text, boolean, date, uuid, integer) is
  'F-GAS-02: tanda de gastos (cursor fecha desc, id) de las empresas accesibles. 42501 sin lectura en rentabilidad.';

create or replace function public.resumen_gastos(
  p_desde date default null,
  p_hasta date default null,
  p_empresa uuid default null,
  p_categoria text default null,
  p_tipo_costo text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_res jsonb;
begin
  if v_org is null or (select private.nivel_seccion('rentabilidad')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver los gastos' using errcode = '42501';
  end if;
  with base as (
    select g.*
      from dominio.gastos g
     where g.organizacion_id = v_org
       and g.empresa_id in (select private.empresas_accesibles())
       and (p_desde is null or g.fecha >= p_desde)
       and (p_hasta is null or g.fecha <= p_hasta)
       and (p_empresa is null or g.empresa_id = p_empresa)
       and (p_categoria is null or g.categoria = p_categoria)
       and (p_tipo_costo is null or g.tipo_costo = p_tipo_costo)
  ), vigentes as (
    select * from base where anulado_en is null
  ), desglose as (
    select categoria, tipo_costo, sum(importe_pesos) as total, count(*) as conteo
      from vigentes group by categoria, tipo_costo
  )
  select jsonb_build_object(
    'total', coalesce((select sum(importe_pesos) from vigentes), 0),
    'conteo', (select count(*) from vigentes),
    'conteo_anulados', (select count(*) from base where anulado_en is not null),
    'desglose', coalesce((select jsonb_agg(jsonb_build_object('categoria', d.categoria, 'tipo_costo', d.tipo_costo,
                                                              'total', d.total, 'conteo', d.conteo)
                                           order by d.total desc, d.categoria, d.tipo_costo) from desglose d), '[]'::jsonb)
  ) into v_res;
  return v_res;
end;
$$;

comment on function public.resumen_gastos(date, date, uuid, text, text) is
  'F-GAS-02: total en pesos, conteo y desglose por categoría y tipo de los gastos vigentes del período. 42501 sin lectura.';

create or replace function public.exportar_gastos(
  p_desde date default null,
  p_hasta date default null,
  p_empresa uuid default null,
  p_categoria text default null,
  p_tipo_costo text default null,
  p_incluir_anulados boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_uid uuid := (select auth.uid());
  v_tope constant integer := 10000;
  v_total integer;
  v_filas jsonb;
  v_emp_nombre text;
begin
  if v_org is null or (select private.nivel_seccion('rentabilidad')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede exportar los gastos' using errcode = '42501';
  end if;
  with f as (
    select g.*, e.nombre as empresa_nombre
      from dominio.gastos g
      join dominio.empresas e on e.id = g.empresa_id
     where g.organizacion_id = v_org
       and g.empresa_id in (select private.empresas_accesibles())
       and (p_desde is null or g.fecha >= p_desde)
       and (p_hasta is null or g.fecha <= p_hasta)
       and (p_empresa is null or g.empresa_id = p_empresa)
       and (p_categoria is null or g.categoria = p_categoria)
       and (p_tipo_costo is null or g.tipo_costo = p_tipo_costo)
       and (coalesce(p_incluir_anulados, false) or g.anulado_en is null)
  ), lim as (
    select * from f order by fecha desc, id limit v_tope
  )
  select (select count(*) from f),
         coalesce((select jsonb_agg(jsonb_build_object(
           'fecha', x.fecha, 'empresa', x.empresa_nombre, 'categoria', x.categoria, 'tipo_costo', x.tipo_costo,
           'detalle', x.detalle, 'moneda', x.moneda, 'importe', x.importe, 'cotizacion_usada', x.cotizacion_usada,
           'importe_pesos', x.importe_pesos, 'recurrente', x.recurrente, 'anulado', x.anulado_en is not null,
           'motivo_anulacion', x.motivo_anulacion) order by x.fecha desc, x.id) from lim x), '[]'::jsonb)
    into v_total, v_filas;
  select e.nombre into v_emp_nombre from dominio.empresas e where e.id = p_empresa and e.organizacion_id = v_org;
  perform private.insertar_actividad(
    v_org, v_uid, 'gasto.exportado',
    format('Exportó %s gastos (%s a %s, %s, categoría %s, tipo %s)', v_total, coalesce(p_desde::text, 'inicio'),
           coalesce(p_hasta::text, 'hoy'), coalesce(v_emp_nombre, 'todas las empresas'),
           coalesce(p_categoria, 'todas'), coalesce(p_tipo_costo, 'todos')),
    p_empresa
  );
  return jsonb_build_object('total', v_total, 'truncado', v_total > v_tope, 'filas', v_filas);
end;
$$;

comment on function public.exportar_gastos(date, date, uuid, text, text, boolean) is
  'F-GAS-02: filas del listado filtrado (tope 10.000) y evento gasto.exportado en Actividad. 42501 sin lectura.';

revoke execute on function public.listar_gastos(date, date, uuid, text, text, boolean, date, uuid, integer) from public, anon;
revoke execute on function public.resumen_gastos(date, date, uuid, text, text) from public, anon;
revoke execute on function public.exportar_gastos(date, date, uuid, text, text, boolean) from public, anon;
grant execute on function public.listar_gastos(date, date, uuid, text, text, boolean, date, uuid, integer) to authenticated;
grant execute on function public.resumen_gastos(date, date, uuid, text, text) to authenticated;
grant execute on function public.exportar_gastos(date, date, uuid, text, text, boolean) to authenticated;
