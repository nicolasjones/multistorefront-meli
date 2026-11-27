-- MSF-974 (seguimiento de la Fase 5 de listas de precios, lote 93): la planilla de clientes incluye la columna «Lista de precios».
-- Decisión (por delegación de Nicolás): la EXPORTACIÓN la incluye; la IMPORTACIÓN no la lee (asignar una lista es de Administrador y
-- se hace desde la ficha, desde la asignación masiva o por tipo de cliente; una planilla no es un camino de asignación).
--
-- En vez de redefinir `public.exportar_clientes` (topes por persona, ventana y auditoría: 20270347000000) se agrega una función de lectura
-- que resuelve la lista de un lote de clientes; el cliente web la llama con los ids de cada tanda de la exportación. Mismo permiso que la
-- exportación (`private.puede_accion('clientes', 'exportar')`), así que no abre datos a quien no puede exportar. Devuelve el nombre de la
-- lista PROPIA del cliente o, si no tiene, la de su tipo (`origen` = 'cliente' o 'tipo'); no depende de la bandera (es un dato guardado).
--
-- Esquemas (Principio VII): sin tablas nuevas; función de superficie en `public`. Tope de 1000 ids por llamada (`54000`, igual que el lote
-- de la exportación). La organización sale de la sesión; los ids de otra organización no devuelven filas.
--
-- Migración aditiva. Reversión (migración posterior): drop function public.listas_de_clientes_para_exportar(uuid[]);

create or replace function public.listas_de_clientes_para_exportar(p_clientes uuid[])
returns table (cliente_id uuid, lista_nombre text, origen text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
begin
  if (select auth.uid()) is null or v_organizacion is null
     or not (select private.puede_accion('clientes', 'exportar')) then
    raise exception 'No tenés permiso para exportar clientes' using errcode = '42501';
  end if;
  if p_clientes is not null and cardinality(p_clientes) > 1000 then
    raise exception 'Se pueden consultar hasta 1000 clientes por vez' using errcode = '54000';
  end if;

  return query
  select c.id,
         coalesce(lc.nombre, lt.nombre),
         case when lc.id is not null then 'cliente' else 'tipo' end
    from dominio.clientes c
    left join dominio.listas_precios lc
      on lc.organizacion_id = c.organizacion_id and lc.id = c.lista_precio_id
    left join dominio.listas_precios_tipo_cliente t
      on t.organizacion_id = c.organizacion_id and t.tipo = c.tipo and c.lista_precio_id is null and not c.es_consumidor_final
    left join dominio.listas_precios lt
      on lt.organizacion_id = t.organizacion_id and lt.id = t.lista_precio_id
   where c.organizacion_id = v_organizacion
     and c.id = any (coalesce(p_clientes, array[]::uuid[]))
     and coalesce(lc.id, lt.id) is not null;
end;
$$;

comment on function public.listas_de_clientes_para_exportar(uuid[]) is
  'MSF-974: lista de precios de cada cliente de un lote (hasta 1000), la propia o la de su tipo, para la columna «Lista de precios» de la exportación de clientes. Exige la acción exportar de Clientes. Solo devuelve clientes con lista.';

revoke execute on function public.listas_de_clientes_para_exportar(uuid[]) from public, anon;
grant execute on function public.listas_de_clientes_para_exportar(uuid[]) to authenticated;
