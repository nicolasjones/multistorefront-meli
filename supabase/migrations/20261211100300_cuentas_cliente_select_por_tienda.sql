-- F-CLI-05 (MSF-422, devolución del Revisor): la lectura directa de `public.cuentas_cliente` respeta el alcance
-- de tiendas del operador, igual que la RPC `cuentas_web_de_cliente`. Esquema: `public` (plataforma, sin cambios).
-- Aditiva: solo reemplaza la política SELECT. Reversión: volver a crearla sin el filtro de `empresas_accesibles`.
drop policy if exists cuentas_cliente_select on public.cuentas_cliente;

create policy cuentas_cliente_select on public.cuentas_cliente
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('clientes')) in ('lectura', 'edicion')
    and empresa_id in (select private.empresas_accesibles())
  );
