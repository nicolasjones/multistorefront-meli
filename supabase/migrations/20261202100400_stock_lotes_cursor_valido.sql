-- F-STK-10 (MSF-407, revisión PR #330): `listar_lotes_stock` valida el cursor y responde 22023
-- con un mensaje claro en vez del 22P02 genérico del cast. Mismo contrato, mismos privilegios,
-- `security invoker` (la RLS decide qué ve el llamador). Sin tablas nuevas (Principio VII).
--
-- Migración aditiva (create or replace de la misma firma). Reversión: re-aplicar la definición
-- SQL de 20261202100300_stock_lotes_lecturas.sql.

create or replace function public.listar_lotes_stock(
  p_limite integer default 50,
  p_cursor jsonb default null
)
returns table (
  id uuid,
  numero integer,
  fecha date,
  proveedor text,
  productos bigint,
  unidades bigint,
  creado_en timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_numero integer;
begin
  if p_cursor is not null then
    if jsonb_typeof(p_cursor) <> 'object' or (p_cursor ->> 'numero') !~ '^[0-9]{1,9}$' then
      raise exception 'El cursor del historial de lotes no es válido' using errcode = '22023';
    end if;
    v_numero := (p_cursor ->> 'numero')::integer;
  end if;

  return query
  select
    l.id, l.numero, l.fecha, l.proveedor,
    count(m.id) as productos,
    coalesce(sum(m.cantidad), 0)::bigint as unidades,
    l.creado_en
  from dominio.lotes_stock l
  left join dominio.movimientos_stock m
    on m.lote_id = l.id and m.organizacion_id = l.organizacion_id
  where v_numero is null or l.numero < v_numero
  group by l.id
  order by l.numero desc
  limit greatest(1, least(coalesce(p_limite, 50), 100));
end;
$$;

revoke execute on function public.listar_lotes_stock(integer, jsonb) from public, anon;
grant execute on function public.listar_lotes_stock(integer, jsonb) to authenticated;
