-- F-PRE-12 (MSF-200, épica MSF-114): IVA por categoría y por producto.
-- Esquemas (Principio VII), verificados objeto por objeto:
--   dominio.categorias.alicuota_iva_id   dominio (columna aditiva)  la tabla ya vive en `dominio`; FK compuesta
--                                                                    (alicuota_iva_id, organizacion_id).
--   dominio.productos.alicuota_iva_id    dominio (columna aditiva)  ídem; nulo = hereda la de la categoría.
--   public.guardar_alicuota_categoria / public.asignar_alicuota_producto   RPC (contrato de la app).
--   private.alicuota_producto             función de cálculo, sin `execute` para `anon`.
-- No se crea ninguna tabla.
--
-- Herencia (FR-017): alícuota del producto = la propia si existe, si no la de su categoría.
-- `private.alicuota_producto` es SECURITY DEFINER solo para resolver ESTA búsqueda aunque quien
-- llama no tenga la sección `categorias`; está acotada a la organización del llamador y devuelve
-- únicamente la alícuota (id, nombre, porcentaje, exento), nunca datos de la categoría.
--
-- Categorías existentes quedan en 21 %; las nuevas nacen en 21 % (disparador) hasta que se elija otra.
-- Cambiar solo `alicuota_iva_id` del producto no avanza `updated_at` (`conservar_updated_at_producto` no
-- lo cuenta) ni deja `producto.editado`: el evento propio es `producto.precio_actualizado` (FR-017).
--
-- Errores: 42501 sin permiso · P0002 categoría, producto o alícuota inexistente (o ajena) ·
-- 23514 alícuota inactiva.
--
-- Migración aditiva. Reversión (migración posterior; exportar antes las asignaciones):
--   drop trigger productos_registrar_alicuota on dominio.productos;
--   drop function private.registrar_alicuota_producto();
--   drop function public.asignar_alicuota_producto(uuid, uuid);
--   drop function private.alicuota_producto(uuid);
--   drop function public.guardar_alicuota_categoria(uuid, uuid);
--   drop trigger categorias_alicuota_inicial on dominio.categorias;
--   drop function private.alicuota_inicial_categoria();
--   alter table dominio.productos drop column alicuota_iva_id;
--   alter table dominio.categorias drop column alicuota_iva_id;

alter table dominio.categorias add column alicuota_iva_id uuid;
alter table dominio.productos add column alicuota_iva_id uuid;

alter table dominio.categorias
  add constraint categorias_alicuota_iva_fk
  foreign key (alicuota_iva_id, organizacion_id)
  references dominio.alicuotas_iva (id, organizacion_id);

alter table dominio.productos
  add constraint productos_alicuota_iva_fk
  foreign key (alicuota_iva_id, organizacion_id)
  references dominio.alicuotas_iva (id, organizacion_id);

comment on column dominio.categorias.alicuota_iva_id is
  'F-PRE-12: alícuota de IVA de la categoría. Se asigna con public.guardar_alicuota_categoria; las nuevas nacen en 21 %.';
comment on column dominio.productos.alicuota_iva_id is
  'F-PRE-12: alícuota propia del producto (nulo = hereda la de su categoría). Se asigna con public.asignar_alicuota_producto.';

create index categorias_alicuota_idx on dominio.categorias (organizacion_id, alicuota_iva_id);
create index productos_alicuota_idx on dominio.productos (organizacion_id, alicuota_iva_id)
  where alicuota_iva_id is not null;

-- Categorías existentes: 21 % de su organización.
update dominio.categorias c
   set alicuota_iva_id = a.id
  from dominio.alicuotas_iva a
 where a.organizacion_id = c.organizacion_id
   and a.nombre = '21 %'
   and c.alicuota_iva_id is null;

-- Categorías nuevas: 21 % si el alta no trae una alícuota.
create or replace function private.alicuota_inicial_categoria()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.alicuota_iva_id is null then
    select a.id into new.alicuota_iva_id
      from dominio.alicuotas_iva a
     where a.organizacion_id = new.organizacion_id and a.nombre = '21 %';
  end if;
  return new;
end;
$$;

revoke execute on function private.alicuota_inicial_categoria() from public, anon, authenticated;

create trigger categorias_alicuota_inicial
  before insert on dominio.categorias
  for each row execute function private.alicuota_inicial_categoria();

grant update (alicuota_iva_id) on dominio.categorias to authenticated;
grant update (alicuota_iva_id) on dominio.productos to authenticated;

-- ============================================================================
-- RPC: IVA de la categoría
-- ============================================================================

create or replace function public.guardar_alicuota_categoria(p_categoria uuid, p_alicuota uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_activa boolean;
begin
  if v_org is null or (select private.nivel_seccion('categorias')) <> 'edicion' then
    raise exception 'Tu rol no puede editar categorías' using errcode = '42501';
  end if;
  if not exists (select 1 from dominio.categorias c where c.id = p_categoria and c.organizacion_id = v_org) then
    raise exception 'La categoría no existe' using errcode = 'P0002';
  end if;
  select a.activa into v_activa
    from dominio.alicuotas_iva a where a.id = p_alicuota and a.organizacion_id = v_org;
  if not found then
    raise exception 'La alícuota de IVA no existe' using errcode = 'P0002';
  end if;
  if not v_activa then
    raise exception 'La alícuota de IVA no está activa' using errcode = '23514';
  end if;

  -- Solo si cambia: repetir la misma alícuota no escribe (idempotente).
  update dominio.categorias c
     set alicuota_iva_id = p_alicuota
   where c.id = p_categoria and c.organizacion_id = v_org
     and c.alicuota_iva_id is distinct from p_alicuota;

  return p_alicuota;
end;
$$;

comment on function public.guardar_alicuota_categoria(uuid, uuid) is
  'F-PRE-12: asigna la alícuota de IVA de una categoría. Exige edición en categorias; P0002 inexistente, 23514 inactiva. Idempotente.';

revoke execute on function public.guardar_alicuota_categoria(uuid, uuid) from public, anon;
grant execute on function public.guardar_alicuota_categoria(uuid, uuid) to authenticated;

-- ============================================================================
-- Alícuota efectiva del producto (propia o de la categoría)
-- ============================================================================

create or replace function private.alicuota_producto(p_producto uuid)
returns table (alicuota_id uuid, nombre text, porcentaje numeric, exento boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.nombre, a.porcentaje, a.exento
    from dominio.productos p
    left join dominio.categorias c
      on c.id = p.categoria_id and c.organizacion_id = p.organizacion_id
    join dominio.alicuotas_iva a
      on a.id = coalesce(p.alicuota_iva_id, c.alicuota_iva_id) and a.organizacion_id = p.organizacion_id
   where p.id = p_producto
     and p.organizacion_id = (select private.organizacion_id());
$$;

comment on function private.alicuota_producto(uuid) is
  'F-PRE-12: alícuota efectiva de un producto = la propia, si no la de su categoría; sin filas si no tiene ninguna. Acotada a la organización del llamador.';

revoke execute on function private.alicuota_producto(uuid) from public, anon;
grant execute on function private.alicuota_producto(uuid) to authenticated;

-- ============================================================================
-- RPC: IVA propio del producto (nulo = hereda de la categoría)
-- ============================================================================

create or replace function public.asignar_alicuota_producto(p_producto uuid, p_alicuota uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_activa boolean;
begin
  if v_org is null or (select private.nivel_seccion('productos')) <> 'edicion' then
    raise exception 'Tu rol no puede editar productos' using errcode = '42501';
  end if;
  if not exists (select 1 from dominio.productos p where p.id = p_producto and p.organizacion_id = v_org) then
    raise exception 'El producto no existe' using errcode = 'P0002';
  end if;
  if p_alicuota is not null then
    select a.activa into v_activa
      from dominio.alicuotas_iva a where a.id = p_alicuota and a.organizacion_id = v_org;
    if not found then
      raise exception 'La alícuota de IVA no existe' using errcode = 'P0002';
    end if;
    if not v_activa then
      raise exception 'La alícuota de IVA no está activa' using errcode = '23514';
    end if;
  end if;

  update dominio.productos p
     set alicuota_iva_id = p_alicuota
   where p.id = p_producto and p.organizacion_id = v_org
     and p.alicuota_iva_id is distinct from p_alicuota;

  return p_alicuota;
end;
$$;

comment on function public.asignar_alicuota_producto(uuid, uuid) is
  'F-PRE-12: asigna (o quita, con null = hereda de la categoría) el IVA propio de un producto. Exige edición en productos; P0002 inexistente, 23514 inactiva. Idempotente.';

revoke execute on function public.asignar_alicuota_producto(uuid, uuid) from public, anon;
grant execute on function public.asignar_alicuota_producto(uuid, uuid) to authenticated;

-- ============================================================================
-- Actividad: el cambio de IVA del producto es un cambio de precio (FR-017)
-- ============================================================================

create or replace function private.registrar_alicuota_producto()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_antes text;
  v_despues text;
begin
  if v_actor is null or new.alicuota_iva_id is not distinct from old.alicuota_iva_id then
    return new;
  end if;
  select a.nombre into v_antes from dominio.alicuotas_iva a where a.id = old.alicuota_iva_id;
  select a.nombre into v_despues from dominio.alicuotas_iva a where a.id = new.alicuota_iva_id;
  perform private.insertar_actividad(
    new.organizacion_id, v_actor, 'producto.precio_actualizado',
    format('Cambió el IVA de %s: %s → %s', new.nombre,
      coalesce(v_antes, 'el de la categoría'), coalesce(v_despues, 'el de la categoría')),
    null
  );
  return new;
end;
$$;

revoke execute on function private.registrar_alicuota_producto() from public, anon, authenticated;

create trigger productos_registrar_alicuota
  after update of alicuota_iva_id on dominio.productos
  for each row execute function private.registrar_alicuota_producto();
