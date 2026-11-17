-- MSF-539 (seguimiento de MSF-298, hallazgos Baja 2, 3 y 5 de la revisión del PR #247). Migración aditiva.
--
-- Esquemas (Principio VII): sin tablas nuevas. Toca funciones de `private` y `public` del catálogo (`dominio.categorias` existente).
--
-- 2) DELETE directo sobre `dominio.categorias`: el grant `delete` a `authenticated` se conserva (lo necesitan `eliminar_categoria`, que es
--    `security invoker`, y la RLS `categorias_delete`), pero un DELETE hecho por fuera de la RPC no tomaba el candado asesor por organización
--    que sí toman el insert/update (`private.normalizar_categoria`). Se agrega un disparador `before delete` por fila que toma el mismo candado
--    (reentrante dentro de la misma transacción, así que `eliminar_categoria` no se bloquea a sí misma).
-- 3) `reordenar_categorias(p_orden)`: ahora limita el tamaño del arreglo (máximo 5000 categorías por llamada, 22023) para acotar el trabajo
--    bajo el candado. Concurrencia (documentada): el cliente manda el árbol completo y las llamadas se serializan por el candado, así que gana
--    la última que confirma; no hay control de versión. Cuerpo = el de `20261020140100` (definición vigente) más el límite.
-- 5) `asignar_categoria_producto`: una persona con edición en productos y SIN lectura en categorías recibía «La categoría no existe» (P0002)
--    por la RLS. Ahora, al asignar una categoría (no al quitarla), si no puede leer categorías falla con 42501 y un mensaje de permiso.
--    Cuerpo = el de `20261020140200` (definición vigente) más esa verificación.
--
-- Reversión: `drop trigger categorias_baja_candado on dominio.categorias; drop function private.bloquear_categoria_baja();` y volver a crear
-- las dos funciones públicas con el cuerpo de `20261020140100` y `20261020140200`.

-- 2) Candado en la baja.
create or replace function private.bloquear_categoria_baja()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('categorias:' || old.organizacion_id::text, 0));
  return old;
end;
$$;

revoke execute on function private.bloquear_categoria_baja() from public, anon, authenticated;

create trigger categorias_baja_candado
  before delete on dominio.categorias
  for each row execute function private.bloquear_categoria_baja();

-- 3) Límite de tamaño del orden.
create or replace function public.reordenar_categorias(p_orden jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_cambios integer;
  v_total integer;
  v_distintos integer;
  v_validos integer;
begin
  if v_org is null or (select private.nivel_seccion('categorias')) <> 'edicion' then
    raise exception 'Tu rol no puede editar categorías' using errcode = '42501';
  end if;
  if p_orden is null or jsonb_typeof(p_orden) <> 'array' then
    raise exception 'El orden debe ser una lista de categorías' using errcode = '22023';
  end if;
  if jsonb_array_length(p_orden) > 5000 then
    raise exception 'El orden admite hasta 5000 categorías por vez' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('categorias:' || v_org::text, 0));

  begin
    select count(*), count(distinct x.id),
           count(*) filter (where x.id is not null and x.posicion is not null and x.posicion >= 0)
      into v_total, v_distintos, v_validos
      from jsonb_to_recordset(p_orden) as x(id uuid, padre_id uuid, posicion integer);
  exception when invalid_text_representation or numeric_value_out_of_range or datatype_mismatch then
    raise exception 'El orden tiene valores inválidos' using errcode = '22023';
  end;
  if v_total <> v_validos or v_total <> v_distintos then
    raise exception 'El orden tiene categorías repetidas o valores inválidos' using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_orden) as x(id uuid, padre_id uuid, posicion integer)
     where not exists (select 1 from dominio.categorias c where c.id = x.id and c.organizacion_id = v_org)
        or (x.padre_id is not null
            and not exists (select 1 from dominio.categorias c where c.id = x.padre_id and c.organizacion_id = v_org))
  ) then
    raise exception 'Alguna categoría no existe' using errcode = 'P0002';
  end if;

  begin
    perform set_config('catalogo.cat_ctx', 'reordenar', true);
    -- Una sola sentencia: un solo evento de Actividad y los 2 niveles se validan sobre el estado final.
    update dominio.categorias c
       set padre_id = x.padre_id, posicion = x.posicion
      from jsonb_to_recordset(p_orden) as x(id uuid, padre_id uuid, posicion integer)
     where c.id = x.id
       and c.organizacion_id = v_org
       and (c.padre_id is distinct from x.padre_id or c.posicion <> x.posicion);
    get diagnostics v_cambios = row_count;
    set constraints dominio.categorias_dos_niveles immediate;
    perform set_config('catalogo.cat_ctx', '', true);
  exception when unique_violation then
    raise exception 'Ya existe una categoría con ese nombre en ese nivel' using errcode = '23505';
  end;

  return v_cambios;
end;
$$;

comment on function public.reordenar_categorias(jsonb) is
  'F-CAT-08: persiste padre y posición de las categorías ([{id, padre_id, posicion}], hasta 5000) de forma atómica, con candado por organización y validación de 2 niveles sobre el estado final. Gana la última llamada que confirma (se serializan por el candado). Devuelve cuántas cambiaron.';

revoke execute on function public.reordenar_categorias(jsonb) from public, anon;
grant execute on function public.reordenar_categorias(jsonb) to authenticated;

-- 5) Mensaje de permiso al asignar categoría.
create or replace function public.asignar_categoria_producto(p_producto_id uuid, p_categoria_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
begin
  if v_org is null or (select private.nivel_seccion('productos')) <> 'edicion' then
    raise exception 'Tu rol no puede editar productos' using errcode = '42501';
  end if;
  if p_categoria_id is not null and (select private.nivel_seccion('categorias')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver categorías, así que no puede asignarlas' using errcode = '42501';
  end if;
  if not exists (select 1 from dominio.productos p where p.id = p_producto_id and p.organizacion_id = v_org) then
    raise exception 'El producto no existe' using errcode = 'P0002';
  end if;
  if p_categoria_id is not null and not exists (
    select 1 from dominio.categorias c where c.id = p_categoria_id and c.organizacion_id = v_org
  ) then
    raise exception 'La categoría no existe' using errcode = 'P0002';
  end if;

  -- Solo si cambia: repetir la misma categoría no escribe ni deja evento (idempotente).
  update dominio.productos p
     set categoria_id = p_categoria_id
   where p.id = p_producto_id and p.organizacion_id = v_org
     and p.categoria_id is distinct from p_categoria_id;

  return p_categoria_id;
end;
$$;

comment on function public.asignar_categoria_producto(uuid, uuid) is
  'F-CAT-08: asigna (o quita, con null) la categoría de un producto. Exige edición en productos y, para asignar, lectura de categorías (42501); P0002 producto o categoría inexistentes. Idempotente.';

revoke execute on function public.asignar_categoria_producto(uuid, uuid) from public, anon;
grant execute on function public.asignar_categoria_producto(uuid, uuid) to authenticated;
