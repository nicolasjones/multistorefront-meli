-- MSF-817 / MSF-224 (lote 101): endurece la exportación total.
--
--  1. LISTA BLANCA de columnas por tabla (`private.exportacion_total_columnas`). Antes `conjuntos_exportacion_total()` exportaba
--     TODAS las columnas salvo las cuyo nombre coincidía con una lista negra en inglés (secret|token|password|...): una columna
--     futura como `contrasena_smtp` salía en el ZIP. Ahora una columna sale SOLO si tiene una fila `exportar = true` en la tabla
--     de decisiones; una columna sin decisión no sale (falla cerrada) y una pgTAP obliga a decidirla.
--     La semilla conserva exactamente lo que se exportaba hasta hoy (ni más ni menos): sale de la función vigente.
--  2. PAGINACIÓN POR KEYSET sobre la clave primaria (`filas_exportacion_total(.., p_despues jsonb, p_limite)`): la de offset sin
--     snapshot duplicaba o perdía filas si la organización estaba en uso y era cuadrática en tablas grandes. La función devuelve
--     `{filas, siguiente}`; `siguiente` es la clave de la última fila (el worker la pasa en `p_despues`). Las columnas `numeric` y
--     `bigint` salen como texto para no perder precisión al pasar por `double` (JSON.parse del worker).
--
-- Reversión (migración posterior): volver a crear `private.conjuntos_exportacion_total()` con la lista negra de la migración
--   20270507180700 (su cuerpo es la lista de conjuntos + el filtro por nombre), recrear
--   `private.filas_exportacion_total(uuid, text, text, integer, integer)` (offset; migración 20270217300003) y, si ya no se usa,
--   `drop function private.filas_exportacion_total(uuid, text, text, jsonb, integer); drop table private.exportacion_total_columnas;`.
--   El worker y la doc deben volver a la versión con offset en el mismo cambio.

create table if not exists private.exportacion_total_columnas (
  esquema text not null,
  tabla text not null,
  columna text not null,
  exportar boolean not null,
  motivo text,
  primary key (esquema, tabla, columna),
  check (exportar or (motivo is not null and btrim(motivo) <> ''))
);
alter table private.exportacion_total_columnas enable row level security;
revoke all on private.exportacion_total_columnas from public, anon, authenticated;
-- Política que deniega todo (convención de MSF-918: toda tabla con RLS tiene una política explícita); solo la lee una función definer.
drop policy if exists exportacion_total_columnas_denegar_todo on private.exportacion_total_columnas;
create policy exportacion_total_columnas_denegar_todo on private.exportacion_total_columnas
  for all to anon, authenticated using (false) with check (false);
comment on table private.exportacion_total_columnas is
  'MSF-817: decisión por columna de la exportación total. exportar=true sale en el ZIP; exportar=false exige motivo. Una columna sin fila no sale.';

-- Semilla: todo lo que la función vigente exporta hoy -> exportar = true; el resto de las columnas de esas tablas -> false con motivo.
insert into private.exportacion_total_columnas (esquema, tabla, columna, exportar, motivo)
select c.esquema, c.tabla, a.attname::text, true, null
  from private.conjuntos_exportacion_total() c
  cross join lateral pg_catalog.unnest(c.columnas) as a (attname)
on conflict do nothing;

insert into private.exportacion_total_columnas (esquema, tabla, columna, exportar, motivo)
select c.esquema, c.tabla, at.attname::text, false,
       case when c.tabla = 'newsletter_suscriptores' and at.attname = 'confirmacion_hash'
            then 'hash del token de confirmación (RF-NL-23)'
            else 'credencial, token o secreto: nunca sale en el volcado' end
  from private.conjuntos_exportacion_total() c
  join pg_catalog.pg_class k on k.relname = c.tabla and k.relnamespace = c.esquema::regnamespace and k.relkind in ('r', 'p')
  join pg_catalog.pg_attribute at on at.attrelid = k.oid and at.attnum > 0 and not at.attisdropped
 where not (at.attname::text = any (c.columnas))
on conflict do nothing;

-- Conjuntos: tablas y columnas salen de la tabla de decisiones (solo exportar = true y que la columna exista).
create or replace function private.conjuntos_exportacion_total()
returns table (esquema text, tabla text, columnas text[])
language sql
stable
security definer
set search_path = ''
as $$
  select d.esquema, d.tabla, array_agg(a.attname::text order by a.attnum) as columnas
    from private.exportacion_total_columnas d
    join pg_catalog.pg_namespace n on n.nspname = d.esquema
    join pg_catalog.pg_class c on c.relnamespace = n.oid and c.relname = d.tabla and c.relkind in ('r', 'p')
    join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and a.attname = d.columna
   where d.exportar
   group by d.esquema, d.tabla
   order by d.esquema, d.tabla;
$$;
revoke all on function private.conjuntos_exportacion_total() from public, anon, authenticated;
grant execute on function private.conjuntos_exportacion_total() to workers_orquestacion;

-- Paginación por keyset.
drop function if exists private.filas_exportacion_total(uuid, text, text, integer, integer);

create or replace function private.filas_exportacion_total(
  p_ejecucion_id uuid, p_esquema text, p_tabla text, p_despues jsonb, p_limite integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_d record;
  v_columnas text[];
  v_filtro text;
  v_pk text[];
  v_pk_lista text;
  v_select text;
  v_despues text := '';
  v_res jsonb;
begin
  select * into v_d from private.datos_exportacion_total(p_ejecucion_id);
  if p_limite is null or p_limite < 1 or p_limite > 5000 then
    raise exception 'LOTE_INVALIDO: límite entre 1 y 5000' using errcode = '22023';
  end if;
  if p_despues is not null and pg_catalog.jsonb_typeof(p_despues) <> 'object' then
    raise exception 'LOTE_INVALIDO: la clave de continuación debe ser un objeto' using errcode = '22023';
  end if;

  select c.columnas into v_columnas
  from private.conjuntos_exportacion_total() c
  where c.esquema = p_esquema and c.tabla = p_tabla;
  if v_columnas is null then
    raise exception 'CONJUNTO_DESCONOCIDO: el conjunto pedido no está en la lista de la exportación total' using errcode = '22023';
  end if;

  v_filtro := case when p_esquema = 'public' and p_tabla = 'organizaciones' then 'id' else 'organizacion_id' end;

  -- Clave primaria (en el orden de la constraint): es el orden estable y la clave de continuación.
  select pg_catalog.array_agg(a.attname::text order by k.ord) into v_pk
  from pg_catalog.pg_constraint pc
  cross join lateral pg_catalog.unnest(pc.conkey) with ordinality as k (attnum, ord)
  join pg_catalog.pg_attribute a on a.attrelid = pc.conrelid and a.attnum = k.attnum
  where pc.contype = 'p' and pc.conrelid = pg_catalog.format('%I.%I', p_esquema, p_tabla)::regclass;
  if v_pk is null then
    raise exception 'CONJUNTO_SIN_CLAVE: el conjunto no tiene clave primaria para paginar' using errcode = '22023';
  end if;
  select pg_catalog.string_agg(pg_catalog.format('t.%I', x), ', ' order by o) into v_pk_lista from pg_catalog.unnest(v_pk) with ordinality as u (x, o);

  -- Columnas exportadas; numeric y bigint como texto (sin pasar por double).
  select pg_catalog.string_agg(
           case when a.atttypid in ('pg_catalog.numeric'::regtype, 'pg_catalog.int8'::regtype)
                then pg_catalog.format('p.%I::text as %I', a.attname, a.attname)
                else pg_catalog.format('p.%I', a.attname) end,
           ', ' order by array_position(v_columnas, a.attname::text))
    into v_select
  from pg_catalog.pg_attribute a
  where a.attrelid = pg_catalog.format('%I.%I', p_esquema, p_tabla)::regclass
    and a.attnum > 0 and not a.attisdropped and a.attname::text = any (v_columnas);

  if p_despues is not null then
    v_despues := pg_catalog.format(
      ' and (%s) > (select %s from pg_catalog.jsonb_populate_record(null::%I.%I, $2) t)',
      v_pk_lista, v_pk_lista, p_esquema, p_tabla);
  end if;

  execute pg_catalog.format(
    $q$
    with p as (
      select t.* from %I.%I t where t.%I = $1 %s order by %s limit $3
    )
    select pg_catalog.jsonb_build_object(
      'filas', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x)) from (select %s from p order by %s) x), '[]'::jsonb),
      'siguiente', (select pg_catalog.to_jsonb(k) from (select %s from p t order by %s limit 1) k))
    $q$,
    p_esquema, p_tabla, v_filtro, v_despues,
    (select pg_catalog.string_agg(pg_catalog.format('t.%I', x), ', ' order by o) from pg_catalog.unnest(v_pk) with ordinality as u (x, o)),
    v_select,
    (select pg_catalog.string_agg(pg_catalog.format('p.%I', x), ', ' order by o) from pg_catalog.unnest(v_pk) with ordinality as u (x, o)),
    v_pk_lista,
    (select pg_catalog.string_agg(pg_catalog.format('t.%I desc', x), ', ' order by o) from pg_catalog.unnest(v_pk) with ordinality as u (x, o))
  ) into v_res using v_d.organizacion_id, p_despues, p_limite;

  return v_res;
end;
$$;
revoke all on function private.filas_exportacion_total(uuid, text, text, jsonb, integer) from public, anon, authenticated;
grant execute on function private.filas_exportacion_total(uuid, text, text, jsonb, integer) to workers_orquestacion;
