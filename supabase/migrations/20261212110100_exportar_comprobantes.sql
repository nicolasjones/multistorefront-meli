-- F-VTA-09 (MSF-346, épica MSF-177, FR-006): `exportar_comprobantes`, TODAS las filas que coinciden con los filtros (no la
-- página), hasta 10.000, para Comprobantes (facturas y notas de crédito) o Presupuestos. El navegador arma el CSV.
--
-- Esquema (Principio VII): sin tablas nuevas; función de lectura que reutiliza `private.comprobantes_consulta`
-- (20261212110000), o sea la misma consulta del listado: lo exportado coincide con lo que se ve.
--
-- Permiso: la acción `exportar` de la sección `ventas` YA existe en `permisos_rol_accion` desde la matriz inicial
-- (`private.matriz_acciones_iniciales`: Administrador, Operador y Administración en true) y `private.puede_accion`
-- la resuelve por empresa; por eso esta migración NO siembra nada (T012 la pedía; ya está dada). La RPC la exige
-- ADEMÁS de `ventas` ≥ `lectura` en cada empresa (no solo la UI).
--
-- Seguridad: `security invoker`, `search_path = ''`; organización y empresas visibles de la sesión (las resuelve
-- `private.comprobantes_consulta_sesion`, que no recibe organización por argumento). Una empresa ajena devuelve cero
-- filas. `anon` sin ejecución.
--
-- Tope: 10.000 filas. `filas` trae el total del filtro (puede ser mayor): la pantalla elige la vía diferida
-- (`solicitar_exportacion_comprobantes`) cuando supera el tope.
--
-- Errores: 42501 sin permiso `exportar` o sin sesión · 22023 tipo o estado de filtro desconocido.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.exportar_comprobantes(text, text, text, uuid, uuid, uuid, uuid);

create or replace function public.exportar_comprobantes(
  p_tipo text,
  p_busqueda text default null,
  p_estado text default null,
  p_pago_id uuid default null,
  p_envio_id uuid default null,
  p_operador_id uuid default null,
  p_empresa_id uuid default null
)
returns table (
  id uuid,
  numero text,
  tipo text,
  empresa_id uuid,
  empresa text,
  fecha date,
  cliente text,
  operador text,
  estado text,
  estado_etiqueta text,
  forma_pago text,
  envio text,
  total numeric,
  filas bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_tipo is null or p_tipo not in ('comprobantes', 'presupuestos') then
    raise exception 'El tipo debe ser comprobantes o presupuestos' using errcode = '22023', hint = 'tipo';
  end if;
  if not (select private.puede_accion('ventas', 'exportar')) then
    raise exception 'No tenés permiso para exportar ventas' using errcode = '42501';
  end if;

  return query
  select q.id, q.numero, q.tipo, q.empresa_id, q.empresa, q.fecha, q.cliente, q.operador, q.estado,
         q.estado_etiqueta, q.forma_pago, q.envio, q.total, q.filas
    from private.comprobantes_consulta_sesion(
           case p_tipo when 'presupuestos' then array['presupuesto'] else array['factura', 'nota_credito'] end,
           p_busqueda, p_estado, p_pago_id, p_envio_id, p_operador_id, p_empresa_id, 10000, 0
         ) q;
end;
$$;

revoke execute on function public.exportar_comprobantes(text, text, text, uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.exportar_comprobantes(text, text, text, uuid, uuid, uuid, uuid) to authenticated;

comment on function public.exportar_comprobantes(text, text, text, uuid, uuid, uuid, uuid) is
  'Exportación de comprobantes o presupuestos con los mismos filtros que el listado, hasta 10.000 filas; security invoker, exige private.puede_accion(ventas, exportar) (F-VTA-09, FR-006). filas = total del filtro.';
