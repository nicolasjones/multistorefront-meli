-- Renumerada al integrar la base `dokploy` (máxima `20270203120000`): antes `20270115120100_proveedores_contactos_rpc.sql`;
-- la versión vieja quedó bajo la cola aplicada y el aplicador la salteaba.
--
-- F-PRV-08 (MSF-449, épica MSF-445): RPC de contactos de proveedor (FR-022, FR-023).
-- Esquemas (Principio VII): sin tablas nuevas; las funciones se publican en `public`.
--
-- Son `security definer` (la tabla no tiene grants de escritura) con chequeo explícito de la
-- sección `proveedores` y de la organización de la sesión. Concurrencia: toda alta o cambio de
-- principal bloquea primero la fila del proveedor (`for update`), así dos altas simultáneas como
-- principal se serializan y la segunda deja a la primera sin marca; el índice único parcial es la
-- red de seguridad. Marcar un principal copia nombre, correo y teléfono a la ficha del proveedor.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.marcar_contacto_principal(uuid);
--   drop function public.agregar_contacto_proveedor(uuid, text, text, text, text, boolean);
--   drop function public.listar_contactos_proveedor(uuid);
--   drop function private.aplicar_contacto_principal(uuid, uuid);

-- Deja `p_contacto_id` como único principal de su proveedor y copia sus datos a la ficha.
-- Quien llama ya bloqueó la fila del proveedor.
create or replace function private.aplicar_contacto_principal(p_organizacion uuid, p_contacto_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_proveedor uuid;
  v_nombre text;
  v_correo text;
  v_telefono text;
begin
  select c.proveedor_id, c.nombre, c.correo, c.telefono
    into v_proveedor, v_nombre, v_correo, v_telefono
    from dominio.proveedores_contactos c
   where c.id = p_contacto_id and c.organizacion_id = p_organizacion;

  update dominio.proveedores_contactos c
     set principal = false, updated_at = clock_timestamp()
   where c.proveedor_id = v_proveedor and c.principal and c.id <> p_contacto_id;

  update dominio.proveedores_contactos c
     set principal = true, updated_at = clock_timestamp()
   where c.id = p_contacto_id and not c.principal;

  update dominio.proveedores p
     set persona_contacto = v_nombre, correo = v_correo, telefono = v_telefono
   where p.id = v_proveedor and p.organizacion_id = p_organizacion;
end;
$$;

revoke execute on function private.aplicar_contacto_principal(uuid, uuid) from public, anon, authenticated;

create or replace function public.listar_contactos_proveedor(p_proveedor_id uuid)
returns table (
  id uuid,
  nombre text,
  rol text,
  correo text,
  telefono text,
  principal boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
begin
  if (select auth.uid()) is null or v_organizacion is null
     or (select private.nivel_seccion('proveedores')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver los contactos del proveedor' using errcode = '42501';
  end if;

  return query
  select c.id, c.nombre, c.rol, c.correo, c.telefono, c.principal
    from dominio.proveedores_contactos c
   where c.organizacion_id = v_organizacion
     and c.proveedor_id = p_proveedor_id
   order by c.principal desc, lower(c.nombre), c.id;
end;
$$;

comment on function public.listar_contactos_proveedor(uuid) is
  'F-PRV-08: contactos de un proveedor (principal primero). Exige lectura o edición en Proveedores.';

revoke execute on function public.listar_contactos_proveedor(uuid) from public, anon;
grant execute on function public.listar_contactos_proveedor(uuid) to authenticated;

create or replace function public.agregar_contacto_proveedor(
  p_proveedor_id uuid,
  p_nombre text,
  p_rol text default null,
  p_correo text default null,
  p_telefono text default null,
  p_principal boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_nombre text := btrim(coalesce(p_nombre, ''));
  v_correo text := nullif(btrim(p_correo), '');
  v_id uuid;
begin
  if (select auth.uid()) is null or v_organizacion is null
     or (select private.nivel_seccion('proveedores')) <> 'edicion' then
    raise exception 'Tu rol no puede agregar contactos al proveedor' using errcode = '42501';
  end if;
  if v_nombre = '' then
    raise exception 'El nombre del contacto es obligatorio' using errcode = '22023';
  end if;
  -- Misma regla que el correo de la ficha (private.normalizar_proveedor): mantener alineadas.
  if v_correo is not null and v_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'El correo no tiene un formato válido' using errcode = '22023';
  end if;

  -- Serializa las altas y los cambios de principal del mismo proveedor.
  perform 1 from dominio.proveedores p
   where p.id = p_proveedor_id and p.organizacion_id = v_organizacion
   for update;
  if not found then
    raise exception 'El proveedor no existe' using errcode = 'P0002';
  end if;

  insert into dominio.proveedores_contactos (organizacion_id, proveedor_id, nombre, rol, correo, telefono)
  values (v_organizacion, p_proveedor_id, v_nombre, nullif(btrim(p_rol), ''), v_correo, nullif(btrim(p_telefono), ''))
  returning proveedores_contactos.id into v_id;

  if coalesce(p_principal, false) then
    perform private.aplicar_contacto_principal(v_organizacion, v_id);
  end if;

  perform private.registrar_actividad_contacto_proveedor(v_organizacion, (select auth.uid()), 'proveedor.contacto_agregado', v_id);
  if coalesce(p_principal, false) then
    perform private.registrar_actividad_contacto_proveedor(v_organizacion, (select auth.uid()), 'proveedor.contacto_principal_cambiado', v_id);
  end if;
  return v_id;
end;
$$;

comment on function public.agregar_contacto_proveedor(uuid, text, text, text, text, boolean) is
  'F-PRV-08: agrega un contacto al proveedor (opcionalmente como principal, que copia sus datos a la ficha). Exige edición en Proveedores.';

revoke execute on function public.agregar_contacto_proveedor(uuid, text, text, text, text, boolean) from public, anon;
grant execute on function public.agregar_contacto_proveedor(uuid, text, text, text, text, boolean) to authenticated;

create or replace function public.marcar_contacto_principal(p_contacto_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_proveedor uuid;
  v_ya_principal boolean;
begin
  if (select auth.uid()) is null or v_organizacion is null
     or (select private.nivel_seccion('proveedores')) <> 'edicion' then
    raise exception 'Tu rol no puede cambiar el contacto principal' using errcode = '42501';
  end if;

  select c.proveedor_id into v_proveedor
    from dominio.proveedores_contactos c
   where c.id = p_contacto_id and c.organizacion_id = v_organizacion;
  if v_proveedor is null then
    raise exception 'El contacto no existe' using errcode = 'P0002';
  end if;

  perform 1 from dominio.proveedores p
   where p.id = v_proveedor and p.organizacion_id = v_organizacion
   for update;

  -- Se relee tras el bloqueo: otra transacción pudo haberlo marcado mientras esperábamos.
  select c.principal into v_ya_principal
    from dominio.proveedores_contactos c where c.id = p_contacto_id;
  if v_ya_principal then
    return;
  end if;

  perform private.aplicar_contacto_principal(v_organizacion, p_contacto_id);
  perform private.registrar_actividad_contacto_proveedor(v_organizacion, (select auth.uid()), 'proveedor.contacto_principal_cambiado', p_contacto_id);
end;
$$;

comment on function public.marcar_contacto_principal(uuid) is
  'F-PRV-08: deja al contacto como único principal de su proveedor y copia nombre, correo y teléfono a la ficha. Exige edición en Proveedores.';

revoke execute on function public.marcar_contacto_principal(uuid) from public, anon;
grant execute on function public.marcar_contacto_principal(uuid) to authenticated;
