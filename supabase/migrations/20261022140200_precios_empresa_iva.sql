-- F-PRE-12 (MSF-200, épica MSF-114): interruptor «Precios que ve el cliente» y precio final.
-- Esquemas (Principio VII), verificados objeto por objeto:
--   dominio.precios_empresa.mostrar_con_iva   dominio (columna aditiva)  la tabla ya vive en `dominio`; RLS vigente
--                                                                         (sección `empresas`), sin cambios de política.
--   public.precios_empresa_final              public (VISTA, no tabla)   no almacena datos; `security_invoker`.
-- No se crea ninguna tabla.
--
-- Contrato (FR-019): final   = neto                              (Exento)
--                           | round(neto × (1 + porcentaje/100))  (al peso entero)
--                    visible = mostrar_con_iva ? final : neto
-- El margen NO cambia con el interruptor: se calcula siempre sobre el neto (vista de costo y margen).
-- Sin alícuota resoluble (producto sin IVA propio y sin categoría) el precio final es nulo: no se inventa un IVA.
--
-- `guardar_regla_precio_empresa` se amplía de forma aditiva con `p_mostrar_con_iva` (nulo = sin cambio; en el
-- primer guardado de una empresa sin regla, nulo = «Sin IVA»). Las llamadas anteriores (4 argumentos) siguen
-- funcionando. El interruptor es parte de la regla: entra en el bloqueo optimista, en la idempotencia y deja su
-- propio evento `empresa.regla_precio_actualizada` solo ante un cambio real.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop view public.precios_empresa_final;
--   drop function public.guardar_regla_precio_empresa(uuid, text, numeric, timestamptz, boolean);
--   y recrear la firma de 4 argumentos de 20261022130100, más private.tocar_precios_empresa() y
--   private.registrar_regla_precio_empresa() de 20261022130000/130100;
--   restaurar previsualizar_precios_empresa de 20261022130200 (sin final_ars; drop + create);
--   drop function private.aplicar_iva(numeric, numeric, boolean);
--   alter table dominio.precios_empresa drop column mostrar_con_iva;   (pierde el interruptor: exportarlo antes)

alter table dominio.precios_empresa
  add column mostrar_con_iva boolean not null default false;

comment on column dominio.precios_empresa.mostrar_con_iva is
  'F-PRE-12: «Precios que ve el cliente» de la empresa. false = Sin IVA (valor inicial), true = Con IVA incluido.';

grant insert (mostrar_con_iva) on dominio.precios_empresa to authenticated;
grant update (mostrar_con_iva) on dominio.precios_empresa to authenticated;

-- updated_at avanza solo ante un cambio real, ahora también del interruptor.
create or replace function private.tocar_precios_empresa()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.base, new.ajuste_pct, new.redondeo_pesos, new.mostrar_con_iva)
     is not distinct from (old.base, old.ajuste_pct, old.redondeo_pesos, old.mostrar_con_iva) then
    new.updated_at := old.updated_at;
  else
    new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  end if;
  return new;
end;
$$;

-- Actividad: la regla (como antes) y, aparte, el interruptor.
create or replace function private.registrar_regla_precio_empresa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_antes text := case when tg_op = 'UPDATE' then private.describir_regla_precio(old.base, old.ajuste_pct)
                       else private.describir_regla_precio('central', 0) end;
  v_despues text := private.describir_regla_precio(new.base, new.ajuste_pct);
  v_iva_antes boolean := case when tg_op = 'UPDATE' then old.mostrar_con_iva else false end;
  v_nombre text;
begin
  if v_actor is null then
    return new;
  end if;
  select e.nombre into v_nombre from dominio.empresas e where e.id = new.empresa_id;
  if v_antes <> v_despues then
    perform private.insertar_actividad(
      new.organizacion_id, v_actor, 'empresa.regla_precio_actualizada',
      format('Cambió la regla de precio de %s: %s → %s', coalesce(v_nombre, 'la empresa'), v_antes, v_despues),
      new.empresa_id
    );
  end if;
  if new.mostrar_con_iva is distinct from v_iva_antes then
    perform private.insertar_actividad(
      new.organizacion_id, v_actor, 'empresa.regla_precio_actualizada',
      format('Los precios de %s que ve el cliente pasaron a %s', coalesce(v_nombre, 'la empresa'),
        case when new.mostrar_con_iva then 'Con IVA incluido' else 'Sin IVA' end),
      new.empresa_id
    );
  end if;
  return new;
end;
$$;

-- ============================================================================
-- RPC de la regla: suma el interruptor (reemplaza la firma de 4 argumentos)
-- ============================================================================

drop function public.guardar_regla_precio_empresa(uuid, text, numeric, timestamptz);

create or replace function public.guardar_regla_precio_empresa(
  p_empresa uuid,
  p_base text,
  p_ajuste_pct numeric default 0,
  p_updated_at timestamptz default null,
  p_mostrar_con_iva boolean default null
)
returns dominio.precios_empresa
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_ajuste numeric;
  v_mostrar boolean;
  v_actual dominio.precios_empresa;
  v_fila dominio.precios_empresa;
begin
  if v_organizacion is null or (select private.nivel_seccion('empresas')) <> 'edicion' then
    raise exception 'Tu rol no puede editar los precios de la empresa' using errcode = '42501';
  end if;
  if p_base is null or p_base not in ('central', 'central_ajuste') then
    raise exception 'Elegí una base de precio válida' using errcode = '23514';
  end if;
  -- Con «Igual al central» el ajuste no rige: se guarda en 0 (resultado determinista).
  v_ajuste := case when p_base = 'central' then 0 else p_ajuste_pct end;
  if v_ajuste is null or v_ajuste <= -100 or v_ajuste <> round(v_ajuste, 3) then
    raise exception 'El ajuste debe ser mayor a −100 %% y tener hasta 3 decimales' using errcode = '23514';
  end if;
  if abs(v_ajuste) >= 10000 then
    raise exception 'El ajuste es demasiado grande' using errcode = '22003';
  end if;

  if not exists (
    select 1 from dominio.empresas e where e.id = p_empresa and e.organizacion_id = v_organizacion
  ) then
    raise exception 'La empresa no existe en tu organización' using errcode = 'P0002';
  end if;

  select * into v_actual from dominio.precios_empresa r where r.empresa_id = p_empresa for update;

  if not found then
    if p_updated_at is not null then
      raise exception 'La regla de precio fue modificada por otra persona' using errcode = '40001';
    end if;
    begin
      -- Sin regla previa, nulo = «Sin IVA».
      insert into dominio.precios_empresa (empresa_id, organizacion_id, base, ajuste_pct, mostrar_con_iva)
      values (p_empresa, v_organizacion, p_base, v_ajuste, coalesce(p_mostrar_con_iva, false))
      returning * into v_fila;
    exception when unique_violation then
      -- Otra persona creó la regla entre la lectura y este insert.
      raise exception 'La regla de precio fue modificada por otra persona' using errcode = '40001';
    end;
    return v_fila;
  end if;

  -- Nulo = sin cambio del interruptor.
  v_mostrar := coalesce(p_mostrar_con_iva, v_actual.mostrar_con_iva);

  -- Idempotente: lo pedido ya está guardado.
  if (v_actual.base, v_actual.ajuste_pct, v_actual.mostrar_con_iva)
     is not distinct from (p_base, v_ajuste, v_mostrar) then
    return v_actual;
  end if;
  if p_updated_at is null or v_actual.updated_at <> p_updated_at then
    raise exception 'La regla de precio fue modificada por otra persona' using errcode = '40001';
  end if;

  update dominio.precios_empresa
     set base = p_base, ajuste_pct = v_ajuste, mostrar_con_iva = v_mostrar
   where empresa_id = p_empresa
  returning * into v_fila;
  return v_fila;
end;
$$;

comment on function public.guardar_regla_precio_empresa(uuid, text, numeric, timestamptz, boolean) is
  'F-PRE-07/F-PRE-12: guarda la regla de precio neto y el interruptor «Precios que ve el cliente» de una empresa (solo Administrador). p_mostrar_con_iva nulo = sin cambio. 42501 sin permiso, 23514 inválido, P0002 empresa inexistente, 40001 conflicto de edición.';

revoke execute on function public.guardar_regla_precio_empresa(uuid, text, numeric, timestamptz, boolean) from public, anon;
grant execute on function public.guardar_regla_precio_empresa(uuid, text, numeric, timestamptz, boolean) to authenticated;

-- ============================================================================
-- Vista previa del ajuste: suma el precio final (misma fórmula que la vista)
-- ============================================================================

drop function public.previsualizar_precios_empresa(uuid, text, numeric, integer);

create or replace function public.previsualizar_precios_empresa(
  p_empresa uuid,
  p_base text,
  p_ajuste_pct numeric default 0,
  p_muestra integer default 6
)
returns table (
  producto_id uuid,
  nombre text,
  sku text,
  moneda text,
  central_ars numeric,
  neto_ars numeric,
  final_ars numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_ajuste numeric;
begin
  if v_organizacion is null or (select private.nivel_seccion('empresas')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver los precios de la empresa' using errcode = '42501';
  end if;
  if p_base is null or p_base not in ('central', 'central_ajuste') then
    raise exception 'Elegí una base de precio válida' using errcode = '23514';
  end if;
  v_ajuste := case when p_base = 'central' then 0 else p_ajuste_pct end;
  if v_ajuste is null or v_ajuste <= -100 or v_ajuste <> round(v_ajuste, 3) then
    raise exception 'El ajuste debe ser mayor a −100 %% y tener hasta 3 decimales' using errcode = '23514';
  end if;
  if abs(v_ajuste) >= 10000 then
    raise exception 'El ajuste es demasiado grande' using errcode = '22003';
  end if;
  if not exists (
    select 1 from dominio.empresas e where e.id = p_empresa and e.organizacion_id = v_organizacion
  ) then
    raise exception 'La empresa no existe en tu organización' using errcode = 'P0002';
  end if;

  -- La muestra se recorta ANTES de resolver el IVA: la alícuota se calcula solo para las filas devueltas.
  return query
  select m.id, m.nombre, m.sku, m.moneda, m.central, m.neto,
         private.aplicar_iva(m.neto, al.porcentaje, coalesce(al.exento, false))
    from (
      select p.id, p.nombre, p.sku, p.moneda, x.central, x.neto
        from dominio.productos p
        cross join lateral (
          select private.a_pesos(p.precio_lista, p.moneda, p.organizacion_id) as central
        ) c
        cross join lateral (
          select c.central as central, private.aplicar_regla_precio(c.central, p_base, v_ajuste, 10) as neto
        ) x
       where p.organizacion_id = v_organizacion and p.activo
       order by lower(p.nombre), p.id
       limit least(greatest(coalesce(p_muestra, 6), 1), 20)
    ) m
    left join lateral private.alicuota_producto(m.id) al on true
   order by lower(m.nombre), m.id;
end;
$$;

comment on function public.previsualizar_precios_empresa(uuid, text, numeric, integer) is
  'F-PRE-07/F-PRE-12: neto y final de una muestra de productos con una regla sin guardar. 42501 sin sección empresas, 23514 inválido, P0002 empresa inexistente.';

revoke execute on function public.previsualizar_precios_empresa(uuid, text, numeric, integer) from public, anon;
grant execute on function public.previsualizar_precios_empresa(uuid, text, numeric, integer) to authenticated;

-- ============================================================================
-- Precio final: única fórmula del IVA
-- ============================================================================

create or replace function private.aplicar_iva(p_neto numeric, p_porcentaje numeric, p_exento boolean)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_neto is null or p_porcentaje is null then null
    when p_exento then p_neto
    else round(p_neto * (1 + p_porcentaje / 100))
  end;
$$;

comment on function private.aplicar_iva(numeric, numeric, boolean) is
  'F-PRE-12: precio final al peso entero desde el neto; Exento ⇒ final = neto. Única fórmula del IVA.';

revoke execute on function private.aplicar_iva(numeric, numeric, boolean) from public, anon;
grant execute on function private.aplicar_iva(numeric, numeric, boolean) to authenticated;

-- `private.alicuota_producto` queda como lateral (SECURITY DEFINER, una búsqueda por PK por fila) y no como
-- join directo: la vista es security_invoker y un rol sin la sección `categorias` no leería la categoría
-- por RLS, con lo que el final saldría sin IVA. El listado de la pantalla pagina de a pocas filas.
create or replace view public.precios_empresa_final
with (security_invoker = true)
as
select
  n.producto_id,
  n.empresa_id,
  n.organizacion_id,
  n.nombre,
  n.sku,
  n.central_ars,
  n.neto_ars,
  al.alicuota_id,
  al.nombre as alicuota_nombre,
  al.porcentaje as alicuota_porcentaje,
  coalesce(al.exento, false) as alicuota_exenta,
  private.aplicar_iva(n.neto_ars, al.porcentaje, coalesce(al.exento, false)) as final_ars,
  coalesce(r.mostrar_con_iva, false) as mostrar_con_iva,
  case
    when coalesce(r.mostrar_con_iva, false)
      then private.aplicar_iva(n.neto_ars, al.porcentaje, coalesce(al.exento, false))
    else n.neto_ars
  end as visible_ars
from public.precios_empresa_neto n
left join dominio.precios_empresa r
  on r.empresa_id = n.empresa_id and r.organizacion_id = n.organizacion_id
left join lateral private.alicuota_producto(n.producto_id) al on true;

comment on view public.precios_empresa_final is
  'F-PRE-12: neto, alícuota, precio final (al peso entero) y precio visible según el interruptor de la empresa. Hereda el acceso de precios_empresa_neto (sección empresas).';

revoke all on public.precios_empresa_final from public, anon, authenticated;
grant select on public.precios_empresa_final to authenticated;
