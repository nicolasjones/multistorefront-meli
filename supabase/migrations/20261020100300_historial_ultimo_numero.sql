-- MSF-293 (F-VTA-37, FR-009): mayor número histórico, para que la numeración nueva (épica de
-- Ventas) arranque en uno posterior. Fijar esa numeración queda fuera de esta épica.
--
-- Esquemas (Principio VII): solo una función en `public`; lee `dominio.historial_*` (dominio).
-- `security invoker`: la RLS de las tablas (organización, empresas accesibles, nivel de `ventas`)
-- decide qué números ve quien llama. Los números son texto del panel anterior: se devuelve el
-- mayor por valor numérico cuando todo el número es numérico; si no, el mayor por texto.
--
-- Migración aditiva (solo una función). Reversión (migración posterior):
--   drop function public.historial_ultimo_numero(text, uuid);

create or replace function public.historial_ultimo_numero(p_tipo text, p_empresa_id uuid default null)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_resultado text;
begin
  if p_tipo is null or p_tipo not in ('comprobantes', 'cobros') then
    raise exception 'TIPO_INVALIDO: el tipo debe ser comprobantes o cobros' using errcode = '22023';
  end if;

  if p_tipo = 'comprobantes' then
    select n.numero into v_resultado
    from (
      select h.numero from dominio.historial_comprobantes h
      where p_empresa_id is null or h.empresa_id = p_empresa_id
    ) n
    order by (case when n.numero ~ '^[0-9]{1,18}$' then n.numero::bigint end) desc nulls last, n.numero desc
    limit 1;
  else
    select n.numero into v_resultado
    from (
      select h.comprobante_numero as numero from dominio.historial_cobros h
      where p_empresa_id is null or h.empresa_id = p_empresa_id
    ) n
    order by (case when n.numero ~ '^[0-9]{1,18}$' then n.numero::bigint end) desc nulls last, n.numero desc
    limit 1;
  end if;

  return v_resultado;
end;
$$;

comment on function public.historial_ultimo_numero(text, uuid) is
  'F-VTA-37 (FR-009): mayor número histórico de comprobantes o cobros (opcionalmente de una empresa), según la RLS de quien llama; nulo si no hay historial.';

revoke execute on function public.historial_ultimo_numero(text, uuid) from public, anon;
grant execute on function public.historial_ultimo_numero(text, uuid) to authenticated;
