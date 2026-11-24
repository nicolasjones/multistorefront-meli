-- Lote 42 (MSF-647): `dominio.empresas` — la política de UPDATE exige la sección `empresas` en edición.
-- Antes: `empresas_update` pedía `private.puede_escribir()` (ser administrador de la organización), un permiso global
-- que ignora la matriz de roles: un rol personalizado con `empresas` en edición no podía editar y un administrador sí
-- podía aunque su rol no tuviera la sección. Ahora la escritura sigue la misma sección que la pantalla `/empresas`.
--
-- Verificado (lote 42, ítem a): tras `20270507210400` la política `empresas_select` sigue mostrando todas las filas de la
-- organización, pero `authenticated` ya no tiene SELECT sobre `cuit`, `correo` ni `whatsapp` (ni con `select *`, ni como
-- filtro de un `update … where`), así que no hay fuga; esas columnas se leen solo por `public.empresa_datos`. Se deja
-- cubierto con un pgTAP propio.
--
-- Esquema (Principio VII): sin tablas ni columnas nuevas; solo se reemplaza una política de `dominio.empresas`.
-- `private.nivel_seccion('empresas')` ya resuelve al superadmin con organización activa como `edicion`.
-- La identidad visual de la tienda vive en `dominio.tienda_identidad` (otra tabla y otras RPC): no cambia.
-- Los grants de UPDATE por columna no cambian.
--
-- Migración aditiva. Reversión (migración posterior): recrear `empresas_update` con
--   using/with check (organizacion_id = private.organizacion_id() and private.puede_escribir()).

drop policy if exists empresas_update on dominio.empresas;
create policy empresas_update on dominio.empresas
  for update to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('empresas')) = 'edicion'
  )
  with check (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('empresas')) = 'edicion'
  );
