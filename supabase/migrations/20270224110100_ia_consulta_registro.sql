-- F-IA-01 (MSF-411, épica MSF-233) · FR-020, SC-006: registra las cuatro fuentes de consulta del asistente.
-- Cuatro funcionalidades (`catalogo`, `stock`, `precios`, `ventas`), UNA vista por funcionalidad en `fuentes_chat_ia` y
-- en `fuentes_mcp` (`private.mcp_leer_fila` resuelve la vista con `limit 1`), y `capacidades_chat_ia` /
-- `capacidades_mcp` con `lectura = true` y `ejecucion = false`: el asistente consulta, nunca escribe ni ejecuta (D-7).
--
-- Registrar NO habilita: un superadmin activa cada funcionalidad por organización desde Funcionalidades (FR-022).
-- Idempotente (`on conflict do nothing`): una segunda corrida no duplica ni cambia `actualizado_en`. El evento
-- `feature_registrada` se escribe solo si la funcionalidad es nueva Y hay un superadmin que lo firme
-- (`eventos_features.actor_user_id` es obligatorio; en un reset desde cero todavía no hay superadmin, ver
-- `20261020100700_service_funcionalidad.sql`).
--
-- Migración aditiva. Reversión (migración posterior):
--   delete from public.features where id in ('catalogo', 'stock', 'precios', 'ventas');
-- (borra en cascada fuentes, capacidades y habilitaciones por organización).

create or replace function private.registrar_fuentes_ia_consulta()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_fila record;
begin
  select user_id into v_actor from public.superadmins order by user_id limit 1;

  for v_fila in
    select * from (values
      ('catalogo', 'Consulta de catálogo (asistente IA)',
        'El asistente responde sobre los productos de la organización: nombre, SKU, categoría y estado. Solo lectura.',
        'ia_consulta_catalogo'),
      ('stock', 'Consulta de stock (asistente IA)',
        'El asistente responde sobre el stock por depósito: cantidad, reservado y disponible. Solo lectura.',
        'ia_consulta_stock'),
      ('precios', 'Consulta de precios (asistente IA)',
        'El asistente responde sobre el precio de lista y las escalas de cada producto (sin costos ni IVA). Solo lectura.',
        'ia_consulta_precios'),
      ('ventas', 'Consulta de ventas (asistente IA)',
        'El asistente responde sobre las facturas confirmadas: número, fecha y totales (sin datos del cliente). Solo lectura.',
        'ia_consulta_ventas')
    ) as t (id, nombre, descripcion, vista)
  loop
    if not exists (select 1 from public.features where id = v_fila.id) then
      insert into public.features (id, nombre, descripcion) values (v_fila.id, v_fila.nombre, v_fila.descripcion);
      if v_actor is not null then
        insert into public.eventos_features (feature_id, actor_user_id, accion)
        values (v_fila.id, v_actor, 'feature_registrada');
      end if;
    end if;

    insert into public.fuentes_chat_ia (feature_id, vista, descripcion)
    values (v_fila.id, v_fila.vista, v_fila.descripcion)
    on conflict do nothing;

    insert into public.fuentes_mcp (feature_id, vista, descripcion)
    values (v_fila.id, v_fila.vista, v_fila.descripcion)
    on conflict do nothing;

    insert into public.capacidades_chat_ia (feature_id, lectura, ejecucion)
    values (v_fila.id, true, false)
    on conflict do nothing;

    insert into public.capacidades_mcp (feature_id, lectura, ejecucion)
    values (v_fila.id, true, false)
    on conflict do nothing;
  end loop;
end;
$$;

comment on function private.registrar_fuentes_ia_consulta() is
  'F-IA-01: registra de forma idempotente las funcionalidades catalogo/stock/precios/ventas y sus fuentes y capacidades de solo lectura en el chat y en MCP.';

revoke execute on function private.registrar_fuentes_ia_consulta() from public, anon, authenticated;

select private.registrar_fuentes_ia_consulta();
