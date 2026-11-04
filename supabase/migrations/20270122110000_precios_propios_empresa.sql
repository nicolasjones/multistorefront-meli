-- F-PRE-08 (MSF-423, épica MSF-352) · FR-012, FR-013, FR-016, FR-017, FR-020: precio propio de un producto en una empresa.
--   dominio.precios_propios_empresa      precio neto (sin IVA) fijado a mano para un producto en una empresa:
--                                        moneda `ARS`|`USD` + importe > 0. Reemplaza a «central + ajuste» (el cálculo
--                                        lo lee la migración 20270122110100).
--   public.fijar_precio_propio(...)      crea o actualiza (idempotente). `productos` = edición.
--   public.quitar_precio_propio(...)     borra (idempotente): el producto vuelve a la regla de la empresa.
--   public.leer_precios_propios(...)     lista los precios propios de un producto. `productos` ≥ lectura.
--
-- Esquema (Principio VII): `dominio.precios_propios_empresa` es un dato de negocio del producto en la empresa
-- (precio de venta) → `dominio`, nunca `public`. Las RPC son superficie de ejecución en `public` y no guardan datos.
--
-- Aislamiento: FK compuestas (producto_id, organizacion_id) → productos y (empresa_id, organizacion_id) → empresas:
-- no se puede apuntar a un producto o una empresa de otra organización. RLS por organización; select con
-- `productos` ≥ lectura. SIN política de insert/update/delete para `authenticated`: se escribe solo por las RPC
-- (SECURITY DEFINER acotadas, como `confirmar_cotizacion`) para poder borrar y registrar la actividad en la misma
-- transacción. `anon` sin privilegios.
--
-- FR-020: los precios propios NO se envían a Mercado Libre (Etapa 2). Este flujo no crea cola, trigger de salida ni
-- columna de Mercado Libre: solo guarda el precio y deja un evento de actividad `producto.precio_propio_*` SIN
-- importes en el detalle (igual que `producto.precio_actualizado`).
--
-- Errores: 42501 sin permiso · P0002 producto o empresa inexistente (o de otra organización) · 22023 moneda inválida
-- o importe vacío / no numérico · 23514 importe cero, negativo o con más de 2 decimales · 22003 importe demasiado grande.
--
-- Migración aditiva. Reversión (migración posterior; exportar antes los precios propios):
--   drop function public.leer_precios_propios(uuid);
--   drop function public.quitar_precio_propio(uuid, uuid);
--   drop function public.fijar_precio_propio(uuid, uuid, text, numeric);
--   drop table dominio.precios_propios_empresa;

create table dominio.precios_propios_empresa (
  producto_id uuid not null,
  empresa_id uuid not null,
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  moneda text not null check (moneda in ('ARS', 'USD')),
  importe numeric(14, 2) not null check (importe > 0),
  updated_at timestamptz not null default now(),
  primary key (producto_id, empresa_id),
  foreign key (producto_id, organizacion_id)
    references dominio.productos (id, organizacion_id) on delete cascade,
  foreign key (empresa_id, organizacion_id)
    references dominio.empresas (id, organizacion_id) on delete cascade
);

comment on table dominio.precios_propios_empresa is
  'F-PRE-08: precio neto (sin IVA) fijado por producto y empresa, en ARS o USD. Reemplaza a «central + ajuste» de la regla de la empresa. Se escribe solo por fijar_precio_propio / quitar_precio_propio; no se envía a Mercado Libre (Etapa 2).';

create index if not exists precios_propios_empresa_organizacion_idx
  on dominio.precios_propios_empresa (organizacion_id);
create index if not exists precios_propios_empresa_empresa_idx
  on dominio.precios_propios_empresa (empresa_id, organizacion_id);

alter table dominio.precios_propios_empresa enable row level security;

create policy precios_propios_empresa_select on dominio.precios_propios_empresa
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('productos')) in ('lectura', 'edicion')
  );

grant usage on schema dominio to authenticated;

revoke all on dominio.precios_propios_empresa from public, anon, authenticated;
grant select on dominio.precios_propios_empresa to authenticated;

-- ============================================================================
-- RPC: fijar el precio propio
-- ============================================================================

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

  perform private.insertar_actividad(
    v_org, v_actor, 'producto.precio_propio_fijado',
    format('Fijó el precio propio de %s en %s', v_nombre, v_empresa), p_empresa
  );

  return jsonb_build_object('moneda', p_moneda, 'importe', p_importe);
end;
$$;

comment on function public.fijar_precio_propio(uuid, uuid, text, numeric) is
  'F-PRE-08: fija (crea o actualiza) el precio propio sin IVA de un producto en una empresa, en ARS o USD. Idempotente; la actividad no lleva importes. 42501 sin edición en productos, P0002 producto o empresa ajenos, 22023 moneda o importe vacío, 23514 importe <= 0 o con más de 2 decimales, 22003 demasiado grande.';

-- ============================================================================
-- RPC: quitar el precio propio
-- ============================================================================

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
   where x.producto_id = p_producto and x.empresa_id = p_empresa and x.organizacion_id = v_org;
  get diagnostics v_borrados = row_count;

  -- Idempotente: sin precio propio previo no hay nada que quitar ni que registrar.
  if v_borrados > 0 then
    perform private.insertar_actividad(
      v_org, v_actor, 'producto.precio_propio_quitado',
      format('Quitó el precio propio de %s en %s', v_nombre, v_empresa), p_empresa
    );
  end if;
end;
$$;

comment on function public.quitar_precio_propio(uuid, uuid) is
  'F-PRE-08: borra el precio propio de un producto en una empresa; el producto vuelve a la regla de la empresa. Idempotente. 42501 sin edición en productos, P0002 producto o empresa ajenos.';

-- ============================================================================
-- RPC: leer los precios propios de un producto
-- ============================================================================

create or replace function public.leer_precios_propios(p_producto uuid)
returns table (empresa_id uuid, moneda text, importe numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select x.empresa_id, x.moneda, x.importe
    from dominio.precios_propios_empresa x
   where x.producto_id = p_producto
   order by x.empresa_id;
$$;

comment on function public.leer_precios_propios(uuid) is
  'F-PRE-08: precios propios de un producto, uno por empresa. Rige la RLS de quien llama (productos ≥ lectura, su organización); vacío si no hay.';

revoke execute on function public.fijar_precio_propio(uuid, uuid, text, numeric) from public, anon;
revoke execute on function public.quitar_precio_propio(uuid, uuid) from public, anon;
revoke execute on function public.leer_precios_propios(uuid) from public, anon;
grant execute on function public.fijar_precio_propio(uuid, uuid, text, numeric) to authenticated;
grant execute on function public.quitar_precio_propio(uuid, uuid) to authenticated;
grant execute on function public.leer_precios_propios(uuid) to authenticated;
