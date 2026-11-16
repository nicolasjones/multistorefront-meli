-- F-PRE-04 (MSF-286, épica MSF-116): historial de cotizaciones inmutable y su consulta paginada.
--   * Trigger de inmutabilidad en `dominio.cotizaciones` (FR-016): ninguna fila se modifica ni se borra
--     y la tabla no se vacía, para NINGÚN rol (tampoco el dueño ni `service_role`). Corre incluso con
--     `session_replication_role = replica` (ENABLE ALWAYS). Las dos únicas salidas son las acciones
--     referenciales que la propia base dispara al borrar a quien cargó o a la organización:
--       - UPDATE: solo `cargada_por` pasando a null (FK `on delete set null`), a profundidad de trigger > 1.
--       - DELETE: solo si la organización ya no existe (FK `on delete cascade`), a profundidad > 1.
--     Un UPDATE/DELETE directo (profundidad 1) siempre se rechaza.
--   * `public.listar_cotizaciones(p_limite, p_cursor)` (FR-017): más nueva primero, paginada por cursor
--     (keyset), con la variación contra la fila anterior (null en la primera carga de la organización).
-- Esquema (Principio VII): no crea tablas; protege `dominio.cotizaciones` (dominio) y expone la RPC en
-- `public`, como el resto de la API de cotización. SECURITY INVOKER: rige la RLS del llamador
-- (organización y `cotizacion_dolar` ≥ lectura). `anon` sin ejecución.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.listar_cotizaciones(integer, text);
--   drop trigger cotizaciones_inmutable_truncate on dominio.cotizaciones;
--   drop trigger cotizaciones_inmutable_fila on dominio.cotizaciones;
--   drop function private.rechazar_cambio_cotizacion();

create or replace function private.rechazar_cambio_cotizacion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'El historial de cotizaciones no se puede vaciar' using errcode = '42501';
  end if;

  -- Acción referencial disparada por la base (profundidad > 1); un cambio directo llega con profundidad 1.
  if pg_trigger_depth() > 1 then
    if tg_op = 'DELETE'
       and not exists (select 1 from public.organizaciones o where o.id = old.organizacion_id) then
      return old;
    end if;
    if tg_op = 'UPDATE'
       and new.cargada_por is null
       and (to_jsonb(new) - 'cargada_por') = (to_jsonb(old) - 'cargada_por') then
      return new;
    end if;
  end if;

  raise exception 'El historial de cotizaciones no se puede modificar ni borrar' using errcode = '42501';
end;
$$;

revoke execute on function private.rechazar_cambio_cotizacion() from public, anon, authenticated;

create trigger cotizaciones_inmutable_fila
  before update or delete on dominio.cotizaciones
  for each row execute function private.rechazar_cambio_cotizacion();

create trigger cotizaciones_inmutable_truncate
  before truncate on dominio.cotizaciones
  for each statement execute function private.rechazar_cambio_cotizacion();

alter table dominio.cotizaciones enable always trigger cotizaciones_inmutable_fila;
alter table dominio.cotizaciones enable always trigger cotizaciones_inmutable_truncate;

-- p_cursor: texto opaco que devuelve `siguiente_cursor` de la página anterior ("<cargada_en>|<id>").
create or replace function public.listar_cotizaciones(p_limite integer default 10, p_cursor text default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_limite integer := least(greatest(coalesce(p_limite, 10), 1), 100);
  v_cursor_en timestamptz;
  v_cursor_id uuid;
  v_filas jsonb;
  v_hay_mas boolean;
  v_siguiente text;
begin
  if v_organizacion is null
     or (select private.nivel_seccion('cotizacion_dolar')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver la cotización del dólar' using errcode = '42501';
  end if;

  if p_cursor is not null then
    begin
      v_cursor_en := split_part(p_cursor, '|', 1)::timestamptz;
      v_cursor_id := split_part(p_cursor, '|', 2)::uuid;
    exception when others then
      raise exception 'Cursor inválido' using errcode = '22023';
    end;
  end if;

  -- Una fila de más: sirve para saber si hay otra página y como «anterior» de la última fila devuelta.
  with pagina as (
    select c.id, c.cargada_en, c.valor, c.cargada_por_nombre, c.recalculo_aplicado, c.precios_recalculados,
           lead(c.valor) over (order by c.cargada_en desc, c.id desc) as valor_previo,
           row_number() over (order by c.cargada_en desc, c.id desc) as posicion
      from dominio.cotizaciones c
     where c.organizacion_id = v_organizacion
       and (v_cursor_en is null or (c.cargada_en, c.id) < (v_cursor_en, v_cursor_id))
     order by c.cargada_en desc, c.id desc
     limit v_limite + 1
  )
  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'cargada_en', p.cargada_en,
        'valor', p.valor,
        'variacion_pct', case when p.valor_previo > 0 then round((p.valor / p.valor_previo - 1) * 100, 4) end,
        'cargada_por_nombre', p.cargada_por_nombre,
        'recalculo_aplicado', p.recalculo_aplicado,
        'precios_recalculados', p.precios_recalculados
      ) order by p.posicion
    ) filter (where p.posicion <= v_limite), '[]'::jsonb),
    coalesce(bool_or(p.posicion > v_limite), false),
    max(p.cargada_en::text || '|' || p.id::text) filter (where p.posicion = v_limite)
  into v_filas, v_hay_mas, v_siguiente
  from pagina p;

  return jsonb_build_object('filas', v_filas, 'siguiente_cursor', case when v_hay_mas then v_siguiente end);
end;
$$;

comment on function public.listar_cotizaciones(integer, text) is
  'F-PRE-04: historial de cotizaciones confirmadas, más nueva primero, paginado por cursor, con variación contra la fila anterior. 42501 sin acceso a cotizacion_dolar; 22023 con cursor inválido.';

revoke execute on function public.listar_cotizaciones(integer, text) from public, anon;
grant execute on function public.listar_cotizaciones(integer, text) to authenticated;
