-- MSF-530 (seguimiento de MSF-205, lote 93): varios proveedores por producto, con UNO principal; costo y código del proveedor por
-- vínculo. Decisiones (resueltas con la opción más simple y compatible con lo existente; detalle en .specify/bugs/msf-530/fix.md):
--   1. Proveedor principal OPCIONAL: a lo sumo uno marcado por producto (índice único parcial). Quitar el principal no promueve a otro.
--   2. Atributos por vínculo: código del proveedor y costo. El plazo de pago NO va por producto: es del proveedor (MSF-523).
--   3. El prototipo no se rediseña: el selector «Proveedor» y el código del formulario siguen siendo el PRINCIPAL; los demás
--      proveedores se administran en una sección propia de la edición del producto (queda declarado fuera de la matriz).
--
-- Compatibilidad: `dominio.productos.proveedor_id` y `codigo_proveedor` pasan a ser el ESPEJO del vínculo principal (reportes,
-- exportaciones, `crear_producto` y `actualizar_producto` siguen igual). Un disparador en `productos` refleja los cambios que entran por
-- esas columnas hacia la tabla nueva; las RPC nuevas escriben la tabla y el espejo con `private.fijar_proveedor_principal`. Costo
-- efectivo: el del producto (`producto_costos`) sale del principal; si el principal tiene costo en su vínculo se copia al producto, y
-- un cambio del costo del producto se copia al vínculo principal. Ambos sentidos se protegen con la marca de sesión
-- `catalogo.sincronizando_proveedores` para no entrar en bucle.
--
-- Esquemas (Principio VII): `dominio.productos_proveedores` es relación de negocio entre dos entidades de `dominio` → `dominio`.
-- Seguridad: RLS por organización y sección `productos`; la tabla NO concede `select` sobre `costo` a `authenticated` (el costo se lee solo
-- por `listar_proveedores_de_producto`, que lo entrega a quien ve Rentabilidad); escritura solo por RPC `security definer`; sin DELETE
-- directo; `anon` sin acceso; FK compuestas por organización.
--
-- Errores (docs/errores-negocio-postgrest.md): `42501` sin permiso, `PT404` producto, proveedor o vínculo inexistente, `PT409`
-- proveedor desactivado, `22023` dato inválido.
--
-- Migración aditiva (no se borran las columnas viejas). Reversión (migración posterior; exportar antes los datos):
--   drop function public.marcar_proveedor_principal(uuid, uuid);
--   drop function public.quitar_proveedor_producto(uuid, uuid);
--   drop function public.asignar_proveedor_producto(uuid, uuid, text, numeric, boolean);
--   drop function public.listar_proveedores_de_producto(uuid);
--   drop trigger producto_costos_sincronizar_vinculo on dominio.producto_costos;
--   drop trigger productos_sincronizar_vinculo on dominio.productos;
--   drop function private.sincronizar_costo_a_vinculo_principal(); drop function private.sincronizar_vinculo_principal_producto();
--   drop function private.fijar_proveedor_principal(uuid, uuid, uuid);
--   -- restaurar productos_de_proveedor de 20261019120001 (lee dominio.productos.proveedor_id)
--   drop table dominio.productos_proveedores;

create table if not exists dominio.productos_proveedores (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null default private.organizacion_id()
    references public.organizaciones (id) on delete cascade,
  producto_id uuid not null,
  proveedor_id uuid not null,
  codigo_proveedor text check (char_length(codigo_proveedor) <= 80),
  -- Costo del producto con ESTE proveedor, en la moneda del producto. Nulo = sin dato.
  costo numeric(14, 2) check (costo >= 0),
  principal boolean not null default false,
  creado_en timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint productos_proveedores_unico_uq unique (producto_id, proveedor_id),
  foreign key (producto_id, organizacion_id)
    references dominio.productos (id, organizacion_id) on delete cascade,
  foreign key (proveedor_id, organizacion_id)
    references dominio.proveedores (id, organizacion_id) on delete restrict
);

comment on table dominio.productos_proveedores is
  'MSF-530: proveedores de un producto (varios, a lo sumo uno principal), con código y costo por vínculo. productos.proveedor_id/codigo_proveedor son el espejo del principal. Escritura solo por RPC.';
comment on column dominio.productos_proveedores.costo is
  'Costo con este proveedor. El del principal alimenta el costo del producto (producto_costos). Sin select para authenticated: se lee por listar_proveedores_de_producto.';

create unique index if not exists productos_proveedores_un_principal_idx
  on dominio.productos_proveedores (producto_id) where principal;
create index if not exists productos_proveedores_proveedor_idx
  on dominio.productos_proveedores (organizacion_id, proveedor_id);
create index if not exists productos_proveedores_producto_org_idx
  on dominio.productos_proveedores (producto_id, organizacion_id);

alter table dominio.productos_proveedores enable row level security;

drop policy if exists productos_proveedores_select on dominio.productos_proveedores;
create policy productos_proveedores_select on dominio.productos_proveedores
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('productos')) in ('lectura', 'edicion')
  );

grant usage on schema dominio to authenticated;

revoke all on dominio.productos_proveedores from public, anon, authenticated;
grant select (id, organizacion_id, producto_id, proveedor_id, codigo_proveedor, principal, creado_en, updated_at)
  on dominio.productos_proveedores to authenticated;
grant select, insert, update, delete on dominio.productos_proveedores to service_role;

-- ============================================================================
-- Principal: tabla y espejo en `productos` (y costo efectivo) en un solo lugar
-- ============================================================================

create or replace function private.fijar_proveedor_principal(p_organizacion uuid, p_producto uuid, p_proveedor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_codigo text;
  v_costo numeric;
begin
  perform set_config('catalogo.sincronizando_proveedores', 'on', true);

  update dominio.productos_proveedores v
     set principal = false, updated_at = clock_timestamp()
   where v.producto_id = p_producto and v.organizacion_id = p_organizacion
     and v.principal and v.proveedor_id is distinct from p_proveedor;

  if p_proveedor is not null then
    update dominio.productos_proveedores v
       set principal = true, updated_at = clock_timestamp()
     where v.producto_id = p_producto and v.organizacion_id = p_organizacion
       and v.proveedor_id = p_proveedor and not v.principal;
    select v.codigo_proveedor, v.costo into v_codigo, v_costo
      from dominio.productos_proveedores v
     where v.producto_id = p_producto and v.organizacion_id = p_organizacion and v.proveedor_id = p_proveedor;
  end if;

  update dominio.productos p
     set proveedor_id = p_proveedor, codigo_proveedor = v_codigo
   where p.id = p_producto and p.organizacion_id = p_organizacion
     and (p.proveedor_id, p.codigo_proveedor) is distinct from (p_proveedor, v_codigo);

  -- Costo efectivo: el del principal, si lo tiene.
  if v_costo is not null then
    insert into dominio.producto_costos as c (producto_id, organizacion_id, costo)
    values (p_producto, p_organizacion, v_costo)
    on conflict (producto_id) do update set costo = excluded.costo
    where c.costo is distinct from excluded.costo;
  end if;

  perform set_config('catalogo.sincronizando_proveedores', 'off', true);
end;
$$;

revoke execute on function private.fijar_proveedor_principal(uuid, uuid, uuid) from public, anon, authenticated;

-- Camino viejo: lo que entra por productos.proveedor_id / codigo_proveedor (crear_producto, actualizar_producto, importaciones)
-- se refleja en la tabla CON LA SEMÁNTICA DE SIEMPRE: elegir otro proveedor REEMPLAZA al principal anterior (su vínculo se borra) y
-- dejarlo vacío quita el principal. Quien quiera conservar al anterior como secundario usa «Marcar como principal» (RPC nuevas).
create or replace function private.sincronizar_vinculo_principal_producto()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_costo numeric;
begin
  if coalesce(current_setting('catalogo.sincronizando_proveedores', true), 'off') = 'on' then
    return null;
  end if;
  if tg_op = 'UPDATE' and (new.proveedor_id, new.codigo_proveedor) is not distinct from (old.proveedor_id, old.codigo_proveedor) then
    return null;
  end if;

  perform set_config('catalogo.sincronizando_proveedores', 'on', true);
  if new.proveedor_id is null then
    delete from dominio.productos_proveedores v where v.producto_id = new.id and v.principal;
  else
    delete from dominio.productos_proveedores v
     where v.producto_id = new.id and v.principal and v.proveedor_id <> new.proveedor_id;
    insert into dominio.productos_proveedores as v (organizacion_id, producto_id, proveedor_id, codigo_proveedor, principal)
    values (new.organizacion_id, new.id, new.proveedor_id, new.codigo_proveedor, true)
    on conflict (producto_id, proveedor_id) do update
      set principal = true, codigo_proveedor = excluded.codigo_proveedor, updated_at = clock_timestamp()
      where (v.principal, v.codigo_proveedor) is distinct from (true, excluded.codigo_proveedor);
    select v.costo into v_costo from dominio.productos_proveedores v
     where v.producto_id = new.id and v.proveedor_id = new.proveedor_id;
    if v_costo is not null then
      insert into dominio.producto_costos as c (producto_id, organizacion_id, costo)
      values (new.id, new.organizacion_id, v_costo)
      on conflict (producto_id) do update set costo = excluded.costo
      where c.costo is distinct from excluded.costo;
    end if;
  end if;
  perform set_config('catalogo.sincronizando_proveedores', 'off', true);
  return null;
end;
$$;

revoke execute on function private.sincronizar_vinculo_principal_producto() from public, anon, authenticated;

drop trigger if exists productos_sincronizar_vinculo on dominio.productos;
create trigger productos_sincronizar_vinculo
  after insert or update of proveedor_id, codigo_proveedor on dominio.productos
  for each row execute function private.sincronizar_vinculo_principal_producto();

-- Costo del producto → costo del vínculo principal.
create or replace function private.sincronizar_costo_a_vinculo_principal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('catalogo.sincronizando_proveedores', true), 'off') = 'on' then
    return null;
  end if;
  update dominio.productos_proveedores v
     set costo = new.costo, updated_at = clock_timestamp()
   where v.producto_id = new.producto_id and v.organizacion_id = new.organizacion_id
     and v.principal and v.costo is distinct from new.costo;
  return null;
end;
$$;

revoke execute on function private.sincronizar_costo_a_vinculo_principal() from public, anon, authenticated;

drop trigger if exists producto_costos_sincronizar_vinculo on dominio.producto_costos;
create trigger producto_costos_sincronizar_vinculo
  after insert or update of costo on dominio.producto_costos
  for each row execute function private.sincronizar_costo_a_vinculo_principal();

-- Relleno: cada producto con proveedor conserva ese proveedor como principal (y su costo actual como costo del vínculo).
insert into dominio.productos_proveedores (organizacion_id, producto_id, proveedor_id, codigo_proveedor, costo, principal)
select p.organizacion_id, p.id, p.proveedor_id, p.codigo_proveedor, pc.costo, true
  from dominio.productos p
  left join dominio.producto_costos pc on pc.producto_id = p.id and pc.organizacion_id = p.organizacion_id
 where p.proveedor_id is not null
on conflict (producto_id, proveedor_id) do nothing;

-- ============================================================================
-- RPC
-- ============================================================================

create or replace function public.listar_proveedores_de_producto(p_producto_id uuid)
returns table (
  proveedor_id uuid,
  razon_social text,
  activo boolean,
  codigo_proveedor text,
  costo numeric,
  principal boolean,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_ve_costo boolean;
begin
  if (select auth.uid()) is null or v_organizacion is null
     or (select private.nivel_seccion('productos')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver los proveedores del producto' using errcode = '42501';
  end if;
  if not exists (select 1 from dominio.productos p where p.id = p_producto_id and p.organizacion_id = v_organizacion) then
    raise exception 'El producto no existe' using errcode = 'PT404';
  end if;
  v_ve_costo := (select private.nivel_seccion('rentabilidad')) in ('lectura', 'edicion');

  return query
  select v.proveedor_id, pr.razon_social, pr.activo, v.codigo_proveedor,
         case when v_ve_costo then v.costo else null end, v.principal, v.updated_at
    from dominio.productos_proveedores v
    join dominio.proveedores pr on pr.id = v.proveedor_id and pr.organizacion_id = v.organizacion_id
   where v.producto_id = p_producto_id and v.organizacion_id = v_organizacion
   order by v.principal desc, lower(pr.razon_social), v.proveedor_id;
end;
$$;

comment on function public.listar_proveedores_de_producto(uuid) is
  'MSF-530: proveedores de un producto (principal primero) con código y costo por vínculo; el costo solo con Rentabilidad. Exige lectura o edición en Productos.';

revoke execute on function public.listar_proveedores_de_producto(uuid) from public, anon;
grant execute on function public.listar_proveedores_de_producto(uuid) to authenticated;

-- Agrega el proveedor al producto o actualiza su código y costo (idempotente). `p_principal` = marcarlo como principal.
-- Sin edición en Rentabilidad el costo no se toca: no se envía (42501) y el existente se conserva.
create or replace function public.asignar_proveedor_producto(
  p_producto_id uuid,
  p_proveedor_id uuid,
  p_codigo_proveedor text default null,
  p_costo numeric default null,
  p_principal boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_codigo text := nullif(btrim(p_codigo_proveedor), '');
  v_puede_costo boolean;
  v_activo boolean;
  v_vinculo dominio.productos_proveedores;
begin
  if (select auth.uid()) is null or v_organizacion is null
     or (select private.nivel_seccion('productos')) <> 'edicion' then
    raise exception 'Tu rol no puede cambiar los proveedores del producto' using errcode = '42501';
  end if;
  v_puede_costo := (select private.nivel_seccion('rentabilidad')) = 'edicion';
  if p_costo is not null and not v_puede_costo then
    raise exception 'Tu rol no puede cargar el costo' using errcode = '42501';
  end if;
  if v_codigo is not null and char_length(v_codigo) > 80 then
    raise exception 'El código del proveedor admite hasta 80 caracteres' using errcode = '22023';
  end if;
  if p_costo is not null and (p_costo < 0 or p_costo <> round(p_costo, 2) or p_costo >= 1000000000000) then
    raise exception 'El costo no puede ser negativo y admite hasta 2 decimales' using errcode = '22023';
  end if;

  perform 1 from dominio.productos p where p.id = p_producto_id and p.organizacion_id = v_organizacion for update;
  if not found then
    raise exception 'El producto no existe' using errcode = 'PT404';
  end if;
  select pr.activo into v_activo from dominio.proveedores pr
   where pr.id = p_proveedor_id and pr.organizacion_id = v_organizacion;
  if not found then
    raise exception 'El proveedor no existe' using errcode = 'PT404';
  end if;

  select * into v_vinculo from dominio.productos_proveedores v
   where v.producto_id = p_producto_id and v.proveedor_id = p_proveedor_id and v.organizacion_id = v_organizacion;
  if not found then
    if not v_activo then
      raise exception 'El proveedor está desactivado: reactivalo antes de asignarlo' using errcode = 'PT409';
    end if;
    insert into dominio.productos_proveedores (organizacion_id, producto_id, proveedor_id, codigo_proveedor, costo)
    values (v_organizacion, p_producto_id, p_proveedor_id, v_codigo, p_costo);
  else
    update dominio.productos_proveedores v
       set codigo_proveedor = v_codigo,
           costo = case when v_puede_costo then p_costo else v.costo end,
           updated_at = clock_timestamp()
     where v.id = v_vinculo.id
       and (v.codigo_proveedor, v.costo) is distinct from (v_codigo, case when v_puede_costo then p_costo else v.costo end);
  end if;

  if coalesce(p_principal, false) and not v_activo then
    raise exception 'El proveedor está desactivado: reactivalo antes de marcarlo como principal' using errcode = 'PT409';
  end if;
  -- Si ya era el principal, se refresca el espejo (código y costo efectivo).
  if coalesce(p_principal, false) or coalesce(v_vinculo.principal, false) then
    perform private.fijar_proveedor_principal(v_organizacion, p_producto_id, p_proveedor_id);
  end if;
end;
$$;

comment on function public.asignar_proveedor_producto(uuid, uuid, text, numeric, boolean) is
  'MSF-530: agrega un proveedor al producto o actualiza su código y costo; p_principal lo marca como principal (el anterior queda secundario). Exige edición en Productos; el costo, edición en Rentabilidad.';

revoke execute on function public.asignar_proveedor_producto(uuid, uuid, text, numeric, boolean) from public, anon;
grant execute on function public.asignar_proveedor_producto(uuid, uuid, text, numeric, boolean) to authenticated;

create or replace function public.quitar_proveedor_producto(p_producto_id uuid, p_proveedor_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_era_principal boolean;
begin
  if (select auth.uid()) is null or v_organizacion is null
     or (select private.nivel_seccion('productos')) <> 'edicion' then
    raise exception 'Tu rol no puede cambiar los proveedores del producto' using errcode = '42501';
  end if;
  perform 1 from dominio.productos p where p.id = p_producto_id and p.organizacion_id = v_organizacion for update;
  if not found then
    raise exception 'El producto no existe' using errcode = 'PT404';
  end if;

  delete from dominio.productos_proveedores v
   where v.producto_id = p_producto_id and v.proveedor_id = p_proveedor_id and v.organizacion_id = v_organizacion
  returning v.principal into v_era_principal;
  if not found then
    raise exception 'El producto no tiene ese proveedor' using errcode = 'PT404';
  end if;
  -- El principal quitado deja el producto sin principal (no se promueve otro): se vacía el espejo.
  if v_era_principal then
    perform private.fijar_proveedor_principal(v_organizacion, p_producto_id, null);
  end if;
end;
$$;

comment on function public.quitar_proveedor_producto(uuid, uuid) is
  'MSF-530: quita un proveedor del producto. Si era el principal, el producto queda sin principal. Exige edición en Productos.';

revoke execute on function public.quitar_proveedor_producto(uuid, uuid) from public, anon;
grant execute on function public.quitar_proveedor_producto(uuid, uuid) to authenticated;

create or replace function public.marcar_proveedor_principal(p_producto_id uuid, p_proveedor_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_activo boolean;
begin
  if (select auth.uid()) is null or v_organizacion is null
     or (select private.nivel_seccion('productos')) <> 'edicion' then
    raise exception 'Tu rol no puede cambiar los proveedores del producto' using errcode = '42501';
  end if;
  perform 1 from dominio.productos p where p.id = p_producto_id and p.organizacion_id = v_organizacion for update;
  if not found then
    raise exception 'El producto no existe' using errcode = 'PT404';
  end if;
  select pr.activo into v_activo
    from dominio.productos_proveedores v
    join dominio.proveedores pr on pr.id = v.proveedor_id and pr.organizacion_id = v.organizacion_id
   where v.producto_id = p_producto_id and v.proveedor_id = p_proveedor_id and v.organizacion_id = v_organizacion;
  if not found then
    raise exception 'El producto no tiene ese proveedor' using errcode = 'PT404';
  end if;
  if not v_activo then
    raise exception 'El proveedor está desactivado: reactivalo antes de marcarlo como principal' using errcode = 'PT409';
  end if;
  perform private.fijar_proveedor_principal(v_organizacion, p_producto_id, p_proveedor_id);
end;
$$;

comment on function public.marcar_proveedor_principal(uuid, uuid) is
  'MSF-530: marca un proveedor del producto como principal (el anterior queda secundario). Idempotente. Exige edición en Productos.';

revoke execute on function public.marcar_proveedor_principal(uuid, uuid) from public, anon;
grant execute on function public.marcar_proveedor_principal(uuid, uuid) to authenticated;

-- La ficha del proveedor lista TODOS los productos donde figura (como principal o no). Mismas columnas que 20261019120001; el costo
-- es el del vínculo (en el principal coincide con el del producto). Pasa a `security definer` porque el costo del vínculo no tiene
-- `select` para `authenticated`: los permisos (proveedores y productos; costo solo con Rentabilidad) y la organización se validan acá.
create or replace function public.productos_de_proveedor(
  p_proveedor_id uuid,
  p_pagina integer default 1,
  p_tamano integer default 10
)
returns table (
  id uuid,
  nombre text,
  codigo_proveedor text,
  activo boolean,
  moneda text,
  costo numeric,
  total_filas bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_tamano integer := least(greatest(coalesce(p_tamano, 10), 1), 100);
  v_pagina integer := least(greatest(coalesce(p_pagina, 1), 1), 100000);
  v_ve_costo boolean;
begin
  if (select auth.uid()) is null or v_organizacion is null
     or (select private.nivel_seccion('proveedores')) not in ('lectura', 'edicion')
     or (select private.nivel_seccion('productos')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver los productos de un proveedor' using errcode = '42501';
  end if;

  v_ve_costo := (select private.nivel_seccion('rentabilidad')) in ('lectura', 'edicion');

  return query
    select pr.id, pr.nombre, v.codigo_proveedor, pr.activo, pr.moneda,
           case when v_ve_costo then v.costo else null end,
           count(*) over () as total_filas
      from dominio.productos_proveedores v
      join dominio.productos pr on pr.id = v.producto_id and pr.organizacion_id = v.organizacion_id
     where v.proveedor_id = p_proveedor_id
       and v.organizacion_id = v_organizacion
     order by lower(pr.nombre), pr.id
     limit v_tamano offset (v_pagina - 1) * v_tamano;
end;
$$;

comment on function public.productos_de_proveedor(uuid, integer, integer) is
  'F-PRV-03 + MSF-528 + MSF-530: productos en los que figura un proveedor (principal o no): nombre, código del vínculo, estado, moneda y costo del vínculo, paginados (tope 100). Exige proveedores y productos; costo solo con Rentabilidad (null si no).';

revoke execute on function public.productos_de_proveedor(uuid, integer, integer) from public, anon;
grant execute on function public.productos_de_proveedor(uuid, integer, integer) to authenticated;
