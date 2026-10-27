-- MSF-186 · F-CON-01 (FR-002): único punto de alta de una consulta.
--
-- Esquema (Principio VII): la función vive en `publico` (superficie para `anon`, sin tablas,
-- precedente MSF-241); escribe en `dominio.consultas` por ser SECURITY DEFINER.
--
-- Seguridad: la empresa sale SOLO del host (`dominio.tiendas`); la función no recibe `empresa_id`.
-- Host desconocido, inválido o de empresa desactivada → el mismo error genérico (P0002), y se
-- resuelve ANTES de validar los datos, así no se puede sondear qué dominios existen.
-- El anti-spam (campo trampa, límite por IP) es de la tienda (MSF-212).
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function publico.crear_consulta_publica(text, text, text, text, text, uuid);

create or replace function publico.crear_consulta_publica(
  host text,
  origen text,
  nombre text,
  contacto text,
  mensaje text default null,
  producto_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_empresa uuid;
  v_org uuid;
  v_nombre text := btrim(coalesce(nombre, ''));
  v_contacto text := btrim(coalesce(contacto, ''));
  v_mensaje text := nullif(btrim(coalesce(mensaje, '')), '');
  v_id uuid;
begin
  select t.empresa_id, t.organizacion_id into v_empresa, v_org
  from dominio.tiendas t
  join dominio.empresas e on e.id = t.empresa_id and e.organizacion_id = t.organizacion_id
  where t.dominio = private.normalizar_host(host)
    and e.activa;

  if v_empresa is null then
    raise exception 'No se encontró la tienda' using errcode = 'P0002';
  end if;

  if origen is null or origen not in ('formulario', 'whatsapp') then
    raise exception 'Datos inválidos' using errcode = '22023', detail = 'origen';
  end if;
  if v_nombre = '' or length(v_nombre) > 120 then
    raise exception 'Datos inválidos' using errcode = '22023', detail = 'nombre';
  end if;
  -- Contacto: un correo o un teléfono (7 a 15 dígitos, con +, espacios, guiones y paréntesis).
  if v_contacto = '' or length(v_contacto) > 200
     or not (
       v_contacto ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$'
       or (v_contacto ~ '^\+?[0-9 ()-]+$'
           and length(regexp_replace(v_contacto, '[^0-9]', '', 'g')) between 7 and 15)
     ) then
    raise exception 'Datos inválidos' using errcode = '22023', detail = 'contacto';
  end if;
  if v_mensaje is null and origen = 'formulario' then
    raise exception 'Datos inválidos' using errcode = '22023', detail = 'mensaje';
  end if;
  if length(coalesce(v_mensaje, '')) > 2000 then
    raise exception 'Datos inválidos' using errcode = '22023', detail = 'mensaje';
  end if;
  if producto_id is not null and not exists (
    select 1 from dominio.productos p
    where p.id = producto_id and p.organizacion_id = v_org
  ) then
    raise exception 'Datos inválidos' using errcode = '22023', detail = 'producto_id';
  end if;

  insert into dominio.consultas (organizacion_id, empresa_id, origen, nombre, contacto, mensaje, producto_id)
  values (v_org, v_empresa, origen, v_nombre, v_contacto, v_mensaje, producto_id)
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function publico.crear_consulta_publica(text, text, text, text, text, uuid) from public;
grant execute on function publico.crear_consulta_publica(text, text, text, text, text, uuid) to anon, authenticated;

comment on function publico.crear_consulta_publica(text, text, text, text, text, uuid) is
  'MSF-186: alta pública de una consulta. La empresa sale del host; host desconocido o empresa desactivada dan el mismo P0002; datos inválidos dan 22023 con el campo en DETAIL.';
