-- Lote 39 (decisión de producto de MSF-668): «Facturar presupuesto». Parte 1: vínculo factura -> presupuesto y guarda de precios.
--
-- Qué hace:
--   · `dominio.comprobantes_venta.origen_presupuesto_id` (nulable): la factura que nació de un presupuesto aceptado apunta a él.
--     FK compuesta `(origen_presupuesto_id, organizacion_id)` a `comprobantes_venta (id, organizacion_id)` (misma organización por
--     construcción) y un índice ÚNICO parcial sobre las mismas columnas: un presupuesto se convierte UNA sola vez, aun si dos
--     sesiones lo intentan a la vez (el `for update` de la RPC lo serializa y este índice es la red de seguridad). El índice único
--     garantiza la unicidad. Solo una factura puede tener origen (check).
--   · `private.lineas_con_promocion_desactualizada`: cuerpo VIGENTE (20270507120000 y anteriores) con una sola adición: una factura
--     con `origen_presupuesto_id` NO se vigila (devuelve 0). Decisión de producto: se factura al precio del presupuesto aceptado,
--     congelado; sin esto `confirmar_comprobante` rechazaría con `precios_cambiaron` cuando la promoción o la lista cambió.
--     Si la persona edita las líneas de la factura en borrador, `guardar_lineas_comprobante` recalcula como siempre.
--
-- Esquema (Principio VII): columna nueva en `dominio.comprobantes_venta` (dominio). Sin tablas nuevas.
-- Migración aditiva. Reversión (migración posterior, solo si no hay facturas con origen o tras exportarlas):
--   drop index if exists dominio.comprobantes_venta_origen_presupuesto_uq;
--   drop index if exists dominio.comprobantes_venta_origen_presupuesto_id_organizacion_id_fk_idx;
--   alter table dominio.comprobantes_venta drop constraint if exists comprobantes_venta_origen_presupuesto_fk,
--     drop constraint if exists comprobantes_venta_origen_presupuesto_ck, drop column if exists origen_presupuesto_id;
--   y restituir `private.lineas_con_promocion_desactualizada` con su definición de 20270507120000.

alter table dominio.comprobantes_venta
  add column if not exists origen_presupuesto_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'comprobantes_venta_origen_presupuesto_fk') then
    alter table dominio.comprobantes_venta
      add constraint comprobantes_venta_origen_presupuesto_fk
      foreign key (origen_presupuesto_id, organizacion_id)
      references dominio.comprobantes_venta (id, organizacion_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'comprobantes_venta_origen_presupuesto_ck') then
    alter table dominio.comprobantes_venta
      add constraint comprobantes_venta_origen_presupuesto_ck
      check (origen_presupuesto_id is null or (tipo = 'factura' and origen_presupuesto_id <> id));
  end if;
end $$;

create unique index if not exists comprobantes_venta_origen_presupuesto_uq
  on dominio.comprobantes_venta (origen_presupuesto_id, organizacion_id)
  where origen_presupuesto_id is not null;

-- La prueba global de higiene exige un índice NO parcial que cubra la FK (un índice único parcial no cuenta).
create index if not exists comprobantes_venta_origen_presupuesto_id_organizacion_id_fk_idx
  on dominio.comprobantes_venta (origen_presupuesto_id, organizacion_id);

comment on column dominio.comprobantes_venta.origen_presupuesto_id is
  'Presupuesto aceptado del que nació esta factura (Facturar presupuesto). Único: un presupuesto se convierte una sola vez.';

create or replace function private.lineas_con_promocion_desactualizada(
  p_comprobante uuid,
  p_ahora timestamptz default now()
)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_c record;
  v_tipo_cliente text;
  v_descuento numeric := 0;
  v_promos boolean := private.bandera_activa('promociones_precio');
  v_lista_id uuid;
  v_lista_pct numeric;
  v_n integer;
  v_n_lista integer;
  v_n_sobre integer;
begin
  -- Facturar presupuesto: la factura que nace de un presupuesto aceptado conserva los precios del presupuesto (congelados).
  if exists (select 1 from dominio.comprobantes_venta f where f.id = p_comprobante and f.origen_presupuesto_id is not null) then
    return 0;
  end if;

  -- Con las dos banderas apagadas no hay nada que vigilar (idéntico al comportamiento anterior).
  if not v_promos and not private.bandera_activa('listas_precios') and not exists (
    select 1 from dominio.comprobantes_venta_lineas l where l.comprobante_id = p_comprobante and l.lista_precio_id is not null
  ) then
    return 0;
  end if;

  select c.organizacion_id, c.empresa_id, c.cliente_id into v_c
    from dominio.comprobantes_venta c
   where c.id = p_comprobante;
  if not found or v_c.empresa_id is null then
    return 0;
  end if;

  select cl.tipo, coalesce(cl.descuento, 0) into v_tipo_cliente, v_descuento
    from dominio.clientes cl
   where cl.id = v_c.cliente_id and cl.organizacion_id = v_c.organizacion_id;
  v_descuento := coalesce(v_descuento, 0);

  select ls.lista_id, ls.ajuste_pct into v_lista_id, v_lista_pct
    from private.lista_precios_cliente(v_c.cliente_id, v_c.organizacion_id) ls;

  with candidatas as materialized (
    select l.producto_id, l.cantidad, l.promocion_id, l.precio_unitario, l.lista_precio_id, l.lista_ajuste_pct,
           f.promocion_id as vigente_id
      from dominio.comprobantes_venta_lineas l
      left join lateral private.promocion_vigente_fila(l.producto_id, v_c.empresa_id, p_ahora) f on true
     where l.comprobante_id = p_comprobante
       and l.organizacion_id = v_c.organizacion_id
       and not l.precio_manual
       and not l.sin_stock
       and l.producto_id is not null
       and ((v_promos and (f.promocion_id is not null or l.promocion_id is not null))
            or (l.lista_precio_id is not null
                and (v_lista_id is null or l.lista_precio_id <> v_lista_id or l.lista_ajuste_pct <> v_lista_pct))
            or (l.lista_precio_id is null and v_lista_id is not null))
  )
  select count(*) filter (where v_promos and (p.promocion_id is distinct from c.promocion_id
                                              or (p.promocion_id is not null and abs(p.neto_unitario - c.precio_unitario) > 0.005)))::int,
         count(*) filter (where p.lista_precio_id is distinct from c.lista_precio_id
                            or p.lista_ajuste_pct is distinct from c.lista_ajuste_pct)::int,
         count(*) filter (where v_promos and c.promocion_id is not null and c.vigente_id = c.promocion_id
                            and p.promocion_id is null)::int
    into v_n, v_n_lista, v_n_sobre
    from candidatas c
   cross join lateral private.precio_linea_venta_calculo(
           c.producto_id, v_c.empresa_id, v_tipo_cliente, c.cantidad, v_descuento, p_ahora, true,
           case when v_lista_id is null then null else v_c.cliente_id end) p
   where p.neto_unitario is not null;

  if v_n_lista > 0 then
    raise exception 'Los precios cambiaron: la lista de precios del cliente ya no es la que se usó al guardar las líneas'
      using errcode = '40001', hint = 'precios_cambiaron', detail = 'lista_precios';
  end if;
  if v_n_sobre > 0 then
    raise exception 'Los precios cambiaron: el precio normal bajó y la promoción guardada ya no es menor'
      using errcode = '40001', hint = 'precios_cambiaron', detail = 'promocion_no_menor_al_normal';
  end if;
  return coalesce(v_n, 0);
end;
$$;

revoke execute on function private.lineas_con_promocion_desactualizada(uuid, timestamptz)
  from public, anon, authenticated, service_role;
