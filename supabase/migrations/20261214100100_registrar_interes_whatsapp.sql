-- MSF-226 · F-CON-02 (épica MSF-130, FR-002, FR-003): RPC pública que suma un interés por WhatsApp.
--
-- Esquemas (Principio VII): no se crea ni altera ninguna tabla.
--   * publico.registrar_interes_whatsapp -> `publico` (superficie de `anon`; precedente
--     publico.crear_consulta_publica). `publico` sigue SIN tablas; escribe en dominio.intereses_whatsapp
--     por SECURITY DEFINER.
--
-- La empresa sale SOLO del dominio (dominio.tiendas); el cliente nunca manda empresa ni organización.
-- No recibe ni guarda datos personales. Sin anti-spam acá (es de la tienda, MSF-212).
-- Dominio desconocido o empresa desactivada → el mismo P0002 genérico, resuelto ANTES de validar el
-- producto (no se puede sondear qué dominios existen). Producto nulo, inexistente o de otra
-- organización → 22023 con el campo en DETAIL.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function publico.registrar_interes_whatsapp(text, uuid);

create or replace function publico.registrar_interes_whatsapp(host text, producto_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_empresa uuid;
  v_organizacion uuid;
begin
  select e.id, e.organizacion_id into v_empresa, v_organizacion
    from dominio.tiendas ti
    join dominio.empresas e on e.id = ti.empresa_id and e.organizacion_id = ti.organizacion_id
   where ti.dominio = private.normalizar_host(host) and e.activa;
  if v_empresa is null then
    raise exception 'tienda no disponible' using errcode = 'P0002';
  end if;

  if registrar_interes_whatsapp.producto_id is null or not exists (
    select 1 from dominio.productos p
     where p.id = registrar_interes_whatsapp.producto_id and p.organizacion_id = v_organizacion
  ) then
    raise exception 'producto inválido' using errcode = '22023', detail = 'producto_id';
  end if;

  insert into dominio.intereses_whatsapp (organizacion_id, empresa_id, producto_id)
  values (v_organizacion, v_empresa, registrar_interes_whatsapp.producto_id);
end;
$$;

revoke execute on function publico.registrar_interes_whatsapp(text, uuid) from public;
grant execute on function publico.registrar_interes_whatsapp(text, uuid) to anon, authenticated;

comment on function publico.registrar_interes_whatsapp(text, uuid) is
  'F-CON-02: suma un interés por WhatsApp a un producto de la tienda del host. Empresa solo por dominio; sin datos personales; P0002 genérico (dominio desconocido o empresa desactivada); 22023 producto inválido.';
