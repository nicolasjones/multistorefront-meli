-- MSF-2 seguridad (lote 38): `dominio.empresas` — CUIT, correo y teléfono (WhatsApp) solo para quien tiene la sección.
-- Antes: la política `empresas_select` deja leer TODA la fila a cualquier miembro de la organización; el guard de la
-- pantalla `/empresas` solo ocultaba la ruta, no el dato (con la API se leían CUIT, correo y WhatsApp).
--
-- Esquema (Principio VII): sin tablas ni columnas nuevas; cambian los PRIVILEGIOS de `dominio.empresas` y se suman dos
-- RPC de lectura en `public`.
--   · Columnas sensibles: `cuit`, `correo`, `whatsapp`. Se retira el SELECT de tabla a `authenticated` y se concede SELECT
--     solo de las demás columnas (id, organizacion_id, nombre, instagram, direccion, horarios, razon_social, activa,
--     created_at, updated_at): lo que necesitan el selector de empresas, los filtros y las funciones del panel.
--     `service_role` y las funciones `security definer` (que leen CUIT y correo para documentos, avisos y la tienda) no
--     cambian: se ejecutan con los privilegios del propietario.
--   · `public.empresa_datos(p_empresa)`: la fila completa de UNA empresa de la organización; exige la sección `empresas` en
--     lectura o edición (42501 si no). Es lo que lee la pantalla «Empresas».
--   · `public.empresa_contacto_documentos(p_empresa)`: nombre, dirección, WhatsApp y correo de la tienda para el documento
--     de una reparación; exige la sección `empresas` o `service_tecnico` en lectura o edición y empresa accesible. Sin CUIT.
--   · El UPDATE por columnas (nombre, whatsapp, correo, instagram, direccion, activa, razon_social, cuit, horarios) y su
--     política no cambian; el cliente deja de pedir de vuelta las columnas sensibles en el `returning` (lee por la RPC).
--
-- Seguridad de las RPC: `security definer`, `search_path = ''`, `stable`, organización de la sesión (nunca del llamador),
-- `revoke … from public, anon` y `grant execute … to authenticated`. Una empresa de otra organización devuelve cero filas.
--
-- Migración aditiva en datos. Reversión (migración posterior): grant select on dominio.empresas to authenticated;
-- drop function public.empresa_datos(uuid); drop function public.empresa_contacto_documentos(uuid).

revoke select on dominio.empresas from authenticated;
grant select (id, organizacion_id, nombre, instagram, direccion, horarios, razon_social, activa, created_at, updated_at)
  on dominio.empresas to authenticated;

create or replace function public.empresa_datos(p_empresa uuid)
returns table (
  id uuid,
  nombre text,
  whatsapp text,
  correo text,
  instagram text,
  direccion text,
  horarios text,
  razon_social text,
  cuit text,
  activa boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
begin
  if v_organizacion is null or (select private.nivel_seccion('empresas')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver los datos de las empresas' using errcode = '42501';
  end if;
  return query
    select e.id, e.nombre, e.whatsapp, e.correo, e.instagram, e.direccion, e.horarios, e.razon_social, e.cuit, e.activa
      from dominio.empresas e
     where e.id = p_empresa and e.organizacion_id = v_organizacion;
end;
$$;

comment on function public.empresa_datos(uuid) is
  'Datos completos de una empresa (incluye CUIT, correo y WhatsApp). Solo con la sección empresas en lectura o edición; 42501 si no. Una empresa de otra organización no devuelve filas.';

revoke execute on function public.empresa_datos(uuid) from public, anon;
grant execute on function public.empresa_datos(uuid) to authenticated;

create or replace function public.empresa_contacto_documentos(p_empresa uuid)
returns table (nombre text, direccion text, whatsapp text, correo text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
begin
  if v_organizacion is null
     or (
       (select private.nivel_seccion('empresas')) not in ('lectura', 'edicion')
       and (select private.nivel_seccion('service_tecnico')) not in ('lectura', 'edicion')
     )
     or p_empresa is null
     or p_empresa <> all (select private.empresas_accesibles()) then
    raise exception 'Tu rol no puede ver los datos de contacto de la tienda' using errcode = '42501';
  end if;
  return query
    select e.nombre, e.direccion, e.whatsapp, e.correo
      from dominio.empresas e
     where e.id = p_empresa and e.organizacion_id = v_organizacion;
end;
$$;

comment on function public.empresa_contacto_documentos(uuid) is
  'Nombre, dirección, WhatsApp y correo de una tienda accesible, para el documento de una reparación. Sección empresas o service_tecnico en lectura o edición; 42501 si no. Sin CUIT.';

revoke execute on function public.empresa_contacto_documentos(uuid) from public, anon;
grant execute on function public.empresa_contacto_documentos(uuid) to authenticated;
