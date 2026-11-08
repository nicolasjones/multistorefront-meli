-- MSF-392 / F-CAT-12, hallazgo de Code Review: el tope de 100 ids de la edición masiva se contaba DESPUÉS
-- de quitar los repetidos. El contrato (`specs/20261103-100000-catalogo-productividad/contracts/edicion-masiva.md`
-- y la historia) lo define sobre la entrada ANTES del dedup: más de 100 ids recibidos es `22023` aunque
-- los distintos sean 100 o menos. Se redefine solo `private.bloquear_productos_masivo` (misma firma); las
-- tres RPC públicas la llaman, así que el tope vale para todas sin tocarlas.
--
-- Esquemas (Principio VII): no se crea ni altera ninguna tabla. Migración aditiva (`create or replace`,
-- misma firma, mismos grants). La función sigue siendo `security invoker` con `set search_path = ''`.
-- Contrato de errores sin cambios de código: 42501 sin permiso; 22023 lista vacía/nula, valores nulos,
-- más de 100 ids recibidos o argumentos inválidos (incluida la empresa inexistente o ajena, que se valida
-- antes de bloquear los productos, igual que la RPC individual); P0002 producto o categoría inexistente o
-- de otra organización.
--
-- Reversión (migración posterior): volver a `create or replace` con el cuerpo de
-- `20270215100000_catalogo_edicion_masiva.sql` (tope sobre los ids ya sin repetir).

create or replace function private.bloquear_productos_masivo(p_ids uuid[], p_org uuid)
returns uuid[]
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_bloqueados uuid[];
begin
  if p_ids is null or cardinality(p_ids) = 0 then
    raise exception 'Elegí al menos un producto' using errcode = '22023';
  end if;
  -- El tope se mide sobre lo recibido, antes de quitar los repetidos.
  if cardinality(p_ids) > 100 then
    raise exception 'Se pueden editar hasta 100 productos a la vez' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_ids) as x(id) where x.id is null) then
    raise exception 'La lista de productos tiene valores vacíos' using errcode = '22023';
  end if;
  select array_agg(distinct x.id order by x.id) into v_ids from unnest(p_ids) as x(id);

  select coalesce(array_agg(l.id order by l.id), '{}'::uuid[]) into v_bloqueados
    from (
      select p.id from dominio.productos p
       where p.id = any (v_ids) and p.organizacion_id = p_org
       order by p.id
       for update
    ) l;
  if cardinality(v_bloqueados) <> cardinality(v_ids) then
    raise exception 'Alguno de los productos no existe o no pertenece a tu organización' using errcode = 'P0002';
  end if;
  return v_ids;
end;
$$;

comment on function private.bloquear_productos_masivo(uuid[], uuid) is
  'F-CAT-12: valida la lista (1 a 100 ids recibidos, contados antes de quitar repetidos; sin nulos), comprueba que son de la organización y bloquea las filas en orden de id. Devuelve los ids sin repetir.';

revoke execute on function private.bloquear_productos_masivo(uuid[], uuid) from public, anon;
grant execute on function private.bloquear_productos_masivo(uuid[], uuid) to authenticated;
