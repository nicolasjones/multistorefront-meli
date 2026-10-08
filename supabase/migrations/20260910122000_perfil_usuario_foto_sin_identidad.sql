-- La foto es opcional e independiente de la identidad personal. La validacion
-- de nombre/apellido se conserva en la restriccion de la tabla y en la UI.
drop policy perfiles_usuario_insert_titular on public.perfiles_usuario;
drop policy perfiles_usuario_update_titular on public.perfiles_usuario;

create policy perfiles_usuario_insert_titular
  on public.perfiles_usuario for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (
      (nombre is null and apellido is null)
      or (btrim(nombre) <> '' and btrim(apellido) <> '')
    )
  );

create policy perfiles_usuario_update_titular
  on public.perfiles_usuario for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (
      (nombre is null and apellido is null)
      or (btrim(nombre) <> '' and btrim(apellido) <> '')
    )
  );
