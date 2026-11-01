-- F-SVC-22 (MSF-157, épica MSF-124): estado público de una reparación por token (FR-044).
-- Esquema: sin tablas nuevas (solo lectura; Principio VII).
--
-- `private.estado_publico_reparacion(token)` arma la respuesta desde una LISTA BLANCA explícita (nunca `select *`):
-- código, tienda, equipo y modelo, estado actual (nombre y «Qué significa»), entrega prevista y línea de tiempo de
-- estados (nombre y fecha). NO incluye cliente, contacto, N.º de serie, falla, accesorios, técnico, notas ni
-- usuarios del historial, ítems, importes, costos, adjuntos ni ids internos. Token mal formado o desconocido → null.
-- `public.obtener_estado_publico_reparacion(token)` es el envoltorio ejecutable SOLO por `service_role`.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.obtener_estado_publico_reparacion(text);
--   drop function private.estado_publico_reparacion(text);

create or replace function private.estado_publico_reparacion(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'codigo', private.codigo_reparacion(r.numero),
    'tienda', emp.nombre,
    'equipo', m.equipo,
    'modelo', m.modelo,
    'estado', jsonb_build_object('nombre', s.nombre, 'descripcion', s.descripcion),
    'entrega_prevista', r.entrega_prevista,
    'linea_de_tiempo', coalesce((
      select jsonb_agg(jsonb_build_object('estado', se.nombre, 'fecha', h.creado_en) order by h.creado_en, h.id)
        from dominio.reparacion_historial h
        join dominio.estados_reparacion se on se.id = h.estado_nuevo_id and se.organizacion_id = h.organizacion_id
       where h.reparacion_id = r.id and h.organizacion_id = r.organizacion_id
    ), '[]'::jsonb)
  )
  from dominio.reparacion_enlaces_consulta e
  join dominio.reparaciones r on r.id = e.reparacion_id and r.organizacion_id = e.organizacion_id
  join dominio.empresas emp on emp.id = r.empresa_id
  join dominio.modelos_equipo m on m.id = r.modelo_id and m.organizacion_id = r.organizacion_id
  join dominio.estados_reparacion s on s.id = r.estado_id and s.organizacion_id = r.organizacion_id
  where p_token ~ '^[A-Za-z0-9_-]{32}$' and e.token = p_token;
$$;

revoke execute on function private.estado_publico_reparacion(text) from public, anon, authenticated;

create or replace function public.obtener_estado_publico_reparacion(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.estado_publico_reparacion(p_token);
$$;

comment on function public.obtener_estado_publico_reparacion(text) is
  'F-SVC-22: estado público (lista blanca) de una reparación por token; null si no existe. Solo service_role (Edge Function consultar-estado-reparacion).';

revoke execute on function public.obtener_estado_publico_reparacion(text) from public, anon, authenticated;
grant execute on function public.obtener_estado_publico_reparacion(text) to service_role;
