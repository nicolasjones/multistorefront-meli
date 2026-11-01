-- MSF-260 · F-CON-05 (FR-005, FR-008): libreta paginada con búsqueda e historial del contacto.
--
-- Esquema (Principio VII): sin tablas nuevas; funciones en `public` (superficie de lectura).
--
-- Seguridad:
--   * `buscar_contactos` es SECURITY INVOKER: la RLS de `dominio.contactos` (organización, empresa
--     accesible, `consultas` >= lectura) decide qué filas existen. `p_empresa_id = null` devuelve todas
--     las empresas accesibles («Todas mis empresas»); una empresa ajena devuelve cero filas.
--   * `historial_contacto` es SECURITY DEFINER porque las compras viven en `dominio.comprobantes_venta`
--     (RLS por sección `ventas`) y la libreta se gobierna por `consultas`. Exige `consultas` >= lectura,
--     contacto de la organización de la sesión y de una empresa accesible; devuelve solo lo vinculado a
--     ese contacto. Un contacto inexistente o ajeno devuelve cero filas.
--   * `anon` sin acceso.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.historial_contacto(uuid);
--   drop function public.buscar_contactos(uuid, text, integer, integer);

create or replace function public.buscar_contactos(
  p_empresa_id uuid default null,
  p_busqueda text default null,
  p_limite integer default 25,
  p_desde integer default 0
)
returns table (
  id uuid,
  empresa_id uuid,
  empresa_nombre text,
  nombre text,
  correo text,
  telefono text,
  anonimizado boolean,
  updated_at timestamptz,
  total bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_texto text := btrim(coalesce(p_busqueda, ''));
  v_patron text := '%' || replace(replace(replace(lower(btrim(coalesce(p_busqueda, ''))), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_digitos text := regexp_replace(coalesce(p_busqueda, ''), '\D', '', 'g');
  v_limite integer := least(greatest(coalesce(p_limite, 25), 1), 200);
  v_desde integer := greatest(coalesce(p_desde, 0), 0);
begin
  return query
    select c.id, c.empresa_id, e.nombre, c.nombre, c.correo, c.telefono,
           c.anonimizado_en is not null, c.updated_at,
           count(*) over () as total
    from dominio.contactos c
    join dominio.empresas e on e.id = c.empresa_id and e.organizacion_id = c.organizacion_id
    where (p_empresa_id is null or c.empresa_id = p_empresa_id)
      and (
        v_texto = ''
        or lower(c.nombre) like v_patron escape '\'
        or lower(coalesce(c.correo, '')) like v_patron escape '\'
        or lower(coalesce(c.telefono, '')) like v_patron escape '\'
        or (length(v_digitos) >= 3 and coalesce(c.telefono_normalizado, '') like '%' || v_digitos || '%')
      )
    order by lower(c.nombre), c.id
    limit v_limite offset v_desde;
end;
$$;

revoke execute on function public.buscar_contactos(uuid, text, integer, integer) from public, anon;
grant execute on function public.buscar_contactos(uuid, text, integer, integer) to authenticated;

comment on function public.buscar_contactos(uuid, text, integer, integer) is
  'MSF-260: libreta paginada (tope 200) con búsqueda por nombre, correo o teléfono; la RLS de dominio.contactos decide qué se ve. total = filas del filtro.';

create or replace function public.historial_contacto(p_contacto_id uuid)
returns table (
  tipo text,
  referencia_id uuid,
  fecha timestamptz,
  empresa_id uuid,
  empresa_nombre text,
  resumen text,
  estado text,
  total numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_empresa uuid;
begin
  if v_org is null or (select private.nivel_seccion('consultas')) not in ('lectura', 'edicion') then
    raise exception 'No tenés permiso para ver contactos' using errcode = '42501';
  end if;

  select c.empresa_id into v_empresa from dominio.contactos c
  where c.id = p_contacto_id and c.organizacion_id = v_org;
  if v_empresa is null or not exists (select 1 from private.empresas_accesibles() ea where ea = v_empresa) then
    return;
  end if;

  return query
    select h.tipo, h.referencia_id, h.fecha, h.empresa_id, e.nombre, h.resumen, h.estado, h.total
    from (
      select 'consulta'::text as tipo, q.id as referencia_id, q.created_at as fecha, q.empresa_id,
             coalesce(left(q.mensaje, 120), 'Sin mensaje') as resumen, q.estado, null::numeric as total
      from dominio.consultas q
      where q.contacto_id = p_contacto_id and q.organizacion_id = v_org
      union all
      select 'compra', v.id, v.fecha::timestamptz, v.empresa_id,
             (case v.tipo when 'factura' then 'Factura' when 'presupuesto' then 'Presupuesto'
                          when 'nota_credito' then 'Nota de crédito' else v.tipo end) || ' ' || v.numero,
             v.estado,
             case when v.tipo = 'nota_credito' then -v.total_con_iva else v.total_con_iva end
      from dominio.comprobantes_venta v
      where v.contacto_id = p_contacto_id and v.organizacion_id = v_org
    ) h
    join dominio.empresas e on e.id = h.empresa_id and e.organizacion_id = v_org
    where h.empresa_id in (select private.empresas_accesibles())
    order by h.fecha desc, h.referencia_id;
end;
$$;

revoke execute on function public.historial_contacto(uuid) from public, anon;
grant execute on function public.historial_contacto(uuid) to authenticated;

comment on function public.historial_contacto(uuid) is
  'MSF-260: consultas y compras vinculadas a un contacto (tipo consulta|compra), por fecha descendente, solo de empresas accesibles. Cero filas si el contacto no existe o no es accesible.';
