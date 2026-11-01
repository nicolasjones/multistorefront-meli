-- MSF-260 · F-CON-05 (FR-009): anonimización de un contacto, a pedido y de forma irreversible.
--
-- Esquema (Principio VII): sin tablas nuevas; la función vive en `public` (ejecución) y escribe en
-- `dominio.contactos` y `dominio.consultas` por ser SECURITY DEFINER.
--
-- Qué hace: reemplaza por texto neutro nombre, correo y teléfono del contacto y nombre, contacto y mensaje
-- de sus consultas vinculadas; marca `anonimizado_en` (libera las claves de duplicado, ver el trigger de
-- 20270201100000); NO borra filas ni toca `dominio.comprobantes_venta` (sus importes, estados y fechas
-- siguen intactos; `contacto_id` apunta al contacto anonimizado). El consentimiento (fecha, texto y quién
-- lo registró) se conserva como prueba. Solo para un contacto activo. La actividad no copia datos personales.
--
-- Seguridad: `consultas` = edición y empresa accesible (`42501`, misma respuesta para inexistente o ajeno);
-- `40001` si `updated_at` no coincide; `22023` si ya estaba anonimizado. `revoke … from public, anon`.
--
-- Migración aditiva, pero la ACCIÓN es irreversible: los datos anonimizados solo se recuperan desde un
-- backup. Reversión de la función (migración posterior):
--   drop function public.anonimizar_contacto(uuid, timestamptz);

create or replace function public.anonimizar_contacto(p_id uuid, p_updated_at timestamptz)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_c dominio.contactos%rowtype;
  v_empresa text;
begin
  if v_actor is null or v_org is null
     or (select private.nivel_seccion('consultas')) <> 'edicion' then
    raise exception 'No tenés permiso para anonimizar contactos' using errcode = '42501';
  end if;

  select * into v_c from dominio.contactos c
  where c.id = p_id and c.organizacion_id = v_org
  for update;
  if not found or not exists (select 1 from private.empresas_accesibles() ea where ea = v_c.empresa_id) then
    raise exception 'No tenés permiso para anonimizar contactos' using errcode = '42501';
  end if;
  if v_c.anonimizado_en is not null then
    raise exception 'El contacto ya está anonimizado' using errcode = '22023', detail = 'anonimizado';
  end if;
  if p_updated_at is distinct from v_c.updated_at then
    raise exception 'El contacto fue modificado por otra persona' using errcode = '40001';
  end if;

  update dominio.consultas
     set nombre = 'Anonimizado',
         contacto = 'Anonimizado',
         mensaje = case when origen = 'whatsapp' and mensaje is null then null
                        else 'Mensaje eliminado por anonimización' end
   where contacto_id = p_id and organizacion_id = v_org;

  update dominio.contactos
     set nombre = 'Anonimizado', correo = null, telefono = null, anonimizado_en = now()
   where id = p_id;

  select e.nombre into v_empresa from dominio.empresas e where e.id = v_c.empresa_id;
  perform private.insertar_actividad(
    v_org, v_actor, 'contacto.anonimizado',
    format('Anonimizó un contacto de «%s»', v_empresa), v_c.empresa_id);
end;
$$;

revoke execute on function public.anonimizar_contacto(uuid, timestamptz) from public, anon;
grant execute on function public.anonimizar_contacto(uuid, timestamptz) to authenticated;

comment on function public.anonimizar_contacto(uuid, timestamptz) is
  'MSF-260: anonimiza (irreversible) un contacto activo y los datos personales de sus consultas vinculadas; no borra filas ni toca ventas. 40001 conflicto; 22023 ya anonimizado; 42501 sin permiso.';
