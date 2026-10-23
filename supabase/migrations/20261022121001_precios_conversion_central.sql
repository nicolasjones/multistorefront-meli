-- F-PRE-01 (MSF-115, épica MSF-114): conversión a pesos y precio central.
-- Esquema: sin tablas nuevas (funciones en `private`; Principio VII).
--
-- `private.a_pesos` es el ÚNICO punto de lectura de la cotización: MSF-116 cambia su
-- fuente sin tocar a quienes la llaman. No se guarda ningún importe en pesos: todo se
-- calcula al leer. Sin cotización cargada, USD devuelve null (no se inventa un valor).
-- Son SECURITY INVOKER: rigen las políticas RLS del llamador (aislamiento por organización).
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function private.precio_central_ars(uuid);
--   drop function private.a_pesos(numeric, text, uuid);

create or replace function private.a_pesos(p_importe numeric, p_moneda text, p_organizacion uuid)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when p_importe is null then null
    when p_moneda = 'ARS' then p_importe
    when p_moneda = 'USD' then
      (select round(p_importe * c.valor, 2)
         from dominio.cotizacion_inicial c
        where c.organizacion_id = p_organizacion)
    else null
  end;
$$;

comment on function private.a_pesos(numeric, text, uuid) is
  'F-PRE-01: importe en pesos. ARS tal cual; USD × cotización vigente de la organización; sin cotización → null.';

-- Precio de lista del producto en pesos, sin IVA.
create or replace function private.precio_central_ars(p_producto uuid)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select private.a_pesos(p.precio_lista, p.moneda, p.organizacion_id)
    from dominio.productos p
   where p.id = p_producto;
$$;

comment on function private.precio_central_ars(uuid) is
  'F-PRE-01: precio de lista del producto en pesos sin IVA; null si es USD y no hay cotización.';

revoke execute on function private.a_pesos(numeric, text, uuid) from public, anon;
revoke execute on function private.precio_central_ars(uuid) from public, anon;
grant execute on function private.a_pesos(numeric, text, uuid) to authenticated;
grant execute on function private.precio_central_ars(uuid) to authenticated;
