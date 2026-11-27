-- MSF-973 (seguimiento de la Fase 5 de listas de precios, lote 93): asignar una lista de precios a muchos clientes a la vez.
-- Por selección (`p_clientes`) o por filtro (los mismos criterios del listado de Clientes: texto, tipo, tienda y cuenta web). Reusa la
-- regla de una sola persona (`asignar_lista_precios_cliente`, 20270340000200): solo Administrador (`42501`), bandera apagada `55000`
-- salvo quitar, lista inexistente `PT404`, lista archivada `22023`; el Consumidor final y los archivados no admiten lista (se cuentan
-- como «omitidos», no abortan el lote). Quitar la lista (`p_lista` nulo) sigue permitido con la bandera apagada.
--
-- Esquemas (Principio VII): sin tablas nuevas; función de superficie en `public`. Un solo evento de Actividad por llamada
-- (`cliente.lista_precio_asignada_masiva`) en lugar de uno por cliente: el detalle dice cuántos clientes y qué lista.
--
-- Selección (`p_clientes`) y filtros son excluyentes (`22023`): combinar las dos ignoraría los filtros en silencio.
--
-- Tope: 5000 clientes por llamada (`54000`), en selección y en filtro. La organización y el actor salen de la sesión.
--
-- Migración aditiva e idempotente. Reversión (migración posterior):
--   drop function public.asignar_lista_precios_masiva(uuid, uuid[], text, text, uuid, boolean);
--   delete from public.tipos_evento_actividad where tipo = 'cliente.lista_precio_asignada_masiva';

insert into public.tipos_evento_actividad (tipo, sensible, descripcion) values
  ('cliente.lista_precio_asignada_masiva', false, 'Lista de precios asignada o quitada a varios clientes a la vez (cantidad y lista)')
on conflict (tipo) do nothing;

create or replace function public.asignar_lista_precios_masiva(
  p_lista uuid,
  p_clientes uuid[] default null,
  p_texto text default null,
  p_tipo text default null,
  p_empresa_id uuid default null,
  p_con_cuenta_web boolean default false
)
returns table (asignados integer, sin_cambios integer, omitidos integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_tope constant integer := 5000;
  v_lista dominio.listas_precios;
  v_pedidos integer;
  v_ids uuid[];
  v_elegibles uuid[];
  v_cambiar uuid[];
  v_asignados integer;
begin
  if v_organizacion is null or v_actor is null or not (select private.es_administrador_de(v_organizacion)) then
    raise exception 'Solo un administrador puede asignar una lista de precios' using errcode = '42501';
  end if;
  -- Selección y filtros no se combinan: con `p_clientes` los filtros se ignorarían en silencio.
  if p_clientes is not null
     and (nullif(btrim(coalesce(p_texto, '')), '') is not null or p_tipo is not null or p_empresa_id is not null
          or coalesce(p_con_cuenta_web, false)) then
    raise exception 'Elegí clientes marcados o filtros, no las dos cosas' using errcode = '22023';
  end if;
  if p_tipo is not null and p_tipo not in ('minorista', 'mayorista') then
    raise exception 'El tipo de cliente tiene que ser minorista o mayorista' using errcode = '22023';
  end if;
  if p_lista is not null and not (select private.bandera_activa('listas_precios')) then
    raise exception 'Las listas de precios están desactivadas en este entorno' using errcode = '55000';
  end if;
  if p_lista is not null then
    select * into v_lista from dominio.listas_precios l where l.id = p_lista and l.organizacion_id = v_organizacion;
    if not found then
      raise exception 'La lista de precios no existe' using errcode = 'PT404';
    end if;
    if v_lista.archivada_en is not null then
      raise exception 'La lista de precios está archivada' using errcode = '22023';
    end if;
  end if;

  if p_clientes is not null then
    -- Por selección: sin repetidos; lo que no existe en la organización cuenta como omitido.
    select coalesce(array_agg(distinct x), array[]::uuid[]) into v_ids from unnest(p_clientes) as x where x is not null;
    v_pedidos := cardinality(v_ids);
    if v_pedidos > v_tope then
      raise exception 'Se pueden asignar hasta % clientes por vez: afiná la selección', v_tope using errcode = '54000';
    end if;
    select coalesce(array_agg(c.id order by c.id), array[]::uuid[]) into v_ids
      from dominio.clientes c
     where c.organizacion_id = v_organizacion and c.id = any (v_ids);
  else
    -- Por filtro: los mismos criterios que el listado y el correo masivo (activos, sin Consumidor final).
    select coalesce(array_agg(c.id order by c.id), array[]::uuid[]) into v_ids
      from private.clientes_para_correo_masivo(p_texto, p_tipo, p_empresa_id, p_con_cuenta_web, null) c;
    v_pedidos := cardinality(v_ids);
    if v_pedidos > v_tope then
      raise exception 'Son más de % clientes: afiná el filtro', v_tope using errcode = '54000';
    end if;
  end if;

  -- Elegibles: para asignar, activos y que no sean el Consumidor final; para quitar, cualquiera.
  -- Se bloquean en orden de id para no cruzarse con otro lote.
  select coalesce(array_agg(c.id order by c.id), array[]::uuid[]) into v_elegibles
    from (
      select c.id
        from dominio.clientes c
       where c.organizacion_id = v_organizacion and c.id = any (v_ids)
         and (p_lista is null or (c.archivado_en is null and not c.es_consumidor_final))
       order by c.id
         for update
    ) c;

  select coalesce(array_agg(c.id), array[]::uuid[]) into v_cambiar
    from dominio.clientes c
   where c.organizacion_id = v_organizacion and c.id = any (v_elegibles)
     and c.lista_precio_id is distinct from p_lista;

  update dominio.clientes c set lista_precio_id = p_lista where c.id = any (v_cambiar);
  get diagnostics v_asignados = row_count;

  if v_asignados > 0 then
    perform private.insertar_cambio_actividad(
      v_organizacion, v_actor, 'cliente.lista_precio_asignada_masiva',
      case when p_lista is null
           then format('Quitó la lista de precios a %s clientes', v_asignados)
           else format('Asignó la lista de precios «%s» a %s clientes', v_lista.nombre, v_asignados) end,
      null,
      case when p_lista is null then jsonb_build_object('clientes', v_asignados)
           else jsonb_build_object('lista_id', v_lista.id, 'lista', v_lista.nombre, 'ajuste_pct', v_lista.ajuste_pct, 'clientes', v_asignados) end
    );
  end if;

  asignados := v_asignados;
  sin_cambios := cardinality(v_elegibles) - v_asignados;
  -- Omitidos (solo en selección): inexistentes, archivados o Consumidor final al asignar.
  omitidos := case when p_clientes is not null then v_pedidos - cardinality(v_elegibles) else 0 end;
  return next;
end;
$$;

comment on function public.asignar_lista_precios_masiva(uuid, uuid[], text, text, uuid, boolean) is
  'MSF-973: asigna (o quita, con p_lista null) una lista de precios a varios clientes: por selección (p_clientes) o por filtro (texto, tipo, tienda, cuenta web). Solo Administrador; tope 5000; devuelve asignados, sin cambios y omitidos (archivados, Consumidor final o inexistentes). Un solo evento de Actividad.';

revoke execute on function public.asignar_lista_precios_masiva(uuid, uuid[], text, text, uuid, boolean) from public, anon;
grant execute on function public.asignar_lista_precios_masiva(uuid, uuid[], text, text, uuid, boolean) to authenticated;
