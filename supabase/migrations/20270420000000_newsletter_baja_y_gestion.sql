-- MSF-468 (spec 20270328-100000-newsletter-de-la-tienda), Fase 3 · T013/T018b: baja del suscriptor y gestión de suscriptores.
-- RF-NL-7, RF-NL-8, RF-NL-10, RF-NL-12, RF-NL-24; D3, D6, D14, D17. SIN ningún envío: esta migración prepara las tres tablas del
-- correo masivo (MSF-155) para admitir destinatarios suscriptor y extiende la baja; el motor de envío cambia en la Fase 5.
--
-- Esquemas (Principio VII, verificado objeto por objeto): columnas nuevas en tablas que ya viven en `dominio`
-- (`campanas_correo`, `campana_correo_destinatarios`, `correo_masivo_pruebas`); RPC del panel en `public` (superficie sin datos propios);
-- `private.exigir_admin_newsletter` interna. No hay tablas nuevas: la exportación total no cambia.
--
-- Baja (D3): reutiliza el circuito de MSF-155. El enlace de cada correo lleva un token aleatorio cuyo SHA-256 se guarda en
-- `campana_correo_destinatarios.token_hashes` (lo emite el reclamo de la Fase 5); la Edge Function `baja-correo-masivo` conserva su
-- contrato y llama a `public.dar_de_baja_correo_masivo`, que ahora también resuelve destinatarios suscriptor.
-- Invariante MSF-967: una dirección en `baja` puede volver a `pendiente` por un tercero (conserva `baja_en`); toda lista o conteo de
-- destinatarios filtra `estado = 'confirmado'`, nunca `<> 'baja'`.
--
-- Aditiva e idempotente. Reversión (migración posterior; no en este PR):
--   restaurar `public.dar_de_baja_correo_masivo(text)` de 20270201200123;
--   drop function public.borrar_datos_suscriptor_newsletter(uuid), public.dar_de_baja_suscriptor_newsletter(uuid),
--     public.listar_suscriptores_newsletter(uuid, text, text, integer, integer), public.resumen_newsletter(uuid),
--     public.guardar_newsletter_configuracion(uuid, boolean), private.exigir_admin_newsletter(uuid);
--   alter table dominio.correo_masivo_pruebas drop column bloques, drop column empresa_id;
--   alter table dominio.campana_correo_destinatarios drop column suscriptor_id (tras borrar las filas de suscriptores) y volver `cliente_id` a not null;
--   alter table dominio.campanas_correo drop column tipo, drop column newsletter_id, drop column bloques;
--   delete from public.tipos_evento_actividad where tipo like 'newsletter.%';  -- solo si no quedan eventos

insert into public.tipos_evento_actividad (tipo, sensible, descripcion) values
  ('newsletter.configurar', false, 'Interruptor del newsletter de una tienda cambiado'),
  ('newsletter.baja', false, 'Una persona se dio de baja del newsletter desde el enlace (sin correo)'),
  ('newsletter.baja_manual', false, 'Suscriptor del newsletter dado de baja por un administrador (sin correo)'),
  ('newsletter.datos_borrados', false, 'Datos de un suscriptor del newsletter borrados por un administrador (sin correo)')
on conflict (tipo) do nothing;

-- Columnas nuevas de las tres tablas del correo masivo (D14). Las campañas existentes quedan `clientes`.
alter table dominio.campanas_correo add column if not exists tipo text not null default 'clientes';
alter table dominio.campanas_correo drop constraint if exists campanas_correo_tipo_check;
alter table dominio.campanas_correo add constraint campanas_correo_tipo_check check (tipo in ('clientes', 'newsletter'));
-- FK a `dominio.newsletters` en la Fase 4 (la tabla aún no existe).
alter table dominio.campanas_correo add column if not exists newsletter_id uuid;
-- Foto del contenido (secciones del newsletter); null en las campañas de clientes.
alter table dominio.campanas_correo add column if not exists bloques jsonb;
alter table dominio.campanas_correo drop constraint if exists campanas_correo_bloques_ck;
alter table dominio.campanas_correo add constraint campanas_correo_bloques_ck
  check (bloques is null or (jsonb_typeof(bloques) = 'object' and pg_column_size(bloques) <= 200000));

alter table dominio.campana_correo_destinatarios alter column cliente_id drop not null;
alter table dominio.campana_correo_destinatarios add column if not exists suscriptor_id uuid;
-- Borrar los datos de un suscriptor deja el destinatario sin enlace (`set null (suscriptor_id)`: la organización no se anula).
alter table dominio.campana_correo_destinatarios drop constraint if exists campana_correo_destinatarios_suscriptor_fk;
alter table dominio.campana_correo_destinatarios add constraint campana_correo_destinatarios_suscriptor_fk
  foreign key (suscriptor_id, organizacion_id) references dominio.newsletter_suscriptores (id, organizacion_id) on delete set null (suscriptor_id);
alter table dominio.campana_correo_destinatarios drop constraint if exists campana_correo_destinatarios_uno_ck;
alter table dominio.campana_correo_destinatarios add constraint campana_correo_destinatarios_uno_ck
  check (num_nonnulls(cliente_id, suscriptor_id) <= 1);
create unique index if not exists campana_correo_destinatarios_suscriptor_uq
  on dominio.campana_correo_destinatarios (campana_id, suscriptor_id) where suscriptor_id is not null;
create index if not exists campana_correo_destinatarios_suscriptor_idx
  on dominio.campana_correo_destinatarios (suscriptor_id) where suscriptor_id is not null;

alter table dominio.correo_masivo_pruebas add column if not exists bloques jsonb;
alter table dominio.correo_masivo_pruebas add column if not exists empresa_id uuid;
alter table dominio.correo_masivo_pruebas drop constraint if exists correo_masivo_pruebas_empresa_fk;
alter table dominio.correo_masivo_pruebas add constraint correo_masivo_pruebas_empresa_fk
  foreign key (empresa_id, organizacion_id) references dominio.empresas (id, organizacion_id) on delete cascade;

comment on column dominio.campanas_correo.tipo is 'MSF-468 (D14): `clientes` (correo masivo de MSF-155) o `newsletter`.';
comment on column dominio.campana_correo_destinatarios.suscriptor_id is 'MSF-468 (D14): destinatario suscriptor del newsletter (uno u otro de cliente_id / suscriptor_id; ambos nulos si se borraron sus datos).';

-- Baja desde el enlace (RF-NL-8). Igual que 20270201200123 para clientes; si el destinatario es un suscriptor lo pasa a `baja`,
-- omite sus pendientes y registra `newsletter.baja` solo la primera vez (sin correo). Sigue siendo solo `service_role` y no enumera.
create or replace function public.dar_de_baja_correo_masivo(p_token_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_cliente uuid;
  v_suscriptor uuid;
  v_empresa uuid;
  v_estaba boolean;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  select d.organizacion_id, d.cliente_id, d.suscriptor_id into v_org, v_cliente, v_suscriptor
    from dominio.campana_correo_destinatarios d
   where d.token_hashes @> array[p_token_hash]
   limit 1;
  if not found then
    return false;
  end if;

  -- La baja se atribuye a la(s) campaña(s) cuyo enlace se usó (FR-033).
  update dominio.campana_correo_destinatarios d
     set baja_en = now()
   where d.token_hashes @> array[p_token_hash] and d.baja_en is null;

  if v_suscriptor is not null then
    -- Con el suscriptor bloqueado, dos bajas simultáneas registran el evento una sola vez.
    update dominio.newsletter_suscriptores s
       set estado = 'baja', baja_en = now(), confirmacion_hash = null, confirmacion_vence = null, confirmacion_reclamada_hasta = null
     where s.id = v_suscriptor and s.organizacion_id = v_org and s.estado <> 'baja'
    returning s.empresa_id, true into v_empresa, v_estaba;

    update dominio.campana_correo_destinatarios d
       set estado = 'omitido', reclamado_hasta = null
     where d.suscriptor_id = v_suscriptor and d.organizacion_id = v_org and d.estado = 'pendiente';

    if coalesce(v_estaba, false) then
      perform private.insertar_actividad(v_org, null, 'newsletter.baja', 'Una persona se dio de baja del newsletter desde el enlace', v_empresa);
    end if;
    return true;
  end if;

  update dominio.clientes c set acepta_correo_masivo = false
   where c.id = v_cliente and c.organizacion_id = v_org and c.acepta_correo_masivo
  returning true into v_estaba;

  -- También los pendientes de campañas en curso (SC-004): no reciben nada más.
  update dominio.campana_correo_destinatarios d
     set estado = 'omitido', reclamado_hasta = null
   where d.cliente_id = v_cliente and d.organizacion_id = v_org and d.estado = 'pendiente';

  if coalesce(v_estaba, false) then
    perform private.insertar_actividad(v_org, null, 'campana_correo.baja', 'Un cliente se dio de baja del correo masivo desde el enlace del correo', null);
  end if;
  return true;
end;
$$;

comment on function public.dar_de_baja_correo_masivo(text) is
  'F-CLI-12/13 y MSF-468 (RF-NL-8): baja del correo masivo por el hash SHA-256 del token del enlace. Clientes: apaga acepta_correo_masivo. Suscriptores del newsletter: pasa a baja. Omite pendientes, atribuye la baja a la campaña y registra actividad sin datos personales. Idempotente. Solo service_role.';

revoke execute on function public.dar_de_baja_correo_masivo(text) from public, anon, authenticated;
grant execute on function public.dar_de_baja_correo_masivo(text) to service_role;

-- Permiso del panel (D6): Administrador de la organización con edición en `clientes` y acceso a la tienda. Devuelve la organización.
create or replace function private.exigir_admin_newsletter(p_empresa uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
begin
  if v_org is null or (select auth.uid()) is null
     or not (select private.es_administrador_propio_de(v_org))
     or (select private.nivel_seccion('clientes')) is distinct from 'edicion' then
    raise exception 'Solo un Administrador puede gestionar el newsletter' using errcode = '42501';
  end if;
  -- `p_empresa` nulo: solo se comprueba el rol (para responder P0002 sin filtrar si el suscriptor existe a quien no es Administrador).
  if p_empresa is not null then
    if not exists (select 1 from dominio.empresas e where e.id = p_empresa and e.organizacion_id = v_org) then
      raise exception 'La tienda no existe' using errcode = 'P0002';
    end if;
    if p_empresa not in (select private.empresas_accesibles()) then
      raise exception 'No tenés acceso a esa tienda' using errcode = '42501';
    end if;
  end if;
  return v_org;
end;
$$;

revoke execute on function private.exigir_admin_newsletter(uuid) from public, anon, authenticated;

-- RF-NL-10 · interruptor por tienda. Con la bandera apagada responde 55000.
create or replace function public.guardar_newsletter_configuracion(p_empresa uuid, p_activo boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.exigir_admin_newsletter(p_empresa);
  v_nombre text;
begin
  if p_empresa is null then
    raise exception 'La tienda no existe' using errcode = 'P0002';
  end if;
  if p_activo is null then
    raise exception 'Falta indicar si el newsletter queda activo' using errcode = '22023';
  end if;
  if not private.bandera_activa('newsletter') then
    raise exception 'El newsletter no está habilitado en este entorno' using errcode = '55000';
  end if;
  insert into dominio.newsletter_configuracion (empresa_id, organizacion_id, activo, actualizado_en)
  values (p_empresa, v_org, p_activo, now())
  on conflict (empresa_id) do update set activo = excluded.activo, actualizado_en = now();
  select e.nombre into v_nombre from dominio.empresas e where e.id = p_empresa;
  perform private.insertar_actividad(v_org, (select auth.uid()), 'newsletter.configurar',
    format('%s el newsletter de %s', case when p_activo then 'Activó' else 'Desactivó' end, v_nombre), p_empresa);
  return jsonb_build_object('empresa_id', p_empresa, 'activo', p_activo);
end;
$$;

-- RF-NL-11 · KPI y estado del interruptor de cada tienda accesible. `p_empresa` nulo = todas las accesibles.
-- Solo `confirmado` cuenta como activo (MSF-967).
create or replace function public.resumen_newsletter(p_empresa uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
begin
  if v_org is null or (select private.nivel_seccion('clientes')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver el newsletter' using errcode = '42501';
  end if;
  if p_empresa is not null and p_empresa not in (select private.empresas_accesibles()) then
    raise exception 'No tenés acceso a esa tienda' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'confirmados', (select count(*) from dominio.newsletter_suscriptores s
                     where s.organizacion_id = v_org and s.estado = 'confirmado'
                       and s.empresa_id in (select private.empresas_accesibles())
                       and (p_empresa is null or s.empresa_id = p_empresa)),
    'pendientes', (select count(*) from dominio.newsletter_suscriptores s
                    where s.organizacion_id = v_org and s.estado = 'pendiente'
                      and s.empresa_id in (select private.empresas_accesibles())
                      and (p_empresa is null or s.empresa_id = p_empresa)),
    'bajas', (select count(*) from dominio.newsletter_suscriptores s
               where s.organizacion_id = v_org and s.estado = 'baja'
                 and s.empresa_id in (select private.empresas_accesibles())
                 and (p_empresa is null or s.empresa_id = p_empresa)),
    'bandera', private.bandera_activa('newsletter'),
    'tiendas', coalesce((
      select jsonb_agg(jsonb_build_object('empresa_id', e.id, 'tienda', e.nombre, 'activo', coalesce(c.activo, false)) order by e.nombre, e.id)
        from dominio.empresas e
        left join dominio.newsletter_configuracion c on c.empresa_id = e.id and c.organizacion_id = e.organizacion_id
       where e.organizacion_id = v_org and e.activa and e.id in (select private.empresas_accesibles())
         and (p_empresa is null or e.id = p_empresa)), '[]'::jsonb));
end;
$$;

-- RF-NL-12 · lista de suscriptores por tandas (página desde 1, tamaño ≤ 100). Búsqueda literal por correo (sin comodines).
create or replace function public.listar_suscriptores_newsletter(
  p_empresa uuid default null,
  p_estado text default null,
  p_texto text default null,
  p_pagina integer default 1,
  p_tamano integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_texto text := lower(btrim(coalesce(p_texto, '')));
  v_tamano integer := least(greatest(coalesce(p_tamano, 25), 1), 100);
  v_pagina integer := greatest(coalesce(p_pagina, 1), 1);
begin
  if v_org is null or (select private.nivel_seccion('clientes')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver el newsletter' using errcode = '42501';
  end if;
  if p_estado is not null and p_estado not in ('pendiente', 'confirmado', 'baja') then
    raise exception 'El estado no es válido' using errcode = '22023';
  end if;
  if char_length(v_texto) > 254 then
    raise exception 'La búsqueda admite hasta 254 caracteres' using errcode = '22023';
  end if;
  if p_empresa is not null and p_empresa not in (select private.empresas_accesibles()) then
    raise exception 'No tenés acceso a esa tienda' using errcode = '42501';
  end if;
  return (
    with base as (
      select s.id, s.correo, s.empresa_id, e.nombre as tienda, s.origen, s.creado_en, s.estado
        from dominio.newsletter_suscriptores s
        join dominio.empresas e on e.id = s.empresa_id and e.organizacion_id = s.organizacion_id
       where s.organizacion_id = v_org
         and s.empresa_id in (select private.empresas_accesibles())
         and (p_empresa is null or s.empresa_id = p_empresa)
         and (p_estado is null or s.estado = p_estado)
         and (v_texto = '' or strpos(s.correo, v_texto) > 0)
    )
    select jsonb_build_object(
      'total', (select count(*) from base),
      'filas', coalesce((
        select jsonb_agg(to_jsonb(x) order by x.creado_en desc, x.id)
          from (select * from base order by creado_en desc, id limit v_tamano offset (v_pagina - 1) * v_tamano) x), '[]'::jsonb)));
end;
$$;

-- RF-NL-12 · baja manual (Administrador). Idempotente, funciona con la bandera apagada. Un `pendiente` también pasa a `baja`.
create or replace function public.dar_de_baja_suscriptor_newsletter(p_suscriptor uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_fila dominio.newsletter_suscriptores%rowtype;
begin
  select * into v_fila from dominio.newsletter_suscriptores s where s.id = p_suscriptor and s.organizacion_id = v_org for update;
  if not found then
    perform private.exigir_admin_newsletter(null);
    raise exception 'El suscriptor no existe' using errcode = 'P0002';
  end if;
  perform private.exigir_admin_newsletter(v_fila.empresa_id);
  if v_fila.estado <> 'baja' then
    update dominio.newsletter_suscriptores s
       set estado = 'baja', baja_en = now(), confirmacion_hash = null, confirmacion_vence = null, confirmacion_reclamada_hasta = null
     where s.id = v_fila.id;
    -- Lo pendiente de envíos en curso no sale (CA-NL-2).
    update dominio.campana_correo_destinatarios d
       set estado = 'omitido', reclamado_hasta = null
     where d.suscriptor_id = v_fila.id and d.organizacion_id = v_org and d.estado = 'pendiente';
    perform private.insertar_actividad(v_org, (select auth.uid()), 'newsletter.baja_manual', 'Dio de baja a un suscriptor del newsletter', v_fila.empresa_id);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- RF-NL-12, D17 · «Borrar datos» (supresión): elimina la fila. Siempre disponible, aun con la bandera apagada.
create or replace function public.borrar_datos_suscriptor_newsletter(p_suscriptor uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_fila dominio.newsletter_suscriptores%rowtype;
begin
  select * into v_fila from dominio.newsletter_suscriptores s where s.id = p_suscriptor and s.organizacion_id = v_org for update;
  if not found then
    perform private.exigir_admin_newsletter(null);
    raise exception 'El suscriptor no existe' using errcode = 'P0002';
  end if;
  perform private.exigir_admin_newsletter(v_fila.empresa_id);
  -- Envíos pasados: el correo copiado queda `[eliminado]` y lo pendiente se omite; después la FK suelta `suscriptor_id`.
  update dominio.campana_correo_destinatarios d
     set correo = '[eliminado]',
         estado = case when d.estado = 'pendiente' then 'omitido' else d.estado end,
         reclamado_hasta = null
   where d.suscriptor_id = v_fila.id and d.organizacion_id = v_org;
  delete from dominio.newsletter_suscriptores s where s.id = v_fila.id;
  perform private.insertar_actividad(v_org, (select auth.uid()), 'newsletter.datos_borrados', 'Borró los datos de un suscriptor del newsletter', v_fila.empresa_id);
  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.guardar_newsletter_configuracion(uuid, boolean) is 'MSF-468 (RF-NL-10): interruptor por tienda; Administrador; 55000 con la bandera apagada.';
comment on function public.resumen_newsletter(uuid) is 'MSF-468 (RF-NL-11): confirmados, pendientes, bajas e interruptor por tienda; solo cuenta `confirmado` como activo.';
comment on function public.listar_suscriptores_newsletter(uuid, text, text, integer, integer) is 'MSF-468 (RF-NL-12): suscriptores por tandas con filtro de estado y búsqueda literal.';
comment on function public.dar_de_baja_suscriptor_newsletter(uuid) is 'MSF-468 (RF-NL-12): baja manual, Administrador, idempotente.';
comment on function public.borrar_datos_suscriptor_newsletter(uuid) is 'MSF-468 (RF-NL-12, D17): supresión del suscriptor, Administrador.';

revoke execute on function public.guardar_newsletter_configuracion(uuid, boolean) from public, anon;
revoke execute on function public.resumen_newsletter(uuid) from public, anon;
revoke execute on function public.listar_suscriptores_newsletter(uuid, text, text, integer, integer) from public, anon;
revoke execute on function public.dar_de_baja_suscriptor_newsletter(uuid) from public, anon;
revoke execute on function public.borrar_datos_suscriptor_newsletter(uuid) from public, anon;
grant execute on function public.guardar_newsletter_configuracion(uuid, boolean) to authenticated;
grant execute on function public.resumen_newsletter(uuid) to authenticated;
grant execute on function public.listar_suscriptores_newsletter(uuid, text, text, integer, integer) to authenticated;
grant execute on function public.dar_de_baja_suscriptor_newsletter(uuid) to authenticated;
grant execute on function public.borrar_datos_suscriptor_newsletter(uuid) to authenticated;
