-- MSF-936 (S5 de la épica MSF-816, spec 20261113-120000-precio-promocional-en-pos-y-comprobantes): una promoción cuyo
-- precio NO es menor al precio normal de la tienda se ignora igual en la tienda y en el local, y se avisa al cargarla.
--
-- Hasta ahora el local (`private.precio_linea_venta`) ignoraba una promoción >= precio normal (gana el más bajo) y la
-- tienda la mostraba igual, incluso con un precio MÁS ALTO que el normal (tachando uno menor). Esta migración alinea la
-- tienda con el local:
--   * `private.promocion_vigente(producto, empresa, ahora)` devuelve null si el precio de la promoción vigente, visto
--     como lo ve el cliente (alícuota e interruptor «Precios que ve el cliente»; `private.precio_con_iva_visible`), NO
--     es estrictamente menor al precio normal de la tienda (`private.precio_final_publico`). Es la ÚNICA lectura de la
--     promoción de la tienda: `private.precio_vigente_empresa` (ficha, destacados, sugerencias, búsqueda y validación del
--     pedido) y `publico.catalogo_pagina_por_dominio` (que la llama directo) quedan alineadas sin tocar sus cuerpos. El
--     filtro y el orden por precio del catálogo usan el mismo valor, así que tampoco ven el precio ignorado.
--     Con IVA visible la comparación es la del precio publicado: si el redondeo al peso hace que promoción y normal
--     queden iguales no hay descuento que mostrar y se ignora (el local, que compara netos, los distingue por centavos).
--     La bandera `promociones_precio` apagada sigue devolviendo null (sin cambios). La condición nueva se evalúa solo
--     para filas con promoción vigente: sin promociones el costo por producto no cambia (MSF-846).
--   * `private.promocion_con_aviso(promocion jsonb, empresa, producto, precio)` y `public.guardar_promocion_precio`: la
--     RPC SIGUE guardando (no rechaza: la promoción puede quedar útil si el precio normal baja después) y suma al
--     resultado `aviso_codigo = 'promocion_no_menor_al_normal'` y `aviso` (texto) cuando el precio cargado no es menor
--     al precio normal de la tienda. Sin aviso, el resultado es idéntico al anterior (sin esas claves). Se avisa en los
--     cuatro retornos (alta, edición y sus repeticiones idempotentes). Misma firma, `security definer`,
--     `search_path = ''`, mismos grants (`create or replace`), misma bandera y mismos errores.
--
-- Esquema (Principio VII): sin tablas nuevas; solo funciones de cálculo.
-- Migración aditiva e idempotente (`create or replace`). Pasa `node scripts/verificar-migraciones.mjs --estricto`.
-- Reversión (migración posterior): recrear `private.promocion_vigente` de 20270228300100 y `public.guardar_promocion_precio`
-- de 20270228300100, y `drop function private.promocion_con_aviso(jsonb, uuid, uuid, numeric)`.

create or replace function private.promocion_vigente(p_producto uuid, p_empresa uuid, p_ahora timestamptz default now())
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select x.precio_promocional
    from dominio.promociones_precio x
   where private.bandera_activa('promociones_precio')
     and x.producto_id = p_producto
     and x.empresa_id = p_empresa
     and x.anulada_at is null
     and x.desde <= p_ahora
     and p_ahora < x.hasta
     -- MSF-936: una promoción que no baja el precio normal se ignora (igual que en el local).
     and private.precio_con_iva_visible(p_producto, p_empresa, x.precio_promocional)
         < private.precio_final_publico(p_producto, p_empresa)
   order by x.desde desc
   limit 1;
$$;

-- Suma el aviso «no es menor al precio normal» al JSON de la promoción guardada (sin aviso, lo devuelve igual).
create or replace function private.promocion_con_aviso(p_promocion jsonb, p_empresa uuid, p_producto uuid, p_precio numeric)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when private.precio_con_iva_visible(p_producto, p_empresa, p_precio)
                >= private.precio_final_publico(p_producto, p_empresa)
             then p_promocion || jsonb_build_object(
               'aviso_codigo', 'promocion_no_menor_al_normal',
               'aviso', 'El precio promocional no es menor al precio normal de la tienda: se guardó, pero no se aplicará mientras no lo baje.')
           else p_promocion
         end;
$$;

revoke execute on function private.promocion_con_aviso(jsonb, uuid, uuid, numeric) from public, anon, authenticated;

comment on function private.promocion_con_aviso(jsonb, uuid, uuid, numeric) is
  'MSF-936: agrega aviso_codigo y aviso al resultado de guardar_promocion_precio cuando el precio promocional (visto como el cliente) no es menor al precio normal de la tienda; null en el normal = sin aviso.';

create or replace function public.guardar_promocion_precio(
  p_id uuid,
  p_empresa uuid,
  p_producto uuid,
  p_precio numeric,
  p_desde timestamptz,
  p_hasta timestamptz,
  p_actualizado timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_precio numeric(14, 2);
  v_actual dominio.promociones_precio;
  v_fila dominio.promociones_precio;
begin
  if v_organizacion is null or v_actor is null
     or (select private.nivel_seccion('productos')) <> 'edicion' then
    raise exception 'Tu rol no puede editar promociones de precio' using errcode = '42501';
  end if;
  -- Bandera de apagado (MSF-363, decisión 15): con las promociones apagadas no se programa ni edita ninguna.
  if not (select private.bandera_activa('promociones_precio')) then
    raise exception 'Las promociones de precio están desactivadas en este entorno' using errcode = '55000';
  end if;
  if p_empresa is null or p_producto is null then
    raise exception 'Elegí la empresa y el producto' using errcode = '22023';
  end if;
  if p_precio is null or p_precio <= 0 then
    raise exception 'El precio promocional debe ser mayor a 0' using errcode = '22023';
  end if;
  if abs(p_precio) >= 1e12 then
    raise exception 'El precio promocional es demasiado grande' using errcode = '22003';
  end if;
  v_precio := round(p_precio, 2);
  if v_precio <= 0 then
    raise exception 'El precio promocional debe ser mayor a 0' using errcode = '22023';
  end if;
  if p_desde is null or p_hasta is null then
    raise exception 'Indicá desde y hasta cuándo rige la promoción' using errcode = '22023';
  end if;
  if p_hasta <= p_desde then
    raise exception 'La fecha de fin tiene que ser posterior a la de inicio' using errcode = '22023';
  end if;

  if not exists (
    select 1 from dominio.empresas e where e.id = p_empresa and e.organizacion_id = v_organizacion
  ) then
    raise exception 'La empresa no existe en tu organización' using errcode = 'P0002';
  end if;
  -- Hallazgo de la revisión de MSF-363: además de ser de la organización, la tienda debe ser accesible y la persona
  -- debe poder editar `productos` EN ELLA (el nivel global es el más alto entre sus tiendas).
  if (select private.nivel_productos_en_empresa(p_empresa)) <> 'edicion' then
    raise exception 'Tu rol no puede editar promociones de precio en esa tienda' using errcode = '42501';
  end if;
  if not exists (
    select 1 from dominio.productos p where p.id = p_producto and p.organizacion_id = v_organizacion
  ) then
    raise exception 'El producto no existe en tu organización' using errcode = 'P0002';
  end if;

  if p_id is null then
    -- Idempotencia del alta: la misma promoción activa ya cargada se devuelve tal cual.
    select * into v_fila
      from dominio.promociones_precio x
     where x.organizacion_id = v_organizacion and x.empresa_id = p_empresa and x.producto_id = p_producto
       and x.anulada_at is null and x.precio_promocional = v_precio
       and x.desde = p_desde and x.hasta = p_hasta;
    if found then
      return private.promocion_con_aviso(to_jsonb(v_fila), p_empresa, p_producto, v_precio);
    end if;

    if p_hasta <= now() then
      raise exception 'La promoción ya venció: la fecha de fin tiene que ser futura' using errcode = '22023';
    end if;

    insert into dominio.promociones_precio (organizacion_id, empresa_id, producto_id, precio_promocional, desde, hasta)
    values (v_organizacion, p_empresa, p_producto, v_precio, p_desde, p_hasta)
    returning * into v_fila;

    perform private.insertar_actividad(
      v_organizacion, v_actor, 'promocion_precio.programada',
      'Programó la promoción de ' || private.describir_promocion_precio(v_fila.id), p_empresa
    );
    return private.promocion_con_aviso(to_jsonb(v_fila), p_empresa, p_producto, v_precio);
  end if;

  -- Primero sin lock: quien no puede editar `productos` en la tienda de la promoción no la bloquea ni distingue
  -- «otra tienda» (22023) de «no es tuya» (42501); recién con permiso se toma el lock y se relee.
  select * into v_actual
    from dominio.promociones_precio x
   where x.id = p_id and x.organizacion_id = v_organizacion;
  if not found then
    raise exception 'La promoción no existe' using errcode = 'P0002';
  end if;
  if (select private.nivel_productos_en_empresa(v_actual.empresa_id)) <> 'edicion' then
    raise exception 'Tu rol no puede editar promociones de precio en esa tienda' using errcode = '42501';
  end if;
  select * into v_actual
    from dominio.promociones_precio x
   where x.id = p_id and x.organizacion_id = v_organizacion
     for update;
  if not found then
    raise exception 'La promoción no existe' using errcode = 'P0002';
  end if;
  if v_actual.empresa_id <> p_empresa or v_actual.producto_id <> p_producto then
    raise exception 'No se puede cambiar la empresa ni el producto de una promoción: anulala y creá otra'
      using errcode = '22023';
  end if;

  -- Guardar lo que ya está guardado es idempotente (también tras anular o vencer).
  if (v_actual.precio_promocional, v_actual.desde, v_actual.hasta) is not distinct from (v_precio, p_desde, p_hasta) then
    return private.promocion_con_aviso(to_jsonb(v_actual), p_empresa, p_producto, v_precio);
  end if;

  if v_actual.anulada_at is not null then
    raise exception 'La promoción está anulada y no se puede editar' using errcode = '22023';
  end if;
  if v_actual.hasta <= now() then
    raise exception 'La promoción ya venció y no se puede editar' using errcode = '22023';
  end if;
  if v_actual.updated_at is distinct from p_actualizado then
    raise exception 'La promoción fue modificada por otra persona' using errcode = '40001';
  end if;
  if p_hasta <= now() then
    raise exception 'La fecha de fin tiene que ser futura' using errcode = '22023';
  end if;

  update dominio.promociones_precio
     set precio_promocional = v_precio, desde = p_desde, hasta = p_hasta
   where id = p_id
  returning * into v_fila;

  perform private.insertar_actividad(
    v_organizacion, v_actor, 'promocion_precio.actualizada',
    'Actualizó la promoción de ' || private.describir_promocion_precio(v_fila.id), p_empresa
  );
  return private.promocion_con_aviso(to_jsonb(v_fila), p_empresa, p_producto, v_precio);
end;
$$;

comment on function public.guardar_promocion_precio(uuid, uuid, uuid, numeric, timestamptz, timestamptz, timestamptz) is
  'F-PRE-11: crea o edita una promoción de precio de una tienda. Devuelve la fila; si el precio no es menor al normal suma aviso_codigo = promocion_no_menor_al_normal y aviso (MSF-936: se guarda igual, no se aplica).';
