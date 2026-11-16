-- F-CLI-21 (MSF-453, épica MSF-450, spec 20270327-100000-listas-de-precios-por-cliente, Fase 2): asignar una lista de precios a un
-- cliente. Solo guarda QUÉ lista tiene cada cliente: ningún precio calculado ni lo que se cobra cambia (el motor llega en la
-- Fase 3, detrás de la bandera `listas_precios`; `precio_para`, `precio_para_calculo` y `precio_linea_venta` no se tocan).
--
-- Esquemas (Principio VII): `public.clientes` ya vive en `public` (decisión histórica, MSF-180): solo se agrega una columna
-- nulable con FK compuesta a `dominio.listas_precios`. La RPC `public.asignar_lista_precios_cliente` es superficie de ejecución
-- sin datos propios. `private.*` son cálculo y disparadores (sin `execute` para `anon`/`authenticated`).
--
-- Seguridad: la columna NO recibe `grant update` ni `grant insert` a `authenticated` (solo la RPC `security definer` la escribe;
-- `clientes` concede por columna). La FK compuesta `(lista_precio_id, organizacion_id)` impide una lista de otra organización; el
-- disparador defensivo rechaza el Consumidor final y una lista archivada ante cualquier otra vía de escritura (service_role,
-- importaciones). Solo el rol Administrador asigna (`42501`).
--
-- Bandera (D13): con `listas_precios` apagada, asignar responde `55000`; QUITAR la lista sigue permitido.
--
-- Migración aditiva e idempotente. Reversión (migración posterior; no destruye datos de otras tablas):
--   drop function public.asignar_lista_precios_cliente(uuid, uuid);
--   drop trigger clientes_lista_precio_validar on public.clientes;
--   drop function private.validar_lista_precio_cliente();
--   -- restaurar private.cantidad_clientes_lista y public.listas_precios_resumen de 20270340000000 (conteo en 0)
--   alter table public.clientes drop column lista_precio_id;  -- recién cuando ninguna función la lea

alter table public.clientes
  add column if not exists lista_precio_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'clientes_lista_precio_fk' and conrelid = 'public.clientes'::regclass
  ) then
    -- MATCH SIMPLE: con `lista_precio_id` nulo no se comprueba nada (sin lista).
    alter table public.clientes
      add constraint clientes_lista_precio_fk
      foreign key (lista_precio_id, organizacion_id)
      references dominio.listas_precios (id, organizacion_id);
  end if;
end
$$;

create index if not exists clientes_lista_precio_idx
  on public.clientes (organizacion_id, lista_precio_id)
  where lista_precio_id is not null;

comment on column public.clientes.lista_precio_id is
  'F-CLI-21: lista de precios del cliente (a lo sumo una). null = sin lista. El Consumidor final no admite lista. Solo la RPC asignar_lista_precios_cliente la escribe (sin grant update).';

-- Defensivo: cualquier vía de escritura (no solo la RPC) respeta el Consumidor final y las listas archivadas.
create or replace function private.validar_lista_precio_cliente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.lista_precio_id is null then
    return new;
  end if;
  if new.es_consumidor_final then
    raise exception 'El Consumidor final no admite una lista de precios' using errcode = '22023';
  end if;
  -- Una lista archivada solo se rechaza al asignarla o cambiarla: un cliente que ya la tenía no puede quedar bloqueado.
  if tg_op = 'INSERT' or new.lista_precio_id is distinct from old.lista_precio_id then
    if exists (
      select 1 from dominio.listas_precios l
       where l.id = new.lista_precio_id and l.organizacion_id = new.organizacion_id and l.archivada_en is not null
    ) then
      raise exception 'La lista de precios está archivada' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function private.validar_lista_precio_cliente() from public, anon, authenticated;

drop trigger if exists clientes_lista_precio_validar on public.clientes;
create trigger clientes_lista_precio_validar
  before insert or update of lista_precio_id, es_consumidor_final on public.clientes
  for each row execute function private.validar_lista_precio_cliente();

-- Conteo real de clientes (activos y archivados) con la lista: lo usa «no se archiva una lista con clientes» (D10).
create or replace function private.cantidad_clientes_lista(p_lista uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) from public.clientes c where c.lista_precio_id = p_lista;
$$;

revoke execute on function private.cantidad_clientes_lista(uuid) from public, anon, authenticated;

-- Mismas columnas y tipos que 20270340000000; solo cambia el conteo (`create or replace view` conserva el contrato).
create or replace view public.listas_precios_resumen
with (security_invoker = true) as
select
  l.id,
  l.nombre,
  l.descripcion,
  l.ajuste_pct,
  l.archivada_en,
  l.updated_at,
  (select count(*) from public.clientes c where c.lista_precio_id = l.id) as clientes_asignados
from dominio.listas_precios l;

insert into public.tipos_evento_actividad (tipo, sensible, descripcion) values
  ('cliente.lista_precio_asignada', false, 'Lista de precios asignada o quitada a un cliente (anterior y nueva)')
on conflict (tipo) do nothing;

create or replace function public.asignar_lista_precios_cliente(p_cliente uuid, p_lista uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_cliente public.clientes;
  v_nueva dominio.listas_precios;
  v_anterior dominio.listas_precios;
begin
  if v_organizacion is null or v_actor is null or not (select private.es_administrador_de(v_organizacion)) then
    raise exception 'Solo un administrador puede asignar una lista de precios' using errcode = '42501';
  end if;
  -- Bandera de apagado (D13): apagada no se asigna; quitar la lista sigue permitido.
  if p_lista is not null and not (select private.bandera_activa('listas_precios')) then
    raise exception 'Las listas de precios están desactivadas en este entorno' using errcode = '55000';
  end if;

  select * into v_cliente
    from public.clientes c
   where c.id = p_cliente and c.organizacion_id = v_organizacion
     for update;
  if not found then
    raise exception 'El cliente no existe' using errcode = 'P0002';
  end if;
  -- Idempotente: asignar la lista que ya tiene (o quitar la que no tiene) no escribe ni registra nada.
  if v_cliente.lista_precio_id is not distinct from p_lista then
    return;
  end if;
  if p_lista is not null then
    if v_cliente.archivado_en is not null then
      raise exception 'El cliente está archivado' using errcode = '22023';
    end if;
    if v_cliente.es_consumidor_final then
      raise exception 'El Consumidor final no admite una lista de precios' using errcode = '22023';
    end if;
    select * into v_nueva
      from dominio.listas_precios l
     where l.id = p_lista and l.organizacion_id = v_organizacion;
    if not found then
      raise exception 'La lista de precios no existe' using errcode = 'P0002';
    end if;
    if v_nueva.archivada_en is not null then
      raise exception 'La lista de precios está archivada' using errcode = '22023';
    end if;
  end if;
  if v_cliente.lista_precio_id is not null then
    select * into v_anterior from dominio.listas_precios l where l.id = v_cliente.lista_precio_id;
  end if;

  update public.clientes set lista_precio_id = p_lista where id = v_cliente.id;

  perform private.insertar_cambio_actividad(
    v_organizacion, v_actor, 'cliente.lista_precio_asignada',
    case
      when p_lista is null then format('Quitó la lista de precios del cliente Nº %s · %s', v_cliente.numero, v_cliente.nombre)
      else format('Asignó la lista de precios «%s» al cliente Nº %s · %s', v_nueva.nombre, v_cliente.numero, v_cliente.nombre)
    end,
    case when v_anterior.id is null then null
         else jsonb_build_object('lista_id', v_anterior.id, 'lista', v_anterior.nombre, 'ajuste_pct', v_anterior.ajuste_pct) end,
    case when v_nueva.id is null then null
         else jsonb_build_object('lista_id', v_nueva.id, 'lista', v_nueva.nombre, 'ajuste_pct', v_nueva.ajuste_pct) end
  );
end;
$$;

revoke execute on function public.asignar_lista_precios_cliente(uuid, uuid) from public, anon;
grant execute on function public.asignar_lista_precios_cliente(uuid, uuid) to authenticated;

comment on function public.asignar_lista_precios_cliente(uuid, uuid) is
  'F-CLI-21: asigna (o quita, con p_lista null) la lista de precios de un cliente. Solo Administrador; idempotente; 55000 con la bandera apagada salvo quitar.';
