-- MSF-976 (seguimiento de la Fase 5 de listas de precios, lote 93): una lista de precios por TIPO de cliente (minorista o mayorista).
-- Decisión (por delegación de Nicolás): se resuelve por tipo de cliente; por TIENDA queda fuera (la lista es de toda la organización y el
-- precio ya se ajusta por tienda con la escala y el ajuste propios de la empresa: sumar una lista por tienda exige spec propia).
--
-- Precedencia (convive con la de escalas, D5 y D8, sin cambiarla): la lista propia del cliente gana; si no tiene, rige la del tipo del
-- cliente; si tampoco, no rige lista. Es el MISMO punto único del motor (`private.lista_precios_cliente`), así que precios, ventas,
-- tienda y snapshot por línea siguen igual: solo cambia qué lista devuelve esa función. El Consumidor final nunca tiene lista.
-- Bandera `listas_precios` apagada: nada rige (también por tipo).
--
-- Esquemas (Principio VII): `dominio.listas_precios_tipo_cliente` es política de precios del negocio → `dominio`. Vista de lectura y RPC
-- en `public`. Seguridad: RLS por organización y sección `clientes` o `ventas` (lectura/edición), como `listas_precios`; escritura solo por
-- RPC de Administrador; sin DELETE directo; `anon` sin acceso; FK compuesta por organización.
--
-- Archivar: una lista usada por un tipo cuenta a los clientes que la heredan (sin lista propia) en `cantidad_clientes_lista`, así que
-- «no se archiva una lista con clientes» (D10) sigue valiendo.
--
-- Errores (docs/errores-negocio-postgrest.md): `42501` no administrador, `55000` bandera apagada (salvo quitar), `PT404` lista inexistente,
-- `22023` tipo inválido o lista archivada.
--
-- Migración aditiva e idempotente. Reversión (migración posterior):
--   -- restaurar private.lista_precios_cliente (20270348000100) y private.cantidad_clientes_lista (20270340000200)
--   drop function public.asignar_lista_precios_tipo_cliente(text, uuid);
--   drop view public.listas_precios_tipo_cliente_resumen;
--   drop table dominio.listas_precios_tipo_cliente;
--   delete from public.tipos_evento_actividad where tipo = 'lista_precios.tipo_asignada';

create table if not exists dominio.listas_precios_tipo_cliente (
  organizacion_id uuid not null default private.organizacion_id()
    references public.organizaciones (id) on delete cascade,
  tipo text not null check (tipo in ('minorista', 'mayorista')),
  lista_precio_id uuid not null,
  updated_at timestamptz not null default now(),
  primary key (organizacion_id, tipo),
  foreign key (lista_precio_id, organizacion_id)
    references dominio.listas_precios (id, organizacion_id) on delete restrict
);

comment on table dominio.listas_precios_tipo_cliente is
  'MSF-976: lista de precios por tipo de cliente (una por tipo y organización). Rige si el cliente no tiene lista propia. Escritura solo por RPC de Administrador.';

create index if not exists listas_precios_tipo_cliente_lista_idx
  on dominio.listas_precios_tipo_cliente (lista_precio_id, organizacion_id);

alter table dominio.listas_precios_tipo_cliente enable row level security;

drop policy if exists listas_precios_tipo_cliente_select on dominio.listas_precios_tipo_cliente;
create policy listas_precios_tipo_cliente_select on dominio.listas_precios_tipo_cliente
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (
      (select private.nivel_seccion('clientes')) in ('lectura', 'edicion')
      or (select private.nivel_seccion('ventas')) in ('lectura', 'edicion')
    )
  );

grant usage on schema dominio to authenticated;

revoke all on dominio.listas_precios_tipo_cliente from public, anon, authenticated;
grant select on dominio.listas_precios_tipo_cliente to authenticated;
grant select, insert, update, delete on dominio.listas_precios_tipo_cliente to service_role;

create or replace view public.listas_precios_tipo_cliente_resumen
with (security_invoker = true) as
select
  t.tipo,
  t.lista_precio_id,
  l.nombre as lista_nombre,
  l.ajuste_pct,
  l.archivada_en,
  t.updated_at
from dominio.listas_precios_tipo_cliente t
join dominio.listas_precios l on l.id = t.lista_precio_id and l.organizacion_id = t.organizacion_id;

revoke all on public.listas_precios_tipo_cliente_resumen from public, anon;
grant select on public.listas_precios_tipo_cliente_resumen to authenticated;

insert into public.tipos_evento_actividad (tipo, sensible, descripcion) values
  ('lista_precios.tipo_asignada', false, 'Lista de precios asignada o quitada a un tipo de cliente (anterior y nueva)')
on conflict (tipo) do nothing;

-- El motor: la lista propia del cliente, y si no tiene, la de su tipo.
create or replace function private.lista_precios_cliente(p_cliente uuid, p_organizacion uuid)
returns table (lista_id uuid, ajuste_pct numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.ajuste_pct
    from dominio.clientes c
    left join dominio.listas_precios_tipo_cliente t
      on t.organizacion_id = c.organizacion_id and t.tipo = c.tipo
    join dominio.listas_precios l
      on l.organizacion_id = c.organizacion_id and l.id = coalesce(c.lista_precio_id, t.lista_precio_id)
   where p_cliente is not null
     and c.id = p_cliente
     and c.organizacion_id = p_organizacion
     and not c.es_consumidor_final
     and l.archivada_en is null
     and (select private.bandera_activa('listas_precios'));
$$;

revoke execute on function private.lista_precios_cliente(uuid, uuid) from public, anon, authenticated, service_role;

comment on function private.lista_precios_cliente(uuid, uuid) is
  'F-CLI-21 (D13) + MSF-976: lista de precios vigente del cliente (id y ajuste): la propia y, si no tiene, la de su tipo. Sin filas con la bandera listas_precios apagada, cliente ajeno a la organización, Consumidor final, sin lista o lista archivada. Única lectura de bandera y lista del motor. Sin execute para la API.';

-- Clientes que usan la lista: los que la tienen asignada y los que la heredan de su tipo (activos o archivados, sin Consumidor final).
create or replace function private.cantidad_clientes_lista(p_lista uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select (select count(*) from dominio.clientes c where c.lista_precio_id = p_lista)
       + (select count(*)
            from dominio.listas_precios_tipo_cliente t
            join dominio.clientes c on c.organizacion_id = t.organizacion_id and c.tipo = t.tipo
           where t.lista_precio_id = p_lista and c.lista_precio_id is null and not c.es_consumidor_final);
$$;

revoke execute on function private.cantidad_clientes_lista(uuid) from public, anon, authenticated;

create or replace function public.asignar_lista_precios_tipo_cliente(p_tipo text, p_lista uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_nueva dominio.listas_precios;
  v_anterior dominio.listas_precios;
  v_actual uuid;
begin
  if v_organizacion is null or v_actor is null or not (select private.es_administrador_de(v_organizacion)) then
    raise exception 'Solo un administrador puede asignar una lista de precios' using errcode = '42501';
  end if;
  if p_tipo is null or p_tipo not in ('minorista', 'mayorista') then
    raise exception 'El tipo de cliente tiene que ser minorista o mayorista' using errcode = '22023';
  end if;
  if p_lista is not null and not (select private.bandera_activa('listas_precios')) then
    raise exception 'Las listas de precios están desactivadas en este entorno' using errcode = '55000';
  end if;
  if p_lista is not null then
    select * into v_nueva from dominio.listas_precios l where l.id = p_lista and l.organizacion_id = v_organizacion;
    if not found then
      raise exception 'La lista de precios no existe' using errcode = 'PT404';
    end if;
    if v_nueva.archivada_en is not null then
      raise exception 'La lista de precios está archivada' using errcode = '22023';
    end if;
  end if;

  select t.lista_precio_id into v_actual
    from dominio.listas_precios_tipo_cliente t
   where t.organizacion_id = v_organizacion and t.tipo = p_tipo
     for update;
  -- Idempotente: no escribe ni registra nada si no cambia.
  if v_actual is not distinct from p_lista then
    return;
  end if;
  if v_actual is not null then
    select * into v_anterior from dominio.listas_precios l where l.id = v_actual;
  end if;

  if p_lista is null then
    delete from dominio.listas_precios_tipo_cliente t where t.organizacion_id = v_organizacion and t.tipo = p_tipo;
  else
    insert into dominio.listas_precios_tipo_cliente (organizacion_id, tipo, lista_precio_id)
    values (v_organizacion, p_tipo, p_lista)
    on conflict (organizacion_id, tipo) do update set lista_precio_id = excluded.lista_precio_id, updated_at = clock_timestamp();
  end if;

  perform private.insertar_cambio_actividad(
    v_organizacion, v_actor, 'lista_precios.tipo_asignada',
    case when p_lista is null then format('Quitó la lista de precios del tipo de cliente %s', p_tipo)
         else format('Asignó la lista de precios «%s» al tipo de cliente %s', v_nueva.nombre, p_tipo) end,
    case when v_anterior.id is null then null
         else jsonb_build_object('lista_id', v_anterior.id, 'lista', v_anterior.nombre, 'ajuste_pct', v_anterior.ajuste_pct) end,
    case when v_nueva.id is null then null
         else jsonb_build_object('lista_id', v_nueva.id, 'lista', v_nueva.nombre, 'ajuste_pct', v_nueva.ajuste_pct) end
  );
end;
$$;

comment on function public.asignar_lista_precios_tipo_cliente(text, uuid) is
  'MSF-976: asigna (o quita, con p_lista null) la lista de precios de un tipo de cliente (minorista o mayorista). Rige para los clientes sin lista propia. Solo Administrador; idempotente; 55000 con la bandera apagada salvo quitar.';

revoke execute on function public.asignar_lista_precios_tipo_cliente(text, uuid) from public, anon;
grant execute on function public.asignar_lista_precios_tipo_cliente(text, uuid) to authenticated;
