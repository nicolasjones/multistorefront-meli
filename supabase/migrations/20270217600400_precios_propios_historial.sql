-- MSF-352 (revisión de F-PRE-08, hallazgo MEDIO de Code): historial de precios propios.
-- `fijar_precio_propio` / `quitar_precio_propio` dejaban actividad SIN importes (deliberado) y `precios_propios_empresa`
-- guarda solo el valor vigente: no se podía reconstruir quién bajó un precio de $ X a $ Y. Es plata: queda un historial.
--
-- Esquema (Principio VII): `dominio.precios_propios_historial` es un dato de negocio del producto en la empresa
-- (hermana de `dominio.precios_propios_empresa`) → `dominio`, nunca `public`. Append-only:
--   * una fila por cambio real (fijado: alta o cambio de moneda/importe; quitado), con valor anterior y nuevo (moneda
--     e importe), empresa, producto, actor (id y nombre del momento) y fecha;
--   * la escriben SOLO `fijar_precio_propio` y `quitar_precio_propio` (security definer, en la misma transacción);
--     `authenticated` solo lee (organización de la sesión y `productos` ≥ lectura, igual que los precios propios); sin
--     privilegios de insert/update/delete/truncate para nadie de la app; `anon` sin privilegios;
--   * triggers de inalterabilidad (update, delete y truncate fallan con 42501 aun para el dueño; única excepción: el
--     borrado en cascada al eliminar la organización);
--   * sin claves foráneas a productos ni empresas: el historial sobrevive a la baja del producto o de la empresa.
-- Una operación idempotente (fijar lo mismo, quitar lo que no existe) no agrega fila.
--
-- La actividad de estos dos eventos sigue sin importes (el detalle es público para quien ve Actividad); los importes
-- viven en esta tabla, con la sección `productos`.
--
-- Migración aditiva. Reversión (migración posterior; exportar antes el historial):
--   restaurar fijar_precio_propio y quitar_precio_propio a su cuerpo de 20270213100005;
--   drop trigger precios_propios_historial_inalterable_fila on dominio.precios_propios_historial;
--   drop trigger precios_propios_historial_inalterable_truncate on dominio.precios_propios_historial;
--   drop function private.bloquear_alteracion_precios_propios_historial();
--   drop table dominio.precios_propios_historial;

create table if not exists dominio.precios_propios_historial (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  producto_id uuid not null,
  empresa_id uuid not null,
  accion text not null check (accion in ('fijado', 'quitado')),
  moneda_anterior text check (moneda_anterior in ('ARS', 'USD')),
  importe_anterior numeric(14, 2),
  moneda_nueva text check (moneda_nueva in ('ARS', 'USD')),
  importe_nuevo numeric(14, 2),
  actor_id uuid,
  actor_nombre text,
  creado_en timestamptz not null default clock_timestamp(),
  check ((moneda_anterior is null) = (importe_anterior is null)),
  check ((moneda_nueva is null) = (importe_nuevo is null)),
  check (accion <> 'fijado' or moneda_nueva is not null),
  check (accion <> 'quitado' or (moneda_nueva is null and moneda_anterior is not null))
);

comment on table dominio.precios_propios_historial is
  'MSF-352: historial append-only de los precios propios por producto y empresa (valor anterior y nuevo, actor y fecha). Lo escriben solo fijar_precio_propio y quitar_precio_propio; inalterable. Lectura con la sección productos.';

create index if not exists precios_propios_historial_producto_idx
  on dominio.precios_propios_historial (organizacion_id, producto_id, empresa_id, creado_en desc);

alter table dominio.precios_propios_historial enable row level security;

drop policy if exists precios_propios_historial_select on dominio.precios_propios_historial;
create policy precios_propios_historial_select on dominio.precios_propios_historial
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('productos')) in ('lectura', 'edicion')
  );

revoke all on dominio.precios_propios_historial from public, anon, authenticated;
grant select on dominio.precios_propios_historial to authenticated;

do $$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
    revoke all on dominio.precios_propios_historial from service_role;
  end if;
end
$$;

-- Rechaza update, delete y truncate para cualquier rol (incluido el dueño). Única excepción: el borrado en cascada al
-- eliminar la organización (cuando se dispara, la organización ya no existe).
create or replace function private.bloquear_alteracion_precios_propios_historial()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.organizaciones o where o.id = old.organizacion_id) then
      return old;
    end if;
  end if;
  raise exception 'El historial de precios propios es inalterable: no se puede %', lower(tg_op) using errcode = '42501';
end;
$$;

revoke execute on function private.bloquear_alteracion_precios_propios_historial() from public, anon, authenticated;

drop trigger if exists precios_propios_historial_inalterable_fila on dominio.precios_propios_historial;
create trigger precios_propios_historial_inalterable_fila
  before update or delete on dominio.precios_propios_historial
  for each row execute function private.bloquear_alteracion_precios_propios_historial();

drop trigger if exists precios_propios_historial_inalterable_truncate on dominio.precios_propios_historial;
create trigger precios_propios_historial_inalterable_truncate
  before truncate on dominio.precios_propios_historial
  for each statement execute function private.bloquear_alteracion_precios_propios_historial();

-- Nombre del actor en el momento del cambio (el mismo criterio que la actividad).
create or replace function private.nombre_de_actor(p_actor uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(btrim(concat_ws(' ', pf.nombre, pf.apellido)), ''), u.email::text)
    from auth.users u
    left join public.perfiles_usuario pf on pf.user_id = u.id
   where u.id = p_actor;
$$;

revoke execute on function private.nombre_de_actor(uuid) from public, anon, authenticated;

create or replace function public.fijar_precio_propio(
  p_producto uuid,
  p_empresa uuid,
  p_moneda text,
  p_importe numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_nombre text;
  v_empresa text;
  v_previo dominio.precios_propios_empresa;
begin
  if v_org is null or v_actor is null or (select private.nivel_seccion('productos')) <> 'edicion' then
    raise exception 'Tu rol no puede editar productos' using errcode = '42501';
  end if;

  select p.nombre into v_nombre from dominio.productos p where p.id = p_producto and p.organizacion_id = v_org;
  if not found then
    raise exception 'El producto no existe' using errcode = 'P0002';
  end if;
  select e.nombre into v_empresa from dominio.empresas e where e.id = p_empresa and e.organizacion_id = v_org;
  if not found then
    raise exception 'La empresa no existe' using errcode = 'P0002';
  end if;

  if p_moneda is null or p_moneda not in ('ARS', 'USD') then
    raise exception 'La moneda del precio propio debe ser ARS o USD' using errcode = '22023';
  end if;
  if p_importe is null then
    raise exception 'Ingresá el precio propio' using errcode = '22023';
  end if;
  if p_importe <= 0 then
    raise exception 'El precio propio debe ser mayor que cero' using errcode = '23514';
  end if;
  if p_importe <> round(p_importe, 2) then
    raise exception 'El precio propio admite hasta 2 decimales' using errcode = '23514';
  end if;
  if p_importe >= 1e12 then
    raise exception 'El precio propio es demasiado grande' using errcode = '22003';
  end if;

  select * into v_previo from dominio.precios_propios_empresa x
   where x.producto_id = p_producto and x.empresa_id = p_empresa;

  -- Idempotente: fijar lo mismo no toca la fila ni deja evento.
  if found and v_previo.moneda = p_moneda and v_previo.importe = p_importe then
    return jsonb_build_object('moneda', v_previo.moneda, 'importe', v_previo.importe);
  end if;

  insert into dominio.precios_propios_empresa as x (producto_id, empresa_id, organizacion_id, moneda, importe)
  values (p_producto, p_empresa, v_org, p_moneda, p_importe)
  on conflict (producto_id, empresa_id) do update
    set moneda = excluded.moneda, importe = excluded.importe, updated_at = clock_timestamp();

  insert into dominio.precios_propios_historial
    (organizacion_id, producto_id, empresa_id, accion, moneda_anterior, importe_anterior, moneda_nueva, importe_nuevo,
     actor_id, actor_nombre)
  values (v_org, p_producto, p_empresa, 'fijado', v_previo.moneda, v_previo.importe, p_moneda, p_importe,
          v_actor, private.nombre_de_actor(v_actor));

  perform private.insertar_actividad(
    v_org, v_actor, 'producto.precio_propio_fijado',
    format('Fijó el precio propio de %s en %s', v_nombre, v_empresa), p_empresa
  );

  return jsonb_build_object('moneda', p_moneda, 'importe', p_importe);
end;
$$;

comment on function public.fijar_precio_propio(uuid, uuid, text, numeric) is
  'F-PRE-08: fija (crea o actualiza) el precio propio sin IVA de un producto en una empresa, en ARS o USD. Idempotente; la actividad no lleva importes pero cada cambio queda en dominio.precios_propios_historial con valor anterior y nuevo (MSF-352). 42501 sin edición en productos, P0002 producto o empresa ajenos, 22023 moneda o importe vacío, 23514 importe <= 0 o con más de 2 decimales, 22003 demasiado grande.';

create or replace function public.quitar_precio_propio(p_producto uuid, p_empresa uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_nombre text;
  v_empresa text;
  v_borrados integer;
  v_previo dominio.precios_propios_empresa;
begin
  if v_org is null or v_actor is null or (select private.nivel_seccion('productos')) <> 'edicion' then
    raise exception 'Tu rol no puede editar productos' using errcode = '42501';
  end if;

  select p.nombre into v_nombre from dominio.productos p where p.id = p_producto and p.organizacion_id = v_org;
  if not found then
    raise exception 'El producto no existe' using errcode = 'P0002';
  end if;
  select e.nombre into v_empresa from dominio.empresas e where e.id = p_empresa and e.organizacion_id = v_org;
  if not found then
    raise exception 'La empresa no existe' using errcode = 'P0002';
  end if;

  delete from dominio.precios_propios_empresa x
   where x.producto_id = p_producto and x.empresa_id = p_empresa and x.organizacion_id = v_org
  returning x.* into v_previo;
  get diagnostics v_borrados = row_count;

  -- Idempotente: sin precio propio previo no hay nada que quitar ni que registrar.
  if v_borrados > 0 then
    insert into dominio.precios_propios_historial
      (organizacion_id, producto_id, empresa_id, accion, moneda_anterior, importe_anterior, moneda_nueva, importe_nuevo,
       actor_id, actor_nombre)
    values (v_org, p_producto, p_empresa, 'quitado', v_previo.moneda, v_previo.importe, null, null,
            v_actor, private.nombre_de_actor(v_actor));

    perform private.insertar_actividad(
      v_org, v_actor, 'producto.precio_propio_quitado',
      format('Quitó el precio propio de %s en %s', v_nombre, v_empresa), p_empresa
    );
  end if;
end;
$$;

comment on function public.quitar_precio_propio(uuid, uuid) is
  'F-PRE-08: borra el precio propio de un producto en una empresa; el producto vuelve a la regla de la empresa. Idempotente; el cambio queda en dominio.precios_propios_historial (MSF-352). 42501 sin edición en productos, P0002 producto o empresa ajenos.';

revoke execute on function public.fijar_precio_propio(uuid, uuid, text, numeric) from public, anon;
revoke execute on function public.quitar_precio_propio(uuid, uuid) from public, anon;
grant execute on function public.fijar_precio_propio(uuid, uuid, text, numeric) to authenticated;
grant execute on function public.quitar_precio_propio(uuid, uuid) to authenticated;
