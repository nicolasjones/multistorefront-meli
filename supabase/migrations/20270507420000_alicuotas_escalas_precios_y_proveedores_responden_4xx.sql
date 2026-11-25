-- Lote 65 (MSF-654 y MSF-655, séptima ola de la convención de códigos de negocio mapeados a 4xx; ver docs/errores-negocio-postgrest.md): las RPC de
-- alícuotas de IVA, precios por escala, reglas y precios propios por empresa, y de empresas y contactos de proveedores dejan de contestar
-- HTTP 500 cuando el dato no existe (`P0002`) o lo editó otra persona (`40001`). Misma regla que 20270507340000, 20270507350000,
-- 20270507360000 y 20270507410000: «no existe / no es de tu organización» pasa a `PT404` (HTTP 404) y el conflicto de edición (bloqueo
-- optimista por `updated_at`) a `PT412` (HTTP 412). Mensaje de negocio idéntico.
-- Las funciones migradas están en la tabla por ola de docs/errores-negocio-postgrest.md.
--
-- Cada función parte de su definición VIGENTE (indicada sobre ella; ninguna fue reescrita in situ por un barrido posterior: no nombran
-- `public.clientes` ni `superadmin_organizacion_activa`) y solo cambia el errcode de esos rechazos: mensajes, cuerpo, firma, `security`,
-- `search_path` y grants son los mismos (`create or replace` conserva privilegios y comentario). Ninguna es llamable por `anon` ni la
-- consumen Kestra, workers o Edge Functions: solo la web (el script de datos de demostración llama a tres, sin leer el código de error).
-- Los auxiliares de `private` que llaman no lanzan ni `P0002` ni `40001`.
--
-- Además actualiza los `comment on function` que nombraban `P0002` o `40001` como código de esos rechazos.
--
-- Migración aditiva (create or replace). Reversión: volver a aplicar la definición vigente indicada sobre cada función y sus comentarios
-- anteriores (en el cuerpo, `errcode = 'PT404'` vuelve a `'P0002'` y `errcode = 'PT412'` a `'40001'`). Los comentarios a restaurar son
-- los de guardar_regla_precio_empresa, previsualizar_precios_empresa, guardar_precios_escala, asignar_alicuota_producto,
-- guardar_alicuota_categoria, fijar_precio_propio y quitar_precio_propio, en los archivos indicados sobre cada función (cambian
-- `PT404` por `P0002` y `PT412` por `40001`). El cliente acepta los dos códigos.

-- guardar_regla_precio_empresa: definición vigente en 20261022140200_precios_empresa_iva.sql
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
    raise exception 'La empresa no existe en tu organización' using errcode = 'PT404';
  end if;

  select * into v_actual from dominio.precios_empresa r where r.empresa_id = p_empresa for update;

  if not found then
    if p_updated_at is not null then
      raise exception 'La regla de precio fue modificada por otra persona' using errcode = 'PT412';
    end if;
    begin
      -- Sin regla previa, nulo = «Sin IVA».
      insert into dominio.precios_empresa (empresa_id, organizacion_id, base, ajuste_pct, mostrar_con_iva)
      values (p_empresa, v_organizacion, p_base, v_ajuste, coalesce(p_mostrar_con_iva, false))
      returning * into v_fila;
    exception when unique_violation then
      -- Otra persona creó la regla entre la lectura y este insert.
      raise exception 'La regla de precio fue modificada por otra persona' using errcode = 'PT412';
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
    raise exception 'La regla de precio fue modificada por otra persona' using errcode = 'PT412';
  end if;

  update dominio.precios_empresa
     set base = p_base, ajuste_pct = v_ajuste, mostrar_con_iva = v_mostrar
   where empresa_id = p_empresa
  returning * into v_fila;
  return v_fila;
end;
$$;

-- previsualizar_precios_empresa: definición vigente en 20270213200001_simulador_precio_propio.sql
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
  final_ars numeric,
  precio_propio boolean
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
    raise exception 'La empresa no existe en tu organización' using errcode = 'PT404';
  end if;

  -- La muestra se recorta ANTES de calcular nada: primero se ordena y limita (barato, solo columnas de la tabla) y
  -- recién sobre esas filas se resuelven la conversión, el precio propio y el IVA. Con un catálogo grande, cada
  -- cambio del ajuste cuesta como mucho `p_muestra` evaluaciones, no una por producto de la organización.
  return query
  select m.id, m.nombre, m.sku, m.moneda, x.central,
         case when pp.moneda is not null then pp.neto_ars
              else private.aplicar_regla_precio(x.central, p_base, v_ajuste, 10) end,
         private.aplicar_iva(
           case when pp.moneda is not null then pp.neto_ars
                else private.aplicar_regla_precio(x.central, p_base, v_ajuste, 10) end,
           al.porcentaje, coalesce(al.exento, false)),
         (pp.moneda is not null)
    from (
      select p.id, p.nombre, p.sku, p.moneda, p.precio_lista, p.organizacion_id
        from dominio.productos p
       where p.organizacion_id = v_organizacion and p.activo
       order by lower(p.nombre), p.id
       limit least(greatest(coalesce(p_muestra, 6), 1), 20)
    ) m
    cross join lateral (
      select private.a_pesos(m.precio_lista, m.moneda, m.organizacion_id, p_empresa) as central
    ) x
    left join lateral private.precio_propio_empresa(m.id, p_empresa) pp on true
    left join lateral private.alicuota_producto(m.id) al on true
   order by lower(m.nombre), m.id;
end;
$$;

-- guardar_precios_escala: definición vigente en 20261022150000_producto_precios_escala.sql
create or replace function public.guardar_precios_escala(
  p_producto uuid,
  p_x5 numeric default null,
  p_x10 numeric default null,
  p_x50 numeric default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_escala text;
  v_precio numeric;
begin
  if v_org is null or (select private.nivel_seccion('productos')) <> 'edicion' then
    raise exception 'Tu rol no puede editar productos' using errcode = '42501';
  end if;
  if not exists (select 1 from dominio.productos p where p.id = p_producto and p.organizacion_id = v_org) then
    raise exception 'El producto no existe' using errcode = 'PT404';
  end if;

  for v_escala, v_precio in
    select t.escala, t.precio from (values ('x5', p_x5), ('x10', p_x10), ('x50', p_x50)) as t (escala, precio)
  loop
    if v_precio is not null and (v_precio < 0 or v_precio <> round(v_precio, 2)) then
      raise exception 'El precio de la escala % debe ser cero o mayor, con hasta 2 decimales', v_escala
        using errcode = '23514';
    end if;
    if v_precio is not null and v_precio >= 1e12 then
      raise exception 'El precio de la escala % es demasiado grande', v_escala using errcode = '22003';
    end if;
    -- Sin precio y sin fila previa no hay nada que guardar.
    if v_precio is null and not exists (
      select 1 from dominio.producto_precios_escala s
       where s.producto_id = p_producto and s.escala = v_escala
    ) then
      continue;
    end if;
    insert into dominio.producto_precios_escala as s (producto_id, organizacion_id, escala, precio)
    values (p_producto, v_org, v_escala, v_precio)
    on conflict (producto_id, escala) do update
      set precio = excluded.precio
      where s.precio is distinct from excluded.precio;
  end loop;
end;
$$;

-- asignar_alicuota_producto: definición vigente en 20261022140100_categorias_productos_alicuota.sql
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
    raise exception 'El producto no existe' using errcode = 'PT404';
  end if;
  if p_alicuota is not null then
    select a.activa into v_activa
      from dominio.alicuotas_iva a where a.id = p_alicuota and a.organizacion_id = v_org;
    if not found then
      raise exception 'La alícuota de IVA no existe' using errcode = 'PT404';
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

-- guardar_alicuota_categoria: definición vigente en 20261022140100_categorias_productos_alicuota.sql
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
    raise exception 'La categoría no existe' using errcode = 'PT404';
  end if;
  select a.activa into v_activa
    from dominio.alicuotas_iva a where a.id = p_alicuota and a.organizacion_id = v_org;
  if not found then
    raise exception 'La alícuota de IVA no existe' using errcode = 'PT404';
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

-- fijar_precio_propio: definición vigente en 20270218500400_precios_propios_historial.sql
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
    raise exception 'El producto no existe' using errcode = 'PT404';
  end if;
  select e.nombre into v_empresa from dominio.empresas e where e.id = p_empresa and e.organizacion_id = v_org;
  if not found then
    raise exception 'La empresa no existe' using errcode = 'PT404';
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

  -- Serializa los cambios del mismo (producto, empresa): el valor previo que queda en el historial es el real.
  perform pg_advisory_xact_lock(hashtextextended('precio_propio:' || p_producto::text || ':' || p_empresa::text, 0));

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

-- quitar_precio_propio: definición vigente en 20270218500400_precios_propios_historial.sql
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
    raise exception 'El producto no existe' using errcode = 'PT404';
  end if;
  select e.nombre into v_empresa from dominio.empresas e where e.id = p_empresa and e.organizacion_id = v_org;
  if not found then
    raise exception 'La empresa no existe' using errcode = 'PT404';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('precio_propio:' || p_producto::text || ':' || p_empresa::text, 0));

  delete from dominio.precios_propios_empresa x
   where x.producto_id = p_producto and x.empresa_id = p_empresa and x.organizacion_id = v_org;
  get diagnostics v_borrados = row_count;

  -- Idempotente: sin precio propio previo no hay nada que quitar ni que registrar.
  if v_borrados > 0 then
    -- La fila 'quitado' del historial la escribe el trigger de baja de dominio.precios_propios_empresa.
    perform private.insertar_actividad(
      v_org, v_actor, 'producto.precio_propio_quitado',
      format('Quitó el precio propio de %s en %s', v_nombre, v_empresa), p_empresa
    );
  end if;
end;
$$;

-- guardar_empresas_de_proveedor: definición vigente en 20261019120002_proveedores_empresas.sql
create or replace function public.guardar_empresas_de_proveedor(p_proveedor_id uuid, p_empresa_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_empresas uuid[] := coalesce(p_empresa_ids, '{}'::uuid[]);
  v_total integer;
begin
  if v_org is null or (select private.nivel_seccion('proveedores')) <> 'edicion' then
    raise exception 'No tenés permiso para editar las tiendas del proveedor' using errcode = '42501';
  end if;

  if not exists (
    select 1 from dominio.proveedores p where p.id = p_proveedor_id and p.organizacion_id = v_org
  ) then
    raise exception 'El proveedor no pertenece a tu organización' using errcode = 'PT404';
  end if;

  -- Sin nulos y todas las empresas de la organización.
  if exists (
    select 1
      from unnest(v_empresas) as x(empresa_id)
     where empresa_id is null
        or not exists (
          select 1 from dominio.empresas e
          where e.id = empresa_id and e.organizacion_id = v_org
        )
  ) then
    raise exception 'Alguna de las tiendas no pertenece a tu organización' using errcode = '42501';
  end if;

  delete from dominio.proveedores_empresas pe where pe.proveedor_id = p_proveedor_id;

  insert into dominio.proveedores_empresas (proveedor_id, empresa_id, organizacion_id)
  select p_proveedor_id, distintas.empresa_id, v_org
    from (select distinct unnest(v_empresas) as empresa_id) as distintas;

  get diagnostics v_total = row_count;
  return v_total;
end;
$$;

-- agregar_contacto_proveedor: definición vigente en 20270205110208_proveedores_contactos_rpc.sql
create or replace function public.agregar_contacto_proveedor(
  p_proveedor_id uuid,
  p_nombre text,
  p_rol text default null,
  p_correo text default null,
  p_telefono text default null,
  p_principal boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_nombre text := btrim(coalesce(p_nombre, ''));
  v_correo text := nullif(btrim(p_correo), '');
  v_id uuid;
begin
  if (select auth.uid()) is null or v_organizacion is null
     or (select private.nivel_seccion('proveedores')) <> 'edicion' then
    raise exception 'Tu rol no puede agregar contactos al proveedor' using errcode = '42501';
  end if;
  if v_nombre = '' then
    raise exception 'El nombre del contacto es obligatorio' using errcode = '22023';
  end if;
  -- Misma regla que el correo de la ficha (private.normalizar_proveedor): mantener alineadas.
  if v_correo is not null and v_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'El correo no tiene un formato válido' using errcode = '22023';
  end if;

  -- Serializa las altas y los cambios de principal del mismo proveedor.
  perform 1 from dominio.proveedores p
   where p.id = p_proveedor_id and p.organizacion_id = v_organizacion
   for update;
  if not found then
    raise exception 'El proveedor no existe' using errcode = 'PT404';
  end if;

  insert into dominio.proveedores_contactos (organizacion_id, proveedor_id, nombre, rol, correo, telefono)
  values (v_organizacion, p_proveedor_id, v_nombre, nullif(btrim(p_rol), ''), v_correo, nullif(btrim(p_telefono), ''))
  returning proveedores_contactos.id into v_id;

  if coalesce(p_principal, false) then
    perform private.aplicar_contacto_principal(v_organizacion, v_id);
  end if;

  perform private.registrar_actividad_contacto_proveedor(v_organizacion, (select auth.uid()), 'proveedor.contacto_agregado', v_id);
  if coalesce(p_principal, false) then
    perform private.registrar_actividad_contacto_proveedor(v_organizacion, (select auth.uid()), 'proveedor.contacto_principal_cambiado', v_id);
  end if;
  return v_id;
end;
$$;

-- marcar_contacto_principal: definición vigente en 20270205110208_proveedores_contactos_rpc.sql
create or replace function public.marcar_contacto_principal(p_contacto_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_proveedor uuid;
  v_ya_principal boolean;
begin
  if (select auth.uid()) is null or v_organizacion is null
     or (select private.nivel_seccion('proveedores')) <> 'edicion' then
    raise exception 'Tu rol no puede cambiar el contacto principal' using errcode = '42501';
  end if;

  select c.proveedor_id into v_proveedor
    from dominio.proveedores_contactos c
   where c.id = p_contacto_id and c.organizacion_id = v_organizacion;
  if v_proveedor is null then
    raise exception 'El contacto no existe' using errcode = 'PT404';
  end if;

  perform 1 from dominio.proveedores p
   where p.id = v_proveedor and p.organizacion_id = v_organizacion
   for update;

  -- Se relee tras el bloqueo: otra transacción pudo haberlo marcado mientras esperábamos.
  select c.principal into v_ya_principal
    from dominio.proveedores_contactos c where c.id = p_contacto_id;
  if v_ya_principal then
    return;
  end if;

  perform private.aplicar_contacto_principal(v_organizacion, p_contacto_id);
  perform private.registrar_actividad_contacto_proveedor(v_organizacion, (select auth.uid()), 'proveedor.contacto_principal_cambiado', p_contacto_id);
end;
$$;

-- Los comentarios de las funciones que nombraban `P0002` o `40001` pasan a `PT404` y `PT412`.
comment on function public.guardar_regla_precio_empresa(uuid, text, numeric, timestamptz, boolean) is
  'F-PRE-07/F-PRE-12: guarda la regla de precio neto y el interruptor «Precios que ve el cliente» de una empresa (solo Administrador). p_mostrar_con_iva nulo = sin cambio. 42501 sin permiso, 23514 inválido, PT404 empresa inexistente, PT412 conflicto de edición.';
comment on function public.previsualizar_precios_empresa(uuid, text, numeric, integer) is
  'F-PRE-07/F-PRE-09/F-PRE-12: neto y final de una muestra de productos con una regla sin guardar; las filas con precio propio muestran ese valor fijo y vienen marcadas (precio_propio). No escribe. 42501 sin sección empresas, 23514 inválido, PT404 empresa inexistente.';
comment on function public.guardar_precios_escala(uuid, numeric, numeric, numeric) is
  'F-PRE-15: guarda los precios sin IVA de las escalas x5, x10 y x50 de un producto (nulo = sin precio; x1 es el precio de lista). Idempotente. 42501 sin permiso, PT404 producto inexistente, 23514 inválido, 22003 demasiado grande.';
comment on function public.asignar_alicuota_producto(uuid, uuid) is
  'F-PRE-12: asigna (o quita, con null = hereda de la categoría) el IVA propio de un producto. Exige edición en productos; PT404 inexistente, 23514 inactiva. Idempotente.';
comment on function public.guardar_alicuota_categoria(uuid, uuid) is
  'F-PRE-12: asigna la alícuota de IVA de una categoría. Exige edición en categorias; PT404 inexistente, 23514 inactiva. Idempotente.';
comment on function public.fijar_precio_propio(uuid, uuid, text, numeric) is
  'F-PRE-08: fija (crea o actualiza) el precio propio sin IVA de un producto en una empresa, en ARS o USD. Idempotente; la actividad no lleva importes pero cada cambio queda en dominio.precios_propios_historial con valor anterior y nuevo (MSF-352). 42501 sin edición en productos, PT404 producto o empresa ajenos, 22023 moneda o importe vacío, 23514 importe <= 0 o con más de 2 decimales, 22003 demasiado grande.';
comment on function public.quitar_precio_propio(uuid, uuid) is
  'F-PRE-08: borra el precio propio de un producto en una empresa; el producto vuelve a la regla de la empresa. Idempotente; el cambio queda en dominio.precios_propios_historial (MSF-352). 42501 sin edición en productos, PT404 producto o empresa ajenos.';
