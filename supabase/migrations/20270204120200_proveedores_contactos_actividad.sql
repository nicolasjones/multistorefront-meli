-- Renumerada al integrar la base `dokploy` (máxima `20270203120000`): antes `20270115120200_proveedores_contactos_actividad.sql`;
-- la versión vieja quedó bajo la cola aplicada y el aplicador la salteaba.
--
-- F-PRV-08 (MSF-449, épica MSF-445): eventos de Actividad `proveedor.contacto_agregado` y
-- `proveedor.contacto_principal_cambiado` (FR-024, Constitución III).
--
-- Esquemas (Principio VII): sin tablas nuevas; el evento va a `public.registro_actividad`
-- (existente) por `private.insertar_actividad`; el auxiliar vive en `private`.
--
-- El detalle nombra la razón social y el nombre del contacto; nunca lleva correo ni teléfono.
-- Lo llaman las RPC de contactos en la misma transacción.
--
-- Nota de orden: las RPC de 20270204120100 invocan este auxiliar en tiempo de ejecución (plpgsql
-- resuelve la llamada al ejecutar, no al crear), por eso el orden de migraciones es válido.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function private.registrar_actividad_contacto_proveedor(uuid, uuid, text, uuid);

create or replace function private.registrar_actividad_contacto_proveedor(
  p_organizacion uuid,
  p_actor uuid,
  p_tipo text,
  p_contacto_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_razon_social text;
  v_nombre text;
begin
  select p.razon_social, c.nombre into v_razon_social, v_nombre
    from dominio.proveedores_contactos c
    join dominio.proveedores p on p.id = c.proveedor_id and p.organizacion_id = c.organizacion_id
   where c.id = p_contacto_id and c.organizacion_id = p_organizacion;

  perform private.insertar_actividad(
    p_organizacion,
    p_actor,
    p_tipo,
    case p_tipo
      when 'proveedor.contacto_agregado'
        then format('Agregó el contacto %s al proveedor %s', v_nombre, v_razon_social)
      else format('Marcó a %s como contacto principal del proveedor %s', v_nombre, v_razon_social)
    end,
    null
  );
end;
$$;

revoke execute on function private.registrar_actividad_contacto_proveedor(uuid, uuid, text, uuid)
  from public, anon, authenticated;
