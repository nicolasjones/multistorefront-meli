-- MSF-523 (seguimiento de MSF-205, lote 93): condiciones de compra por proveedor.
-- Decisión: plazo de pago (días), mínimo de compra, moneda y notas. Sin historial (decisión de Nicolás por delegación):
-- se guarda el valor vigente y el control de concurrencia por `updated_at`.
--
-- Esquemas (Principio VII): `dominio.proveedores_condiciones_compra` es parte de la entidad de negocio «proveedor» →
-- `dominio`. Una fila por proveedor (la clave es `proveedor_id`); no se agregan columnas a `dominio.proveedores` para no tocar
-- las lecturas, las exportaciones ni los grants por columna de la ficha. Las funciones de superficie van en `public`.
--
-- Seguridad: RLS por organización y sección `proveedores` (lectura o edición), igual que el resto de la ficha. Escritura solo por
-- RPC `security definer` (sin grant de INSERT/UPDATE/DELETE y sin política DELETE); `anon` sin acceso. La organización sale de
-- la sesión, nunca de un parámetro. FK compuesta `(proveedor_id, organizacion_id)`: no se cuelga de un proveedor ajeno.
--
-- Errores (docs/errores-negocio-postgrest.md): `42501` sin permiso, `PT404` proveedor inexistente o de otra organización,
-- `PT412` las condiciones cambiaron mientras se editaban, `22023` dato inválido.
--
-- Migración aditiva. Reversión (migración posterior; exportar antes los datos):
--   drop function public.guardar_condiciones_compra_proveedor(uuid, integer, numeric, text, text, timestamptz);
--   drop function public.obtener_condiciones_compra_proveedor(uuid);
--   drop table dominio.proveedores_condiciones_compra;

create table if not exists dominio.proveedores_condiciones_compra (
  proveedor_id uuid primary key,
  organizacion_id uuid not null default private.organizacion_id()
    references public.organizaciones (id) on delete cascade,
  -- Días de plazo de pago (0 = contado). Nulo = sin dato.
  plazo_pago_dias integer check (plazo_pago_dias between 0 and 365),
  -- Monto mínimo por pedido, en `moneda`. Nulo = sin mínimo.
  minimo_compra numeric(14, 2) check (minimo_compra >= 0),
  moneda text check (moneda in ('ARS', 'USD')),
  notas text check (char_length(notas) <= 1000),
  updated_at timestamptz not null default now(),
  -- Un mínimo sin moneda no se puede interpretar.
  constraint proveedores_condiciones_minimo_moneda_ck check (minimo_compra is null or moneda is not null),
  -- Diferible y sin acción (RESTRICT no se difiere) como `productos.proveedor_id`: la baja de una organización y el borrado de un proveedor usado se traducen a un error de
  -- negocio al confirmar (`private.confirmar_claves_diferidas`), no a un 23503 inmediato.
  foreign key (proveedor_id, organizacion_id)
    references dominio.proveedores (id, organizacion_id) on delete no action deferrable initially deferred
);

comment on table dominio.proveedores_condiciones_compra is
  'MSF-523: condiciones de compra del proveedor (plazo de pago, mínimo de compra, moneda y notas). Una fila por proveedor. Escritura solo por RPC; sin DELETE.';
comment on column dominio.proveedores_condiciones_compra.plazo_pago_dias is
  'Días de plazo de pago (0 = contado, máximo 365). Nulo = sin dato.';
comment on column dominio.proveedores_condiciones_compra.minimo_compra is
  'Monto mínimo de compra por pedido, expresado en `moneda` (obligatoria si hay mínimo).';

create index if not exists proveedores_condiciones_compra_org_idx
  on dominio.proveedores_condiciones_compra (organizacion_id);
create index if not exists proveedores_condiciones_compra_proveedor_org_idx
  on dominio.proveedores_condiciones_compra (proveedor_id, organizacion_id);

alter table dominio.proveedores_condiciones_compra enable row level security;

drop policy if exists proveedores_condiciones_compra_select on dominio.proveedores_condiciones_compra;
create policy proveedores_condiciones_compra_select on dominio.proveedores_condiciones_compra
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('proveedores')) in ('lectura', 'edicion')
  );

grant usage on schema dominio to authenticated;

revoke all on dominio.proveedores_condiciones_compra from public, anon, authenticated;
grant select on dominio.proveedores_condiciones_compra to authenticated;
-- service_role opera las tablas operativas de dominio (pgTAP `service_role_privilegios`).
grant select, insert, update, delete on dominio.proveedores_condiciones_compra to service_role;

create or replace function public.obtener_condiciones_compra_proveedor(p_proveedor_id uuid)
returns table (
  plazo_pago_dias integer,
  minimo_compra numeric,
  moneda text,
  notas text,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
begin
  if (select auth.uid()) is null or v_organizacion is null
     or (select private.nivel_seccion('proveedores')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver las condiciones de compra del proveedor' using errcode = '42501';
  end if;
  if not exists (
    select 1 from dominio.proveedores p where p.id = p_proveedor_id and p.organizacion_id = v_organizacion
  ) then
    raise exception 'El proveedor no existe' using errcode = 'PT404';
  end if;

  -- Sin fila = el proveedor todavía no tiene condiciones cargadas (cero filas).
  return query
  select c.plazo_pago_dias, c.minimo_compra, c.moneda, c.notas, c.updated_at
    from dominio.proveedores_condiciones_compra c
   where c.proveedor_id = p_proveedor_id and c.organizacion_id = v_organizacion;
end;
$$;

comment on function public.obtener_condiciones_compra_proveedor(uuid) is
  'MSF-523: condiciones de compra de un proveedor (cero filas si todavía no tiene). Exige lectura o edición en Proveedores.';

revoke execute on function public.obtener_condiciones_compra_proveedor(uuid) from public, anon;
grant execute on function public.obtener_condiciones_compra_proveedor(uuid) to authenticated;

-- Guarda (o reemplaza) las condiciones. `p_actualizado` es el `updated_at` que la persona vio al abrir el formulario
-- (nulo si todavía no había condiciones): si cambió, otra persona las modificó y se rechaza con PT412.
create or replace function public.guardar_condiciones_compra_proveedor(
  p_proveedor_id uuid,
  p_plazo_pago_dias integer default null,
  p_minimo_compra numeric default null,
  p_moneda text default null,
  p_notas text default null,
  p_actualizado timestamptz default null
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_moneda text := upper(nullif(btrim(p_moneda), ''));
  v_notas text := nullif(btrim(p_notas), '');
  v_actual dominio.proveedores_condiciones_compra;
  v_marca timestamptz;
begin
  if (select auth.uid()) is null or v_organizacion is null
     or (select private.nivel_seccion('proveedores')) <> 'edicion' then
    raise exception 'Tu rol no puede cambiar las condiciones de compra del proveedor' using errcode = '42501';
  end if;
  if p_plazo_pago_dias is not null and (p_plazo_pago_dias < 0 or p_plazo_pago_dias > 365) then
    raise exception 'El plazo de pago va de 0 a 365 días' using errcode = '22023';
  end if;
  if p_minimo_compra is not null and (p_minimo_compra < 0 or p_minimo_compra <> round(p_minimo_compra, 2)
     or p_minimo_compra >= 1000000000000) then
    raise exception 'El mínimo de compra no puede ser negativo y admite hasta 2 decimales' using errcode = '22023';
  end if;
  if v_moneda is not null and v_moneda not in ('ARS', 'USD') then
    raise exception 'La moneda tiene que ser ARS o USD' using errcode = '22023';
  end if;
  if p_minimo_compra is not null and v_moneda is null then
    raise exception 'Elegí la moneda del mínimo de compra' using errcode = '22023';
  end if;
  if v_notas is not null and char_length(v_notas) > 1000 then
    raise exception 'Las notas admiten hasta 1000 caracteres' using errcode = '22023';
  end if;

  -- Serializa los cambios del mismo proveedor (como los contactos) y fija la existencia.
  perform 1 from dominio.proveedores p
   where p.id = p_proveedor_id and p.organizacion_id = v_organizacion
   for update;
  if not found then
    raise exception 'El proveedor no existe' using errcode = 'PT404';
  end if;

  select * into v_actual
    from dominio.proveedores_condiciones_compra c
   where c.proveedor_id = p_proveedor_id and c.organizacion_id = v_organizacion;

  if found then
    if v_actual.updated_at is distinct from p_actualizado then
      raise exception 'Las condiciones fueron modificadas por otra persona' using errcode = 'PT412';
    end if;
    -- Repetir lo mismo no escribe ni avanza `updated_at`.
    if (v_actual.plazo_pago_dias, v_actual.minimo_compra, v_actual.moneda, v_actual.notas)
       is not distinct from (p_plazo_pago_dias, p_minimo_compra, v_moneda, v_notas) then
      return v_actual.updated_at;
    end if;
    update dominio.proveedores_condiciones_compra c
       set plazo_pago_dias = p_plazo_pago_dias, minimo_compra = p_minimo_compra, moneda = v_moneda, notas = v_notas,
           updated_at = greatest(clock_timestamp(), v_actual.updated_at + interval '1 microsecond')
     where c.proveedor_id = p_proveedor_id and c.organizacion_id = v_organizacion
    returning c.updated_at into v_marca;
    return v_marca;
  end if;

  -- Alguien las creó y las borró no es posible (no hay DELETE): si había una versión previa vista, el dato no coincide.
  if p_actualizado is not null then
    raise exception 'Las condiciones fueron modificadas por otra persona' using errcode = 'PT412';
  end if;
  -- Sin fila y sin datos: no se crea una fila vacía.
  if p_plazo_pago_dias is null and p_minimo_compra is null and v_moneda is null and v_notas is null then
    return null;
  end if;
  insert into dominio.proveedores_condiciones_compra (organizacion_id, proveedor_id, plazo_pago_dias, minimo_compra, moneda, notas)
  values (v_organizacion, p_proveedor_id, p_plazo_pago_dias, p_minimo_compra, v_moneda, v_notas)
  returning dominio.proveedores_condiciones_compra.updated_at into v_marca;
  return v_marca;
end;
$$;

comment on function public.guardar_condiciones_compra_proveedor(uuid, integer, numeric, text, text, timestamptz) is
  'MSF-523: guarda las condiciones de compra del proveedor (plazo 0-365 días, mínimo con moneda, notas). Exige edición en Proveedores; control de concurrencia por updated_at (PT412). Devuelve el nuevo updated_at (nulo si no había ni se cargó nada).';

revoke execute on function public.guardar_condiciones_compra_proveedor(uuid, integer, numeric, text, text, timestamptz) from public, anon;
grant execute on function public.guardar_condiciones_compra_proveedor(uuid, integer, numeric, text, text, timestamptz) to authenticated;
