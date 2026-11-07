-- F-PRV-03 (MSF-367, épica MSF-205): superficie mínima de proveedores para quien
-- registra ingresos o edita productos sin tener acceso a la ficha completa.
-- Esquema (Principio VII): es una VISTA de superficie en `public` (no una tabla); la
-- entidad sigue en `dominio.proveedores`.
--
-- Por qué NO es `security_invoker`: el Operador (sección `proveedores` en `ninguno`) no
-- tiene `select` sobre la tabla. La vista corre con los permisos de su dueño, por eso
-- el filtro por organización y por nivel es explícito aquí y solo expone `id`,
-- `razon_social` y `activo` (nunca CUIT, contacto ni observaciones). `anon` sin acceso.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop view public.proveedores_basico;

create view public.proveedores_basico
with (security_invoker = false) as
select p.id, p.razon_social, p.activo
  from dominio.proveedores p
 where p.organizacion_id = (select private.organizacion_id())
   and (
     (select private.nivel_seccion('productos')) = 'edicion'
     or (select private.nivel_seccion('stock')) in ('lectura', 'edicion')
     or (select private.nivel_seccion('proveedores')) in ('lectura', 'edicion')
   );

comment on view public.proveedores_basico is
  'F-PRV-03: id, razón social y estado de los proveedores de la organización para selectores (productos, ingresos). Sin CUIT ni contacto.';

revoke all on public.proveedores_basico from public, anon, authenticated;
grant select on public.proveedores_basico to authenticated;
