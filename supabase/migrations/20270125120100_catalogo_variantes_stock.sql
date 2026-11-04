-- F-CAT-15 (MSF-408, épica MSF-229), bloque B: existencias por variante. FR-005, FR-011.
-- Esquemas (Principio VII), verificados objeto por objeto:
--   dominio.existencias_variante        dominio (tabla nueva)  existencia por variante y depósito: dato de negocio
--                                                              del stock del producto, espejo de existencias_deposito.
--   dominio.movimientos_stock.variante_id  dominio (columna)   libro de movimientos; columna aditiva y nullable.
--   private.aplicar_movimiento_variante private (función)     única rutina que cambia la cantidad de una variante.
-- Aísla por organización con RLS por nivel de la sección Stock; solo escribe la RPC (sin políticas de escritura).
--
-- Migración aditiva. Reversión (migración posterior, no en este PR):
--   drop function private.aplicar_movimiento_variante(uuid, uuid, uuid, uuid, integer);
--   alter table dominio.movimientos_stock drop column variante_id;   (el libro es inmutable: exportar antes los
--     movimientos con variante_id)
--   drop table dominio.existencias_variante;

create table dominio.existencias_variante (
  variante_id uuid not null,
  deposito_id uuid not null,
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  cantidad integer not null default 0 check (cantidad >= 0),
  updated_at timestamptz not null default now(),
  primary key (variante_id, deposito_id),
  foreign key (variante_id, organizacion_id)
    references dominio.producto_variantes (id, organizacion_id) on delete cascade,
  foreign key (deposito_id, organizacion_id)
    references dominio.depositos (id, organizacion_id)
);

comment on table dominio.existencias_variante is
  'F-CAT-15: cantidad por variante y depósito. El stock de un producto con variantes es la suma de las activas. Solo la escriben las RPC de stock.';

create index existencias_variante_deposito_idx on dominio.existencias_variante (deposito_id);
create index existencias_variante_organizacion_idx on dominio.existencias_variante (organizacion_id);

alter table dominio.existencias_variante enable row level security;

create policy existencias_variante_select on dominio.existencias_variante
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('stock')) in ('lectura', 'edicion')
  );

revoke all on dominio.existencias_variante from public, anon, authenticated;
grant select on dominio.existencias_variante to authenticated;

alter table dominio.movimientos_stock add column variante_id uuid;

alter table dominio.movimientos_stock
  add constraint movimientos_stock_variante_fk
  foreign key (variante_id, organizacion_id) references dominio.producto_variantes (id, organizacion_id);

create index movimientos_stock_variante_idx on dominio.movimientos_stock (variante_id) where variante_id is not null;

comment on column dominio.movimientos_stock.variante_id is
  'F-CAT-15: variante sobre la que se aplicó el movimiento (nulo en productos sin variantes). Lo fija registrar_movimiento_stock.';

-- Cambia la cantidad de una variante en un depósito. El llamador ya serializó por producto.
-- Devuelve el total de la variante (suma de depósitos). Nunca deja la cantidad bajo cero.
create or replace function private.aplicar_movimiento_variante(
  p_organizacion uuid,
  p_producto uuid,
  p_variante uuid,
  p_deposito uuid,
  p_delta integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cantidad integer;
begin
  insert into dominio.existencias_variante (variante_id, deposito_id, organizacion_id)
  values (p_variante, p_deposito, p_organizacion)
  on conflict (variante_id, deposito_id) do nothing;

  select x.cantidad into v_cantidad
    from dominio.existencias_variante x
   where x.variante_id = p_variante and x.deposito_id = p_deposito
   for update;

  if v_cantidad + p_delta < 0 then
    raise exception 'No hay stock suficiente'
      using errcode = '23514',
            detail = format('Hay %s %s y la salida es de %s.',
              v_cantidad, case when v_cantidad = 1 then 'unidad' else 'unidades' end, -p_delta);
  end if;

  update dominio.existencias_variante
     set cantidad = v_cantidad + p_delta, updated_at = now()
   where variante_id = p_variante and deposito_id = p_deposito;

  update dominio.existencias
     set ultimo_movimiento_en = now(), updated_at = now()
   where producto_id = p_producto and organizacion_id = p_organizacion;

  return (select coalesce(sum(x.cantidad), 0)::integer
            from dominio.existencias_variante x where x.variante_id = p_variante);
end;
$$;

revoke execute on function private.aplicar_movimiento_variante(uuid, uuid, uuid, uuid, integer)
  from public, anon, authenticated;

comment on function private.aplicar_movimiento_variante(uuid, uuid, uuid, uuid, integer) is
  'F-CAT-15: única rutina que cambia la cantidad de una variante en un depósito; bloquea bajo cero (23514) y devuelve el total de la variante.';
