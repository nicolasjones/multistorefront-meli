-- F-TDA-16 (MSF-437, épica MSF-212, spec 20261202-100000-tienda-whatsapp-y-contacto): contacto con formulario
-- de la tienda pública. FR-001…FR-006, FR-014, FR-060, FR-061.
--
-- Esquemas (Principio VII, re-verificado tabla por tabla):
--   * dominio.tienda_envios (tabla nueva)  -> `dominio`: dato del producto Tiendas online atado a una empresa
--     (registro de envíos de visitantes de su tienda: límite e idempotencia). RLS por organización, solo
--     `select` para `authenticated`; sin ningún privilegio para `anon`. Escribe solo
--     private.registrar_envio_tienda (SECURITY DEFINER).
--   * dominio.empresas.horarios (columna nueva, nullable) -> `dominio`: la tabla ya es de dominio y tiene RLS.
--   * publico.contacto_por_dominio / publico.enviar_consulta_contacto -> `publico` (solo funciones, sin tablas).
--   * private.visitante_hash / limite_envios_tienda / registrar_envio_tienda / validar_contacto_tienda /
--     entregar_a_bandeja -> `private` (lógica interna, sin acceso de API).
--
-- Interfaz de entrada de Consultas (MSF-122, F-CON-01): publico.crear_consulta_publica(host, origen, nombre,
-- contacto, mensaje, producto_id) -> uuid (migración 20261205100100). `private.entregar_a_bandeja` es el ÚNICO
-- punto que la conoce: recibe la empresa y resuelve su dominio en dominio.tiendas.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function publico.enviar_consulta_contacto(text, text, text, text, uuid);
--   drop function publico.contacto_por_dominio(text);
--   drop function private.entregar_a_bandeja(uuid, text, text, text, text, uuid);
--   drop function private.registrar_envio_tienda(uuid, text, uuid);
--   drop function private.validar_contacto_tienda(text, text, text);
--   drop function private.visitante_hash(uuid);
--   drop function private.limite_envios_tienda();
--   drop table dominio.tienda_envios;
--   alter table dominio.empresas drop column horarios;

-- FR-014 · horarios de atención de la empresa (D2).
alter table dominio.empresas
  add column horarios text,
  add constraint empresas_horarios_largo check (horarios is null or length(horarios) <= 200);

grant update (horarios) on dominio.empresas to authenticated;

comment on column dominio.empresas.horarios is
  'F-TDA-16 (D2): horarios de atención que muestra la tienda pública en Contacto. Nullable, máx. 200.';

-- FR-002 · registro mínimo de envíos para el límite y la idempotencia.
create table dominio.tienda_envios (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  empresa_id uuid not null references dominio.empresas (id) on delete cascade,
  visitante text not null,
  clave_envio uuid not null,
  origen text not null check (origen in ('formulario', 'whatsapp')),
  creado_en timestamptz not null default now(),
  constraint tienda_envios_clave_unica unique (empresa_id, clave_envio)
);

create index if not exists tienda_envios_visitante_idx on dominio.tienda_envios (empresa_id, visitante, creado_en);
create index if not exists tienda_envios_organizacion_idx on dominio.tienda_envios (organizacion_id);

comment on table dominio.tienda_envios is
  'F-TDA-16: envíos de visitantes de la tienda pública (formulario y WhatsApp) para el límite por hora y la idempotencia. El visitante es un hash, nunca la IP. Sin privilegios para anon; escribe solo private.registrar_envio_tienda.';

alter table dominio.tienda_envios enable row level security;

create policy tienda_envios_select on dominio.tienda_envios
  for select to authenticated
  using (organizacion_id = private.organizacion_id());

revoke all on dominio.tienda_envios from public, anon, authenticated;
grant select on dominio.tienda_envios to authenticated;

-- FR-003 · constante única del límite (5 por hora por visitante y empresa; se ajusta con pruebas reales).
create or replace function private.limite_envios_tienda()
returns integer
language sql
immutable
set search_path = ''
as $$ select 5; $$;

revoke execute on function private.limite_envios_tienda() from public, anon, authenticated;

-- D6 · el visitante es el hash de la IP del cliente (según private.saltos_proxy_confiables, F-TDA-15) y la
-- empresa. Sin cabecera `x-forwarded-for` todos caen en un único cupo «sin-ip»: falla cerrada, no abierta.
create or replace function private.visitante_hash(p_empresa uuid)
returns text
language sql
stable
set search_path = ''
as $$
  with cadena as (
    select regexp_split_to_array(
             trim(coalesce(
               (coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb ->> 'x-forwarded-for'),
               '')),
             '[[:space:]]*,[[:space:]]*') as ips
  )
  select encode(
           sha256(convert_to(
             coalesce(
               nullif(ips[greatest(1, coalesce(array_length(ips, 1), 0) - private.saltos_proxy_confiables())], ''),
               'sin-ip')
             || '|' || coalesce(p_empresa::text, ''),
             'UTF8')),
           'hex')
  from cadena;
$$;

comment on function private.visitante_hash(uuid) is
  'F-TDA-16 (D6): sha256 de la IP del cliente + empresa; sin cabecera, cupo único «sin-ip». Nunca devuelve ni guarda la IP.';

revoke execute on function private.visitante_hash(uuid) from public, anon, authenticated;

-- FR-003 / FR-004 · límite atómico e idempotencia. Devuelve {estado: nuevo|repetido|limite, espera_segundos?}.
create or replace function private.registrar_envio_tienda(p_empresa uuid, p_origen text, p_clave uuid)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_org uuid;
  v_visitante text := private.visitante_hash(p_empresa);
  v_cantidad integer;
  v_mas_antiguo timestamptz;
begin
  select e.organizacion_id into v_org from dominio.empresas e where e.id = p_empresa;
  if v_org is null then
    raise exception 'Empresa inexistente' using errcode = 'P0002';
  end if;

  -- Un lock por (empresa, visitante): dos envíos simultáneos no superan el cupo.
  perform pg_advisory_xact_lock(hashtextextended(p_empresa::text || '|' || v_visitante, 0));

  -- Poda de lo viejo (más de 24 h) sin worker ni cron.
  delete from dominio.tienda_envios
   where empresa_id = p_empresa and creado_en < now() - interval '24 hours';

  if exists (select 1 from dominio.tienda_envios where empresa_id = p_empresa and clave_envio = p_clave) then
    return jsonb_build_object('estado', 'repetido');
  end if;

  select count(*), min(creado_en) into v_cantidad, v_mas_antiguo
    from dominio.tienda_envios
   where empresa_id = p_empresa and visitante = v_visitante and creado_en > now() - interval '1 hour';

  if v_cantidad >= private.limite_envios_tienda() then
    return jsonb_build_object(
      'estado', 'limite',
      'espera_segundos', greatest(1, ceil(extract(epoch from (v_mas_antiguo + interval '1 hour' - now())))::integer));
  end if;

  insert into dominio.tienda_envios (organizacion_id, empresa_id, visitante, clave_envio, origen)
  values (v_org, p_empresa, v_visitante, p_clave, p_origen);
  return jsonb_build_object('estado', 'nuevo');
end;
$$;

comment on function private.registrar_envio_tienda(uuid, text, uuid) is
  'F-TDA-16: registra un envío del visitante con lock por (empresa, visitante), poda > 24 h, idempotencia por clave y tope por hora. Sin acceso para roles de API.';

revoke execute on function private.registrar_envio_tienda(uuid, text, uuid) from public, anon, authenticated;

-- FR-005 · ÚNICO adaptador hacia la interfaz de entrada de MSF-122. Una falla propaga la excepción.
create or replace function private.entregar_a_bandeja(
  p_empresa uuid,
  p_origen text,
  p_nombre text,
  p_contacto text,
  p_mensaje text,
  p_producto uuid
)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_host text;
begin
  select t.dominio into v_host from dominio.tiendas t where t.empresa_id = p_empresa order by t.dominio limit 1;
  if v_host is null then
    raise exception 'La empresa no tiene dominio' using errcode = 'P0002';
  end if;
  perform publico.crear_consulta_publica(v_host, p_origen, p_nombre, p_contacto, p_mensaje, p_producto);
end;
$$;

comment on function private.entregar_a_bandeja(uuid, text, text, text, text, uuid) is
  'F-TDA-16 (D4): único adaptador hacia publico.crear_consulta_publica (F-CON-01, MSF-122). Si esa firma cambia, solo cambia esta función.';

revoke execute on function private.entregar_a_bandeja(uuid, text, text, text, text, uuid) from public, anon, authenticated;

-- FR-008 · reglas por campo (espejo de apps/web/.../contacto/validacion.ts). Devuelve los campos inválidos.
-- El teléfono admite 8 a 15 dígitos para que la bandeja (F-CON-01: 7 a 15) nunca lo rechace.
create or replace function private.validar_contacto_tienda(p_nombre text, p_contacto text, p_mensaje text)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_nombre text := btrim(coalesce(p_nombre, ''));
  v_contacto text := btrim(coalesce(p_contacto, ''));
  v_mensaje text := btrim(coalesce(p_mensaje, ''));
  v_campos text[] := '{}';
begin
  if v_nombre = '' or length(v_nombre) > 100 then
    v_campos := array_append(v_campos, 'nombre');
  end if;
  if v_contacto = '' or length(v_contacto) > 120
     or not (
       v_contacto ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$'
       or (v_contacto ~ '^\+?[0-9 ()-]+$'
           and length(regexp_replace(v_contacto, '[^0-9]', '', 'g')) between 8 and 15)
     ) then
    v_campos := array_append(v_campos, 'contacto');
  end if;
  if v_mensaje = '' or length(v_mensaje) > 2000 then
    v_campos := array_append(v_campos, 'mensaje');
  end if;
  return v_campos;
end;
$$;

revoke execute on function private.validar_contacto_tienda(text, text, text) from public, anon, authenticated;

-- FR-001 · lectura anónima de los datos de contacto. Lista blanca; `null` idéntico para host desconocido y
-- empresa desactivada; campos vacíos como null.
create or replace function publico.contacto_por_dominio(host text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'nombre', e.nombre,
           'whatsapp', nullif(btrim(e.whatsapp), ''),
           'correo', nullif(btrim(e.correo), ''),
           'horarios', nullif(btrim(e.horarios), ''))
    from dominio.tiendas t
    join dominio.empresas e on e.id = t.empresa_id and e.organizacion_id = t.organizacion_id
   where t.dominio = private.normalizar_host(host) and e.activa;
$$;

comment on function publico.contacto_por_dominio(text) is
  'F-TDA-16: {nombre, whatsapp, correo, horarios} de la empresa del dominio; null si el host es desconocido o la empresa está desactivada.';

revoke execute on function publico.contacto_por_dominio(text) from public, anon;
grant execute on function publico.contacto_por_dominio(text) to anon, authenticated;

-- FR-006 · envío del formulario: valida, aplica límite e idempotencia y entrega a la bandeja.
-- Respuestas: ok | invalido (campos) | limite (espera_segundos) | error (genérico, sin detalles).
create or replace function publico.enviar_consulta_contacto(
  host text,
  nombre text,
  contacto text,
  mensaje text,
  clave_envio uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_empresa uuid;
  v_campos text[];
  v_registro jsonb;
begin
  select e.id into v_empresa
    from dominio.tiendas t
    join dominio.empresas e on e.id = t.empresa_id and e.organizacion_id = t.organizacion_id
   where t.dominio = private.normalizar_host(host) and e.activa;
  if v_empresa is null or clave_envio is null then
    return jsonb_build_object('estado', 'error');
  end if;

  v_campos := private.validar_contacto_tienda(nombre, contacto, mensaje);
  if cardinality(v_campos) > 0 then
    return jsonb_build_object('estado', 'invalido', 'campos', to_jsonb(v_campos));
  end if;

  -- Sub-transacción: si la entrega falla se revierte también el registro del envío (no se gasta cupo).
  begin
    v_registro := private.registrar_envio_tienda(v_empresa, 'formulario', clave_envio);
    if v_registro ->> 'estado' = 'limite' then
      return jsonb_build_object('estado', 'limite', 'espera_segundos', (v_registro ->> 'espera_segundos')::integer);
    end if;
    if v_registro ->> 'estado' = 'nuevo' then
      perform private.entregar_a_bandeja(v_empresa, 'formulario', btrim(nombre), btrim(contacto), btrim(mensaje), null);
    end if;
  exception when others then
    -- Rastro en el servidor (log de Postgres); al cliente solo llega el estado genérico.
    raise warning 'enviar_consulta_contacto falló: % %', sqlstate, sqlerrm;
    return jsonb_build_object('estado', 'error');
  end;
  return jsonb_build_object('estado', 'ok');
end;
$$;

comment on function publico.enviar_consulta_contacto(text, text, text, text, uuid) is
  'F-TDA-16: alta pública de una consulta de contacto. La empresa sale del host; ok|invalido|limite|error sin datos internos.';

revoke execute on function publico.enviar_consulta_contacto(text, text, text, text, uuid) from public, anon;
grant execute on function publico.enviar_consulta_contacto(text, text, text, text, uuid) to anon, authenticated;
