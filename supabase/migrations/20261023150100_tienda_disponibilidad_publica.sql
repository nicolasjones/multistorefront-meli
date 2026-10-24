-- F-TDA-18 (MSF-332, épica MSF-167): disponibilidad visible de la tienda pública.
-- FR-020, FR-021, FR-023.
--
-- Esquemas (Principio VII): sin tablas nuevas. La función es lógica interna de la plataforma de
-- tienda → `private`; sin grants a roles de API (la usan las funciones `publico.*` de F-TDA-12/13).
--
--   private.disponible_publico(uuid)  private (función)  true si el producto tiene unidades disponibles.
--
-- Aditiva. Reversión: drop function private.disponible_publico(uuid);

-- Sin sesión (la ejecutan las funciones públicas bajo `anon`): el aislamiento lo da quien la llama, que
-- ya resolvió el producto de la tienda del host. Devuelve solo el booleano, nunca la cantidad. Ignora la
-- elección manual `a_pedido` / `stock_entrante` (D6). Mismo criterio que private.productos_con_stock()
-- (existencias.cantidad > 0); el reservado queda fuera de la cuenta y cuando Stock lo cierre (D4) se
-- cambia solo esta función.
create or replace function private.disponible_publico(p_producto uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from dominio.existencias e
     where e.producto_id = p_producto
       and e.cantidad > 0
  );
$$;

comment on function private.disponible_publico(uuid) is
  'F-TDA-18: true si el producto tiene unidades disponibles (existencias.cantidad > 0, igual que private.productos_con_stock()). Solo el booleano, nunca cantidades; ignora la disponibilidad manual. Sin acceso para anon/authenticated: la usan las funciones públicas.';

revoke execute on function private.disponible_publico(uuid) from public, anon, authenticated;
