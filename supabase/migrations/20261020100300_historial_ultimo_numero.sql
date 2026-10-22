-- F-VTA-37 (MSF-275, FR-009): último número histórico, para que la numeración nueva de Ventas
-- arranque en uno posterior. Fijar la numeración nueva queda fuera de esta épica.
--
-- Esquema: sin tablas nuevas; lee `dominio.historial_comprobantes` / `historial_cobros`.
-- `security invoker`: rige la RLS del historial (organización, empresa asignada y nivel de
-- `ventas`); quien no ve el historial recibe null. Devuelve el número original completo del
-- panel anterior (p. ej. `A-0001-00018842`), elegido por su parte numérica.
--
-- Migración aditiva. Reversión (en una migración posterior):
--   drop function public.historial_ultimo_numero(text, uuid);

create or replace function public.historial_ultimo_numero(p_tipo text, p_empresa_id uuid)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_numero text;
begin
  if p_tipo is null or p_tipo not in ('comprobantes', 'cobros') then
    raise exception 'TIPO_INVALIDO: el tipo debe ser comprobantes o cobros' using errcode = 'P0001';
  end if;

  if p_tipo = 'comprobantes' then
    select h.numero into v_numero
    from dominio.historial_comprobantes h
    where h.organizacion_id = (select private.organizacion_id())
      and h.empresa_id = p_empresa_id
    order by nullif(regexp_replace(h.numero, '\D', '', 'g'), '')::numeric desc nulls last, h.numero desc
    limit 1;
  else
    select h.comprobante_numero into v_numero
    from dominio.historial_cobros h
    where h.organizacion_id = (select private.organizacion_id())
      and h.empresa_id = p_empresa_id
    order by nullif(regexp_replace(h.comprobante_numero, '\D', '', 'g'), '')::numeric desc nulls last, h.comprobante_numero desc
    limit 1;
  end if;

  return v_numero;
end;
$$;

comment on function public.historial_ultimo_numero(text, uuid) is
  'F-VTA-37 (FR-009). Mayor número histórico (por su parte numérica) de comprobantes o cobros de una tienda; null si no hay historial visible. Errores: TIPO_INVALIDO.';

revoke execute on function public.historial_ultimo_numero(text, uuid) from public, anon;
grant execute on function public.historial_ultimo_numero(text, uuid) to authenticated;
