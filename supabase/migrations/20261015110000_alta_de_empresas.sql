-- Alta de empresas (spec 20261015-100000-alta-de-empresas, F-EMP-03, MSF-277;
-- FR-001..FR-005, FR-009, FR-010).
-- Esquema (Principio VII): no se crean tablas. `dominio.empresas` (existente,
-- esquema `dominio`: entidad de negocio) gana un índice único; las funciones
-- son de plataforma/acceso: `public.crear_empresa` (RPC) y
-- `private.copiar_configuracion_empresa` (punto de extensión, sin grants).
-- RLS: sin cambios; sigue sin política INSERT/DELETE para `authenticated`:
-- el alta ocurre solo por la RPC.
-- Pre-chequeo (debe dar 0 filas antes de aplicar; la migración no toca datos):
--   select organizacion_id, lower(btrim(nombre)), count(*) from dominio.empresas
--   group by 1, 2 having count(*) > 1;
-- Migración aditiva. Reversión (en una migración posterior, no en el mismo PR):
--   drop function public.crear_empresa(text, uuid);
--   drop function private.copiar_configuracion_empresa(uuid, uuid);
--   drop index dominio.empresas_organizacion_nombre_uq;

create unique index empresas_organizacion_nombre_uq
  on dominio.empresas (organizacion_id, lower(btrim(nombre)));

-- ============================================================================
-- Punto de extensión (FR-010): copia la configuración por empresa del origen al
-- destino. Hoy ninguna tabla guarda configuración por empresa (precio, tienda
-- web y Mercado Libre aún no existen), así que no copia nada. Cada épica que
-- agregue una tabla por empresa la suma acá y a su prueba, EXCLUYENDO dominio y
-- cuentas de Mercado Libre. Corre en la transacción de la RPC: si falla, se
-- revierte también el alta.
-- ============================================================================

create or replace function private.copiar_configuracion_empresa(p_origen uuid, p_destino uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Ambas empresas deben existir y ser de la misma organización (defensa en profundidad).
  if not exists (
    select 1
    from dominio.empresas o
    join dominio.empresas d on d.organizacion_id = o.organizacion_id
    where o.id = p_origen and d.id = p_destino
  ) then
    raise exception 'La empresa de origen no pertenece a la misma organización' using errcode = '22023';
  end if;

  -- Sin tablas de configuración por empresa todavía (FR-010): nada que copiar.
  null;
end;
$$;

revoke execute on function private.copiar_configuracion_empresa(uuid, uuid) from public, anon, authenticated;

-- ============================================================================
-- RPC: único camino de alta. La organización la resuelve el servidor
-- (private.organizacion_id()), nunca el llamador; private.puede_escribir()
-- exige administrador ACTIVO (excluye suspendidos).
-- Errores: 42501 sin permiso; 22023 nombre vacío u origen inválido/ajeno;
-- 23505 nombre repetido en la organización (la interfaz lo muestra en el campo).
-- ============================================================================

create or replace function public.crear_empresa(p_nombre text, p_copiar_de uuid default null)
returns dominio.empresas
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion_id uuid := (select private.organizacion_id());
  v_nombre text := btrim(coalesce(p_nombre, ''));
  v_fila dominio.empresas;
begin
  if v_organizacion_id is null or not (select private.puede_escribir()) then
    raise exception 'Solo un administrador puede crear empresas' using errcode = '42501';
  end if;

  if v_nombre = '' then
    raise exception 'El nombre de la empresa es obligatorio' using errcode = '22023';
  end if;
  if char_length(v_nombre) > 120 then
    raise exception 'El nombre no puede superar los 120 caracteres' using errcode = '22023';
  end if;

  if p_copiar_de is not null and not exists (
    select 1 from dominio.empresas e
    where e.id = p_copiar_de and e.organizacion_id = v_organizacion_id
  ) then
    raise exception 'La empresa de origen no es válida' using errcode = '22023';
  end if;

  begin
    insert into dominio.empresas (organizacion_id, nombre)
    values (v_organizacion_id, v_nombre)
    returning * into v_fila;
  exception when unique_violation then
    raise exception 'Ya existe una empresa con ese nombre' using errcode = '23505';
  end;

  if p_copiar_de is not null then
    perform private.copiar_configuracion_empresa(p_copiar_de, v_fila.id);
  end if;

  return v_fila;
end;
$$;

comment on function public.crear_empresa(text, uuid) is
  'F-EMP-03: el administrador activo crea una empresa en SU organización, opcionalmente copiando la configuración de otra de la misma organización (atómico). Único camino de alta.';

revoke execute on function public.crear_empresa(text, uuid) from public, anon;
grant execute on function public.crear_empresa(text, uuid) to authenticated;
