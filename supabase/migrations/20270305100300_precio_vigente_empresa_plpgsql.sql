-- MSF-846 (parte A): private.precio_vigente_empresa pasa de SQL set-returning a plpgsql.
--
-- Causa: la versión SQL (20270221100003) costaba ~5-7 ms por producto aunque sus dos piezas son baratas
-- (private.precio_final_publico ~0,3 ms, private.promocion_vigente ~0,07 ms). La búsqueda pública con precio_max u
-- orden por precio la evalúa sobre todas las coincidencias y quedaba en 2,0-2,8 s (statement_timeout 3 s).
--
-- Contrato SIN cambios: misma firma, mismo `returns table (precio, precio_anterior)`, security definer,
-- search_path vacío, stable, siempre UNA fila, mismos grants (sin acceso para anon/authenticated).
--   precio          = null si el precio normal no es calculable; el normal si no hay promoción vigente;
--                     el promocional con alícuota e interruptor de IVA si la hay.
--   precio_anterior = precio normal solo con promoción vigente; si no, null.
-- La usan también publico.sugerencias_busqueda_por_dominio, la ficha (producto_por_dominio), destacados/home y la búsqueda (catalogo_pagina_por_dominio NO la llama: calcula el precio directo)
-- además de la búsqueda; ninguna cambia su contrato: solo baja el costo por producto.
--
-- Migración aditiva (create or replace; sin tablas). Reversión (migración posterior): recrear la función SQL de
-- 20270221100003_promociones_precio_vigente.sql (mismo nombre y firma).

create or replace function private.precio_vigente_empresa(p_producto uuid, p_empresa uuid, p_ahora timestamptz default now())
returns table (precio numeric, precio_anterior numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_n numeric;
  v_pr numeric;
begin
  v_n := private.precio_final_publico(p_producto, p_empresa);
  v_pr := private.promocion_vigente(p_producto, p_empresa, p_ahora);
  return query select
    case when v_n is null then null
         when v_pr is null then v_n
         else private.precio_con_iva_visible(p_producto, p_empresa, v_pr) end,
    case when v_n is null or v_pr is null then null else v_n end;
end;
$$;

comment on function private.precio_vigente_empresa(uuid, uuid, timestamptz) is
  'F-PRE-11: precio público vigente de un producto para una empresa en p_ahora: la promoción (si rige) reemplaza el neto, luego alícuota e interruptor de IVA. precio_anterior = precio normal, solo con promoción vigente. Sin promoción ≡ private.precio_final_publico. Sin acceso para anon/authenticated. MSF-846: plpgsql (mismo contrato que la versión SQL).';

revoke execute on function private.precio_vigente_empresa(uuid, uuid, timestamptz) from public, anon, authenticated;
