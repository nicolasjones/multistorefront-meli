-- F-PRE-14 (retro QA): el mensaje de «No se puede archivar» se pluraliza en la base (antes «N cliente(s)»).
-- Misma firma, mismos grants y mismo cuerpo que 20270340000000; solo cambia el texto del error. Reversión: volver a aplicar
-- el cuerpo de `archivar_lista_precios` de 20270340000000_listas_precios.sql.

create or replace function public.archivar_lista_precios(p_id uuid, p_actualizado timestamptz default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_actual dominio.listas_precios;
  v_clientes bigint;
begin
  if v_organizacion is null or v_actor is null or not (select private.es_administrador_de(v_organizacion)) then
    raise exception 'Solo un administrador puede archivar listas de precios' using errcode = '42501';
  end if;
  select * into v_actual
    from dominio.listas_precios x
   where x.id = p_id and x.organizacion_id = v_organizacion
     for update;
  if not found then
    raise exception 'La lista de precios no existe' using errcode = 'P0002';
  end if;
  -- Archivar lo ya archivado no falla.
  if v_actual.archivada_en is not null then
    return;
  end if;
  if v_actual.updated_at is distinct from p_actualizado then
    raise exception 'La lista fue modificada por otra persona' using errcode = '40001';
  end if;
  v_clientes := (select private.cantidad_clientes_lista(v_actual.id));
  if v_clientes > 0 then
    raise exception '%', case when v_clientes = 1
        then 'No se puede archivar: 1 cliente usa esta lista. Reasignalo o quitale la lista primero.'
        else 'No se puede archivar: ' || v_clientes || ' clientes usan esta lista. Reasignalos o quitales la lista primero.' end
      using errcode = '23503', hint = 'clientes_asignados';
  end if;

  update dominio.listas_precios set archivada_en = now() where id = v_actual.id;

  perform private.insertar_cambio_actividad(
    v_organizacion, v_actor, 'lista_precios.archivada',
    'Archivó la lista de precios «' || v_actual.nombre || '» (' || private.texto_ajuste_lista(v_actual.ajuste_pct) || ')',
    jsonb_build_object('archivada', false), jsonb_build_object('archivada', true)
  );
end;
$$;
