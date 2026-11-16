-- MSF-508 (seguimiento de MSF-318, F-CLI-04; Principio III): la exportación de clientes (datos personales) queda
-- registrada en la actividad: quién, cuándo, cuántos clientes y con qué filtros.
--
-- Esquemas (Principio VII): sin tablas nuevas. Se usa `public.registro_actividad` vía `private.registrar_actividad`.
--
-- Diseño: la función existente (stable, con la lógica y el control de permiso) se mueve tal cual a `private`
-- y `public.exportar_clientes` pasa a ser un envoltorio volatile con la MISMA firma y el MISMO resultado
-- (el cliente web no cambia). El evento `clientes.exportados` se escribe UNA vez por exportación, en el primer
-- lote (`p_despues_de` nulo; ahí se conoce el total), después de que el permiso y el tope (54000) ya pasaron.
-- No se registra si no hay filas. Un reintento tras un fallo registra otra vez (cada intento de extracción cuenta).
-- Los filtros se escriben con el nombre visible de la tienda (nunca ids) y el texto acotado a 50 caracteres.
--
-- Migración aditiva, sin cambios de datos. Reversión (migración posterior):
--   drop function public.exportar_clientes(text, text, boolean, uuid, integer, uuid, boolean);
--   alter function private.exportar_clientes_lote(text, text, boolean, uuid, integer, uuid, boolean) set schema public;
--   alter function public.exportar_clientes_lote(text, text, boolean, uuid, integer, uuid, boolean) rename to exportar_clientes;
--   grant execute on function public.exportar_clientes(text, text, boolean, uuid, integer, uuid, boolean) to authenticated;

alter function public.exportar_clientes(text, text, boolean, uuid, integer, uuid, boolean) rename to exportar_clientes_lote;
alter function public.exportar_clientes_lote(text, text, boolean, uuid, integer, uuid, boolean) set schema private;
revoke execute on function private.exportar_clientes_lote(text, text, boolean, uuid, integer, uuid, boolean) from public, anon, authenticated;

create function public.exportar_clientes(
  p_texto text default null,
  p_tipo text default null,
  p_archivados boolean default false,
  p_despues_de uuid default null,
  p_limite integer default 1000,
  p_empresa_id uuid default null,
  p_con_cuenta_web boolean default false
)
returns table (
  id uuid,
  numero integer,
  nombre text,
  documento text,
  tipo text,
  correo text,
  telefono text,
  celular text,
  direccion text,
  codigo_postal text,
  localidad text,
  provincia text,
  expreso_preferido text,
  archivado_en timestamptz,
  total bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fila record;
  v_total bigint := 0;
  v_n integer := 0;
  v_texto text := nullif(btrim(coalesce(p_texto, '')), '');
  v_filtros text[] := '{}';
  v_tienda text;
begin
  for v_fila in
    select * from private.exportar_clientes_lote(p_texto, p_tipo, p_archivados, p_despues_de, p_limite, p_empresa_id, p_con_cuenta_web)
  loop
    v_n := v_n + 1;
    if p_despues_de is null then v_total := v_fila.total; end if;
    id := v_fila.id; numero := v_fila.numero; nombre := v_fila.nombre; documento := v_fila.documento;
    tipo := v_fila.tipo; correo := v_fila.correo; telefono := v_fila.telefono; celular := v_fila.celular;
    direccion := v_fila.direccion; codigo_postal := v_fila.codigo_postal; localidad := v_fila.localidad;
    provincia := v_fila.provincia; expreso_preferido := v_fila.expreso_preferido;
    archivado_en := v_fila.archivado_en; total := v_fila.total;
    return next;
  end loop;

  -- Solo el primer lote (el permiso y el tope ya se validaron arriba) y solo si hay algo que exportar.
  if p_despues_de is null and v_n > 0 then
    if p_tipo is not null then v_filtros := v_filtros || ('tipo ' || left(p_tipo, 20)); end if;
    if coalesce(p_archivados, false) then v_filtros := v_filtros || 'archivados'::text; end if;
    if p_empresa_id is not null then
      select e.nombre into v_tienda from dominio.empresas e
       where e.id = p_empresa_id and e.organizacion_id = (select private.organizacion_id());
      v_filtros := v_filtros || ('tienda ' || coalesce(v_tienda, 'no disponible'));
    end if;
    if coalesce(p_con_cuenta_web, false) then v_filtros := v_filtros || 'con cuenta web'::text; end if;
    if v_texto is not null then v_filtros := v_filtros || ('texto «' || left(v_texto, 50) || '»'); end if;

    perform private.registrar_actividad(
      'clientes.exportados',
      left(
        format('Exportó %s %s a Excel%s',
          v_total,
          case when v_total = 1 then 'cliente' else 'clientes' end,
          case when cardinality(v_filtros) = 0 then '' else ' (filtros: ' || array_to_string(v_filtros, ', ') || ')' end),
        480)
    );
  end if;
end;
$$;

comment on function public.exportar_clientes(text, text, boolean, uuid, integer, uuid, boolean) is
  'Exportación de clientes por lotes (keyset lower(nombre), id). Envoltorio volatile de private.exportar_clientes_lote (permiso clientes/exportar, tope 50000, filtros) que registra la actividad clientes.exportados una vez por exportación, en el primer lote. F-CLI-04, MSF-508.';

revoke execute on function public.exportar_clientes(text, text, boolean, uuid, integer, uuid, boolean) from public, anon;
grant execute on function public.exportar_clientes(text, text, boolean, uuid, integer, uuid, boolean) to authenticated;
