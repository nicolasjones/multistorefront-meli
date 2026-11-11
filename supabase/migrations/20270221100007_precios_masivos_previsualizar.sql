-- F-PRE-10 (MSF-436, épica MSF-363): vista previa de la actualización masiva de costos y precios.
-- Esquemas (Principio VII): sin tablas nuevas. `private.calcular_actualizacion_precios` (cálculo
-- único, compartido con aplicar) vive en `private`; la RPC expuesta, en `public` (no almacena datos).
--
-- Las RPC son SECURITY DEFINER (justificado: aplicar escribe en `actualizaciones_precio`, que
-- `authenticated` no puede escribir; previsualizar comparte el mismo núcleo para que lo previsto sea
-- lo aplicado). Cada una exige `productos` = edicion, resuelve la organización con
-- `private.organizacion_id()` y el núcleo filtra por organización de forma explícita.
--
-- Modo porcentaje: { cambia: 'costo'|'precio_lista'|'ambos', alcance: 'todos'|<categoria_id>, porcentaje }.
--   Alcance = productos ACTIVOS (todos, o la categoría elegida con sus subcategorías).
-- Modo planilla: { filas: [{ fila, sku, costo?, precio_lista? }] }, sin IVA. Admite productos inactivos.
-- Redondeo a 2 decimales; tope de 5.000 productos por llamada.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.previsualizar_actualizacion_precios(text, jsonb);
--   drop function private.calcular_actualizacion_precios(uuid, boolean, text, jsonb);

create or replace function private.calcular_actualizacion_precios(
  p_org uuid,
  p_con_costo boolean,
  p_modo text,
  p_parametros jsonb
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  c_tope constant integer := 5000;
  v_filas jsonb[] := '{}';
  v_cambia text;
  v_alcance text;
  v_pct numeric;
  v_entrada jsonb;
  v_fila jsonb;
  v_i integer;
  v_numero integer;
  v_sku text;
  v_clave text;
  v_vistos text[] := '{}';
  v_repetidos text[] := '{}';
  v_nuevo_lista numeric;
  v_nuevo_costo numeric;
  v_error text;
  v_prod record;
  v_pid uuid;
  v_psku text;
  v_pnombre text;
  v_pmoneda text;
  v_plista numeric;
  v_pact timestamptz;
  v_pcosto numeric;
  v_lista_in jsonb;
  v_costo_in jsonb;
  v_categoria uuid;
begin
  if p_modo = 'porcentaje' then
    v_cambia := p_parametros->>'cambia';
    v_alcance := coalesce(p_parametros->>'alcance', 'todos');
    if v_cambia is null or v_cambia not in ('costo', 'precio_lista', 'ambos') then
      raise exception 'Elegí qué cambia: costo, precio de lista o ambos' using errcode = '22023';
    end if;
    if jsonb_typeof(p_parametros->'porcentaje') is distinct from 'number' then
      raise exception 'Ingresá el porcentaje' using errcode = '22023';
    end if;
    v_pct := (p_parametros->>'porcentaje')::numeric;
    if v_pct <= -100 or v_pct > 100000 then
      raise exception 'El porcentaje tiene que ser mayor a -100 %%' using errcode = '22023';
    end if;
    if v_alcance <> 'todos' then
      begin
        v_categoria := v_alcance::uuid;
      exception when invalid_text_representation then
        raise exception 'La categoría elegida no es válida' using errcode = '22023';
      end;
      if not exists (select 1 from dominio.categorias c where c.id = v_categoria and c.organizacion_id = p_org) then
        raise exception 'La categoría elegida no existe' using errcode = '22023';
      end if;
    end if;
    if (select count(*) from dominio.productos p
         where p.organizacion_id = p_org and p.activo
           and (v_categoria is null or p.categoria_id = v_categoria
                or p.categoria_id in (select h.id from dominio.categorias h
                                       where h.organizacion_id = p_org and h.padre_id = v_categoria))) > c_tope then
      raise exception 'La actualización admite hasta 5.000 productos por vez; elegí una categoría' using errcode = '54000';
    end if;

    for v_prod in
      select p.id, p.sku, p.nombre, p.moneda, p.precio_lista, p.updated_at, k.costo
        from dominio.productos p
        left join dominio.producto_costos k on k.producto_id = p.id and k.organizacion_id = p.organizacion_id
       where p.organizacion_id = p_org and p.activo
         and (v_categoria is null or p.categoria_id = v_categoria
              or p.categoria_id in (select h.id from dominio.categorias h
                                     where h.organizacion_id = p_org and h.padre_id = v_categoria))
       order by lower(p.nombre), p.id
    loop
      v_error := null;
      v_nuevo_lista := v_prod.precio_lista;
      v_nuevo_costo := v_prod.costo;
      if v_cambia in ('precio_lista', 'ambos') then
        v_nuevo_lista := round(v_prod.precio_lista * (1 + v_pct / 100), 2);
        if v_nuevo_lista <= 0 then
          v_error := 'El precio de lista quedaría en cero o menos';
        elsif v_nuevo_lista >= 1000000000000 then
          v_error := 'El precio de lista supera el máximo admitido';
        end if;
      end if;
      if p_con_costo and v_cambia in ('costo', 'ambos') and v_prod.costo is not null then
        v_nuevo_costo := round(v_prod.costo * (1 + v_pct / 100), 2);
        if v_nuevo_costo >= 1000000000000 then
          v_error := coalesce(v_error, 'El costo supera el máximo admitido');
        end if;
      end if;
      v_fila := jsonb_build_object(
        'fila', null, 'producto_id', v_prod.id, 'sku', v_prod.sku, 'nombre', v_prod.nombre,
        'moneda', v_prod.moneda, 'lista_antes', v_prod.precio_lista, 'lista_despues', v_nuevo_lista,
        'actualizado', v_prod.updated_at, 'error', v_error
      );
      if p_con_costo then
        v_fila := v_fila || jsonb_build_object('costo_antes', v_prod.costo, 'costo_despues', v_nuevo_costo);
      end if;
      v_fila := v_fila || jsonb_build_object('cambia',
        v_error is null and (v_nuevo_lista is distinct from v_prod.precio_lista
                             or (p_con_costo and v_nuevo_costo is distinct from v_prod.costo)));
      v_filas := array_append(v_filas, v_fila);
    end loop;

  elsif p_modo = 'planilla' then
    if jsonb_typeof(p_parametros->'filas') is distinct from 'array' or jsonb_array_length(p_parametros->'filas') = 0 then
      raise exception 'La planilla no tiene filas' using errcode = '22023';
    end if;
    if jsonb_array_length(p_parametros->'filas') > c_tope then
      raise exception 'La planilla admite hasta 5.000 filas por vez' using errcode = '54000';
    end if;

    -- SKU repetidos dentro de la planilla: ambas filas se marcan con error.
    for v_i in 0 .. jsonb_array_length(p_parametros->'filas') - 1 loop
      v_clave := lower(btrim(coalesce(p_parametros->'filas'->v_i->>'sku', '')));
      if v_clave <> '' then
        if v_clave = any (v_vistos) then
          v_repetidos := array_append(v_repetidos, v_clave);
        else
          v_vistos := array_append(v_vistos, v_clave);
        end if;
      end if;
    end loop;

    for v_i in 0 .. jsonb_array_length(p_parametros->'filas') - 1 loop
      v_entrada := p_parametros->'filas'->v_i;
      v_error := null;
      v_pid := null;
      v_numero := case when jsonb_typeof(v_entrada->'fila') = 'number' then (v_entrada->>'fila')::numeric::integer else v_i + 2 end;
      v_sku := btrim(coalesce(v_entrada->>'sku', ''));
      v_clave := lower(v_sku);
      v_lista_in := case when jsonb_typeof(v_entrada->'precio_lista') = 'number' then v_entrada->'precio_lista' end;
      v_costo_in := case when jsonb_typeof(v_entrada->'costo') = 'number' then v_entrada->'costo' end;
      v_nuevo_lista := null;
      v_nuevo_costo := null;

      if v_sku = '' then
        v_error := 'Falta el SKU';
      elsif v_clave = any (v_repetidos) then
        v_error := 'El SKU está repetido en la planilla';
      elsif v_lista_in is null and v_costo_in is null then
        v_error := 'Cargá el costo, el precio de lista o ambos (números válidos)';
      end if;

      if v_error is null then
        select p.id, p.sku, p.nombre, p.moneda, p.precio_lista, p.updated_at, k.costo
          into v_pid, v_psku, v_pnombre, v_pmoneda, v_plista, v_pact, v_pcosto
          from dominio.productos p
          left join dominio.producto_costos k on k.producto_id = p.id and k.organizacion_id = p.organizacion_id
         where p.organizacion_id = p_org and lower(btrim(p.sku)) = v_clave;
        if v_pid is null then
          v_error := 'No existe un producto con ese SKU';
        end if;
      end if;

      if v_error is null and v_lista_in is not null then
        v_nuevo_lista := (v_lista_in #>> '{}')::numeric;
        if v_nuevo_lista <= 0 then
          v_error := 'El precio de lista debe ser mayor a cero';
        elsif v_nuevo_lista <> round(v_nuevo_lista, 2) then
          v_error := 'El precio de lista admite hasta 2 decimales';
        elsif v_nuevo_lista >= 1000000000000 then
          v_error := 'El precio de lista supera el máximo admitido';
        end if;
      end if;
      if v_error is null and v_costo_in is not null then
        v_nuevo_costo := (v_costo_in #>> '{}')::numeric;
        if v_nuevo_costo < 0 then
          v_error := 'El costo no puede ser negativo';
        elsif v_nuevo_costo <> round(v_nuevo_costo, 2) then
          v_error := 'El costo admite hasta 2 decimales';
        elsif v_nuevo_costo >= 1000000000000 then
          v_error := 'El costo supera el máximo admitido';
        end if;
      end if;

      if v_pid is null then
        v_fila := jsonb_build_object(
          'fila', v_numero, 'producto_id', null, 'sku', nullif(v_sku, ''), 'nombre', null, 'moneda', null,
          'lista_antes', null, 'lista_despues', null, 'actualizado', null, 'error', v_error, 'cambia', false
        );
        if p_con_costo then
          v_fila := v_fila || jsonb_build_object('costo_antes', null, 'costo_despues', null);
        end if;
      else
        -- Sin la sección Rentabilidad el costo de la planilla se omite de la vista previa.
        v_nuevo_lista := coalesce(v_nuevo_lista, v_plista);
        v_nuevo_costo := case when p_con_costo then coalesce(v_nuevo_costo, v_pcosto) else v_pcosto end;
        v_fila := jsonb_build_object(
          'fila', v_numero, 'producto_id', v_pid, 'sku', v_psku, 'nombre', v_pnombre,
          'moneda', v_pmoneda, 'lista_antes', v_plista, 'lista_despues', v_nuevo_lista,
          'actualizado', v_pact, 'error', v_error
        );
        if p_con_costo then
          v_fila := v_fila || jsonb_build_object('costo_antes', v_pcosto, 'costo_despues', v_nuevo_costo);
        end if;
        v_fila := v_fila || jsonb_build_object('cambia',
          v_error is null and (v_nuevo_lista is distinct from v_plista
                               or (p_con_costo and v_nuevo_costo is distinct from v_pcosto)));
      end if;
      v_filas := array_append(v_filas, v_fila);
    end loop;
  else
    raise exception 'El modo debe ser porcentaje o planilla' using errcode = '22023';
  end if;

  return to_jsonb(v_filas);
end;
$$;

revoke execute on function private.calcular_actualizacion_precios(uuid, boolean, text, jsonb) from public, anon, authenticated;

comment on function private.calcular_actualizacion_precios(uuid, boolean, text, jsonb) is
  'F-PRE-10: núcleo único de la actualización masiva (vista previa y aplicar). Devuelve un arreglo de filas antes → después con error por fila.';

create or replace function public.previsualizar_actualizacion_precios(p_modo text, p_parametros jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_con_costo boolean := (select private.nivel_seccion('rentabilidad')) in ('lectura', 'edicion');
  v_filas jsonb;
begin
  if (select auth.uid()) is null or v_org is null or (select private.nivel_seccion('productos')) <> 'edicion' then
    raise exception 'Tu rol no puede actualizar precios' using errcode = '42501';
  end if;
  if p_parametros is null or jsonb_typeof(p_parametros) <> 'object' then
    raise exception 'Faltan los parámetros de la actualización' using errcode = '22023';
  end if;
  if p_modo = 'porcentaje' and not v_con_costo and p_parametros->>'cambia' = 'costo' then
    raise exception 'Tu rol no puede ver ni cambiar costos' using errcode = '42501';
  end if;

  v_filas := private.calcular_actualizacion_precios(v_org, v_con_costo, p_modo, p_parametros);

  return jsonb_build_object(
    'afectados', (select count(*) from jsonb_array_elements(v_filas) f where (f->>'cambia')::boolean),
    'sin_cambio', (select count(*) from jsonb_array_elements(v_filas) f
                    where f->>'error' is null and not (f->>'cambia')::boolean),
    'con_error', (select count(*) from jsonb_array_elements(v_filas) f where f->>'error' is not null),
    'filas', v_filas
  );
end;
$$;

comment on function public.previsualizar_actualizacion_precios(text, jsonb) is
  'F-PRE-10: vista previa antes → después de una actualización masiva. Solo lee. El costo solo se devuelve con la sección Rentabilidad.';

revoke execute on function public.previsualizar_actualizacion_precios(text, jsonb) from public, anon;
grant execute on function public.previsualizar_actualizacion_precios(text, jsonb) to authenticated;
