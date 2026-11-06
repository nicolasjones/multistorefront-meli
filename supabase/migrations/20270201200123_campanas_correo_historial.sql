-- F-CLI-13 (MSF-376, épica MSF-155, spec 20261028-100000-correo-masivo-a-clientes): historial de campañas de correo.
-- FR-032 (estado derivado), FR-033 (bajas atribuidas a la campaña del enlace), FR-034 (solo lectura), SC-005.
--
-- Esquemas (Principio VII), verificado: no se crea ninguna tabla. Las funciones viven en `public` (plataforma: las llama
-- la app) y leen `dominio.campanas_correo` y `dominio.campana_correo_destinatarios` (dominio, 20270121110000) y, para el
-- nombre del autor, `public.perfiles_usuario`. Se agrega una columna a una tabla existente de `dominio`:
--   dominio.campana_correo_destinatarios.baja_en  momento en que el cliente usó el enlace de baja de ESTA campaña.
-- Sin ella la baja no podía atribuirse (FR-033): `token_hashes` no se expone y la baja solo apagaba la aceptación.
-- Las bajas anteriores a esta migración no tienen campaña atribuida (no se guardaba): quedan fuera de la cuenta.
--
-- Permiso: acceso `lectura` o `edicion` a la sección `clientes`, validado dentro de la función (FR-034). Son
-- `security definer` solo para leer el nombre del autor (`perfiles_usuario` es self-only); la organización sale de la
-- sesión, nunca de un parámetro, y nunca se devuelven `token_hashes`, `reclamado_hasta` ni el cuerpo de las pruebas.
-- `revoke … public, anon` / `grant … authenticated` explícitos. No hay función de escritura: no se edita, borra ni reenvía.
--
-- Empresa activa (Principio VIII): `p_empresa` muestra solo las campañas armadas con esa tienda; las armadas para
-- «todas» aparecen solo cuando no se filtra (null).
--
-- Aditiva. Reversión (migración posterior):
--   drop function public.detalle_campana_correo(uuid, integer, integer);
--   drop function public.listar_campanas_correo(uuid, integer, integer);
--   restaurar public.dar_de_baja_correo_masivo(text) de 20270121110200 y luego
--   alter table dominio.campana_correo_destinatarios drop column baja_en;

alter table dominio.campana_correo_destinatarios add column if not exists baja_en timestamptz;

comment on column dominio.campana_correo_destinatarios.baja_en is
  'F-CLI-13 (FR-033): cuándo el cliente se dio de baja con el enlace de esta campaña. Null = no usó el enlace.';

-- Igual que 20270121110200 más la atribución de la baja a la campaña del enlace usado (idempotente: no pisa baja_en).
create or replace function public.dar_de_baja_correo_masivo(p_token_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_cliente uuid;
  v_estaba boolean;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  select d.organizacion_id, d.cliente_id into v_org, v_cliente
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

  update public.clientes c set acepta_correo_masivo = false
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
  'F-CLI-12/13 (FR-019, FR-022, FR-033, SC-004): baja del correo masivo por el hash SHA-256 (hex) del token del enlace. Apaga acepta_correo_masivo, omite los pendientes, atribuye la baja a la campaña del enlace y registra actividad sin datos personales. Idempotente. Solo service_role (Edge Function baja-correo-masivo).';

revoke execute on function public.dar_de_baja_correo_masivo(text) from public, anon, authenticated;
grant execute on function public.dar_de_baja_correo_masivo(text) to service_role;

-- Totales por campaña. `pendientes` completa la suma: destinatarios = enviados + fallidos + omitidos + pendientes (SC-005).
create or replace function public.listar_campanas_correo(
  p_empresa uuid default null,
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
  v_pagina integer := greatest(coalesce(p_pagina, 1), 1);
  v_tamano integer := least(greatest(coalesce(p_tamano, 25), 1), 100);
  v_total integer;
  v_filas jsonb;
begin
  if v_org is null or (select auth.uid()) is null then
    raise exception 'Necesitás una sesión con organización para ver el historial' using errcode = '42501';
  end if;
  if (select private.nivel_seccion('clientes')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver el historial del correo masivo' using errcode = '42501';
  end if;

  select count(*) into v_total
    from dominio.campanas_correo c
   where c.organizacion_id = v_org and (p_empresa is null or c.empresa_id = p_empresa);

  select coalesce(jsonb_agg(f.fila order by f.creada_en desc, f.id), '[]'::jsonb) into v_filas
    from (
      select pg.creada_en, pg.id,
             jsonb_build_object(
               'id', pg.id,
               'creada_en', pg.creada_en,
               'asunto', pg.asunto,
               'autor', pg.autor,
               'estado', case when pg.pendientes > 0 then 'en_curso' else 'completada' end,
               'destinatarios', pg.destinatarios,
               'enviados', pg.enviados,
               'fallidos', pg.fallidos,
               'omitidos', pg.omitidos,
               'pendientes', pg.pendientes,
               'bajas', pg.bajas) as fila
        from (
          select c.id, c.creada_en, c.asunto,
                 coalesce(nullif(btrim(concat_ws(' ', p.nombre, p.apellido)), ''), 'Usuario sin nombre') as autor,
                 count(d.id) as destinatarios,
                 count(d.id) filter (where d.estado = 'enviado') as enviados,
                 count(d.id) filter (where d.estado = 'fallido') as fallidos,
                 count(d.id) filter (where d.estado = 'omitido') as omitidos,
                 count(d.id) filter (where d.estado = 'pendiente') as pendientes,
                 count(d.id) filter (where d.baja_en is not null) as bajas
            from dominio.campanas_correo c
            left join public.perfiles_usuario p on p.user_id = c.creada_por
            left join dominio.campana_correo_destinatarios d on d.campana_id = c.id and d.organizacion_id = c.organizacion_id
           where c.organizacion_id = v_org and (p_empresa is null or c.empresa_id = p_empresa)
           group by c.id, c.creada_en, c.asunto, p.nombre, p.apellido
           order by c.creada_en desc, c.id
           limit v_tamano offset (v_pagina - 1) * v_tamano
        ) pg
    ) f;

  return jsonb_build_object('total', v_total, 'filas', v_filas);
end;
$$;

comment on function public.listar_campanas_correo(uuid, integer, integer) is
  'F-CLI-13 (FR-030, FR-032, FR-034, SC-005): campañas de la organización de la sesión (más reciente primero) con estado derivado y totales. Solo lectura; exige lectura o edición en clientes. Contrato: contracts/correo-masivo.md.';

create or replace function public.detalle_campana_correo(
  p_campana uuid,
  p_pagina integer default 1,
  p_tamano integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_pagina integer := greatest(coalesce(p_pagina, 1), 1);
  v_tamano integer := least(greatest(coalesce(p_tamano, 50), 1), 100);
  v_campana jsonb;
  v_total integer;
  v_destinatarios jsonb;
begin
  if v_org is null or (select auth.uid()) is null then
    raise exception 'Necesitás una sesión con organización para ver el historial' using errcode = '42501';
  end if;
  if (select private.nivel_seccion('clientes')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver el historial del correo masivo' using errcode = '42501';
  end if;

  select jsonb_build_object(
           'id', c.id,
           'asunto', c.asunto,
           'mensaje', c.mensaje,
           'estado', case when t.pendientes > 0 then 'en_curso' else 'completada' end,
           'creada_en', c.creada_en,
           'empresa_id', c.empresa_id,
           'autor', coalesce(nullif(btrim(concat_ws(' ', p.nombre, p.apellido)), ''), 'Usuario sin nombre'),
           'destinatarios', t.destinatarios,
           'enviados', t.enviados,
           'fallidos', t.fallidos,
           'omitidos', t.omitidos,
           'pendientes', t.pendientes,
           'bajas', t.bajas)
    into v_campana
    from dominio.campanas_correo c
    left join public.perfiles_usuario p on p.user_id = c.creada_por
    cross join lateral (
      select count(*) as destinatarios,
             count(*) filter (where d.estado = 'enviado') as enviados,
             count(*) filter (where d.estado = 'fallido') as fallidos,
             count(*) filter (where d.estado = 'omitido') as omitidos,
             count(*) filter (where d.estado = 'pendiente') as pendientes,
             count(*) filter (where d.baja_en is not null) as bajas
        from dominio.campana_correo_destinatarios d
       where d.campana_id = c.id and d.organizacion_id = c.organizacion_id
    ) t
   where c.id = p_campana and c.organizacion_id = v_org;
  if v_campana is null then
    raise exception 'La campaña no existe' using errcode = 'P0002';
  end if;

  select count(*) into v_total
    from dominio.campana_correo_destinatarios d
   where d.campana_id = p_campana and d.organizacion_id = v_org;

  select coalesce(jsonb_agg(x.fila order by x.nombre, x.cliente_id), '[]'::jsonb) into v_destinatarios
    from (
      select coalesce(cl.nombre, '(cliente no disponible)') as nombre, d.cliente_id,
             jsonb_build_object(
               'cliente_id', d.cliente_id,
               'nombre', coalesce(cl.nombre, '(cliente no disponible)'),
               'correo', d.correo,
               'estado', d.estado,
               'error', d.error,
               'baja', d.baja_en is not null) as fila
        from dominio.campana_correo_destinatarios d
        left join public.clientes cl on cl.id = d.cliente_id and cl.organizacion_id = d.organizacion_id
       where d.campana_id = p_campana and d.organizacion_id = v_org
       order by 1, d.cliente_id
       limit v_tamano offset (v_pagina - 1) * v_tamano
    ) x;

  return jsonb_build_object('campana', v_campana, 'total', v_total, 'destinatarios', v_destinatarios);
end;
$$;

comment on function public.detalle_campana_correo(uuid, integer, integer) is
  'F-CLI-13 (FR-031, FR-033, FR-034): asunto, mensaje, totales y destinatarios (cliente, correo usado, estado, error corto, baja) de una campaña de la organización de la sesión. Solo lectura. Contrato: contracts/correo-masivo.md.';

revoke execute on function public.listar_campanas_correo(uuid, integer, integer) from public, anon;
grant execute on function public.listar_campanas_correo(uuid, integer, integer) to authenticated;
revoke execute on function public.detalle_campana_correo(uuid, integer, integer) from public, anon;
grant execute on function public.detalle_campana_correo(uuid, integer, integer) to authenticated;
