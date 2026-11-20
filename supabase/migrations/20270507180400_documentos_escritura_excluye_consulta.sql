-- MSF-651 (lote 32, MSF-647): el rol Consulta no escribe ni borra documentos de la búsqueda documental (RAG).
--
-- Regla (decisión del dueño): «el rol CONSULTA no escribe ni borra documentos RAG». NO es «solo administrador»: Operador,
-- Mostrador, Depósito, Administración, Técnico y Administrador siguen subiendo, indexando y borrando como hasta ahora.
--
-- Hallazgo: las políticas de escritura de `fragmentos_indexados`, `documentos`, `versiones_documento` y las de insert/delete
-- del bucket `documentos-rag` solo comprobaban la organización, y `eliminar_documento` tampoco miraba el rol: cualquier
-- miembro, también Consulta (solo lectura), podía subir, modificar o borrar por la API directa.
--
-- Qué cambia:
--   · `private.puede_gestionar_documentos()` (`security definer`, `stable`, `search_path = ''`): verdadero para un miembro ACTIVO
--     de la organización con un rol ESCRITOR (lista blanca: administrador, operador, mostrador, deposito, administracion,
--     tecnico) y para el superadmin con una organización activa (`private.puede_escribir()`). Consulta y el rol heredado
--     `miembro` (solo lectura en la matriz) NO escriben, y un rol de solo lectura futuro tampoco por defecto.
--     Execute solo para `authenticated` (lo usan las políticas).
--   · Políticas de escritura (insert/update/delete) de `fragmentos_indexados`, `documentos`, `versiones_documento` y del
--     bucket `documentos-rag` (insert/delete) exigen además ese helper; el alta de documento y de versión siguen exigiendo la
--     funcionalidad `busqueda-documental`. `select` queda como estaba (Consulta sigue leyendo y buscando).
--   · `private.eliminar_documento` (la usa `public.eliminar_documento`) rechaza con 42501 a quien no puede gestionar documentos.
--   · `service_role`: grants explícitos (select, insert, delete) sobre `fragmentos_indexados`. La función Edge `indexar-documento`
--     escribe y borra los fragmentos con el cliente de servicio SOLO después de autorizar con el JWT del usuario (funcionalidad,
--     RLS sobre la versión, permiso y reclamo propio); así la indexación no depende del rol del usuario.
--
-- Migración aditiva en datos (políticas y funciones; se recrean con `drop policy if exists` + `create`, idempotente).
-- Reversión: `drop policy` de las políticas de escritura nuevas y recrear las originales de 20261005000001
-- (`fragmentos_indexados_propia_organizacion` for all; `documentos_*`, `versiones_documento_*` y `documentos_rag_*` sin el
-- helper); `create or replace` de `private.eliminar_documento` de 20261005000001; `revoke select, insert, delete on
-- public.fragmentos_indexados from service_role`; `drop function private.puede_gestionar_documentos()`.

create or replace function private.puede_gestionar_documentos()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select private.puede_escribir())
    or exists (
      select 1 from public.usuarios_organizacion u
       where u.user_id = (select auth.uid())
         and u.organizacion_id = (select private.organizacion_id())
         and u.estado = 'activo'
         and u.rol_id in ('administrador', 'operador', 'mostrador', 'deposito', 'administracion', 'tecnico')
    );
$$;

comment on function private.puede_gestionar_documentos() is
  'MSF-651: true si el usuario actual puede subir, indexar y borrar documentos RAG: miembro activo con un rol escritor (administrador, operador, mostrador, deposito, administracion, tecnico), o superadmin con organización activa. Consulta y miembro no.';

revoke execute on function private.puede_gestionar_documentos() from public, anon;
grant execute on function private.puede_gestionar_documentos() to authenticated;

-- ============================================================================
-- fragmentos_indexados
-- ============================================================================
drop policy if exists fragmentos_indexados_propia_organizacion on public.fragmentos_indexados;
drop policy if exists fragmentos_indexados_select on public.fragmentos_indexados;
drop policy if exists fragmentos_indexados_insert on public.fragmentos_indexados;
drop policy if exists fragmentos_indexados_update on public.fragmentos_indexados;
drop policy if exists fragmentos_indexados_delete on public.fragmentos_indexados;

create policy fragmentos_indexados_select on public.fragmentos_indexados
  for select to authenticated
  using (organizacion_id = (select private.organizacion_id()));

create policy fragmentos_indexados_insert on public.fragmentos_indexados
  for insert to authenticated
  with check (organizacion_id = (select private.organizacion_id()) and (select private.puede_gestionar_documentos()));

create policy fragmentos_indexados_update on public.fragmentos_indexados
  for update to authenticated
  using (organizacion_id = (select private.organizacion_id()) and (select private.puede_gestionar_documentos()))
  with check (organizacion_id = (select private.organizacion_id()) and (select private.puede_gestionar_documentos()));

create policy fragmentos_indexados_delete on public.fragmentos_indexados
  for delete to authenticated
  using (organizacion_id = (select private.organizacion_id()) and (select private.puede_gestionar_documentos()));

grant select, insert, delete on table public.fragmentos_indexados to service_role;

-- ============================================================================
-- documentos
-- ============================================================================
drop policy if exists documentos_propia_organizacion_insert on public.documentos;
create policy documentos_propia_organizacion_insert on public.documentos
  for insert
  with check (
    organizacion_id = (select private.organizacion_id())
    and (select private.tiene_feature('busqueda-documental'))
    and (select private.puede_gestionar_documentos())
  );

drop policy if exists documentos_propia_organizacion_update on public.documentos;
create policy documentos_propia_organizacion_update on public.documentos
  for update
  using (organizacion_id = (select private.organizacion_id()) and (select private.puede_gestionar_documentos()))
  with check (organizacion_id = (select private.organizacion_id()) and (select private.puede_gestionar_documentos()));

drop policy if exists documentos_propia_organizacion_delete on public.documentos;
create policy documentos_propia_organizacion_delete on public.documentos
  for delete
  using (organizacion_id = (select private.organizacion_id()) and (select private.puede_gestionar_documentos()));

-- ============================================================================
-- versiones_documento
-- ============================================================================
drop policy if exists versiones_documento_propia_organizacion_insert on public.versiones_documento;
create policy versiones_documento_propia_organizacion_insert on public.versiones_documento
  for insert
  with check (
    exists (
      select 1 from public.documentos d
      where d.id = versiones_documento.documento_id
        and d.organizacion_id = (select private.organizacion_id())
    )
    and (select private.tiene_feature('busqueda-documental'))
    and (select private.puede_gestionar_documentos())
  );

drop policy if exists versiones_documento_propia_organizacion_update on public.versiones_documento;
create policy versiones_documento_propia_organizacion_update on public.versiones_documento
  for update
  using (
    exists (
      select 1 from public.documentos d
      where d.id = versiones_documento.documento_id
        and d.organizacion_id = (select private.organizacion_id())
    )
    and (select private.puede_gestionar_documentos())
  )
  with check (
    exists (
      select 1 from public.documentos d
      where d.id = versiones_documento.documento_id
        and d.organizacion_id = (select private.organizacion_id())
    )
    and (select private.puede_gestionar_documentos())
  );

drop policy if exists versiones_documento_propia_organizacion_delete on public.versiones_documento;
create policy versiones_documento_propia_organizacion_delete on public.versiones_documento
  for delete
  using (
    exists (
      select 1 from public.documentos d
      where d.id = versiones_documento.documento_id
        and d.organizacion_id = (select private.organizacion_id())
    )
    and (select private.puede_gestionar_documentos())
  );

-- ============================================================================
-- Storage: bucket documentos-rag
-- ============================================================================
drop policy if exists documentos_rag_propia_organizacion_insert on storage.objects;
create policy documentos_rag_propia_organizacion_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documentos-rag'
    and (storage.foldername(name))[1] = (select private.organizacion_id())::text
    and (select private.puede_gestionar_documentos())
  );

drop policy if exists documentos_rag_propia_organizacion_delete on storage.objects;
create policy documentos_rag_propia_organizacion_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'documentos-rag'
    and (storage.foldername(name))[1] = (select private.organizacion_id())::text
    and (select private.puede_gestionar_documentos())
  );

-- ============================================================================
-- eliminar_documento (definición vigente de 20261005000001 + el chequeo de rol)
-- ============================================================================
create or replace function private.eliminar_documento(p_documento_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion_id uuid;
  v_path text;
begin
  select organizacion_id into v_organizacion_id from public.documentos where id = p_documento_id;

  if v_organizacion_id is null or v_organizacion_id != (select private.organizacion_id()) then
    raise exception 'Documento no encontrado' using errcode = '42501';
  end if;

  if not (select private.puede_gestionar_documentos()) then
    raise exception 'Tu rol no puede eliminar documentos' using errcode = '42501';
  end if;

  -- storage.objects bloquea el delete directo por SQL salvo opt-in
  -- explícito por transacción (storage.protect_delete) — ver nota de
  -- desvío en research.md, encontrado al verificar contra la base real.
  perform set_config('storage.allow_delete_query', 'true', true);

  for v_path in select storage_path from public.versiones_documento where documento_id = p_documento_id loop
    delete from storage.objects where bucket_id = 'documentos-rag' and name = v_path;
  end loop;

  delete from public.documentos where id = p_documento_id;
end;
$$;

revoke execute on function private.eliminar_documento(uuid) from public, anon, authenticated;
