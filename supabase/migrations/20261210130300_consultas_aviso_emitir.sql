-- MSF-562 · [Deuda MSF-189] T017 · FR-012: el aviso de consulta nueva pasa por private.emitir_aviso.
--
-- Esquema (Principio VII): no crea ni altera tablas. Reemplaza la función del disparador
-- `consultas_encolar_aviso` (dominio.consultas, existente), extiende `private.emitir_aviso` con un
-- alcance opcional por empresa y agrega el ayudante `private.empresas_accesibles_de_usuario`. No
-- toca RLS ni privilegios de tablas.
--
-- Antes: el disparador encolaba una fila en dominio.consultas_avisos y la Edge Function
-- `enviar-aviso-consulta` (barrida por el flow `avisos-consultas`) mandaba el correo directo, sin
-- preferencias ni agrupación. Ahora: el disparador llama a
-- private.emitir_aviso('consulta_nueva', organizacion, datos, empresa); el flow `enviar-avisos`
-- envía el correo respetando preferencia y agrupación (15 min).
--
-- * `emitir_aviso` acepta `p_empresa` opcional (por defecto null = toda la organización) y, cuando
--   viene, exige que el destinatario acceda a esa empresa (`private.empresas_accesibles_de_usuario`).
--   Así una persona con la sección `consultas` pero sin la empresa no recibe los datos personales
--   del visitante (Principios I y VIII).
-- * Un fallo al emitir NO frena el alta de la consulta (como antes: un fallo de aviso nunca toca la
--   consulta): se registra con RAISE WARNING y la consulta queda guardada.
-- * dominio.consultas_avisos y la función quedan (aditivo): los avisos ya encolados se terminan de
--   enviar por el camino anterior; no se encolan nuevos.
--
-- Reversión (migración posterior): volver a crear private.encolar_aviso_consulta() con el cuerpo de
-- 20261205200100_consultas_avisos.sql (insert en dominio.consultas_avisos ... on conflict do nothing);
-- recrear private.emitir_aviso(text, uuid, jsonb) con el cuerpo de 20261210120400_avisos_agrupacion.sql
-- y drop function private.empresas_accesibles_de_usuario(uuid).

-- Empresas activas a las que accede una persona cualquiera (no la sesión): mismas reglas que
-- private.empresas_accesibles() sin la rama de superadmin, que no tiene membresía y por eso nunca
-- es destinatario. Necesario porque el disparador corre como `security definer` sin `auth.uid()`.
create or replace function private.empresas_accesibles_de_usuario(p_user_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.id
  from dominio.empresas e
  join public.usuarios_organizacion u
    on u.organizacion_id = e.organizacion_id and u.user_id = p_user_id
  where e.activa
    and u.estado = 'activo'
    and (
      u.rol_id = 'administrador'
      or exists (
        select 1 from public.usuarios_empresas ue
        where ue.user_id = u.user_id and ue.empresa_id = e.id
      )
    );
$$;

comment on function private.empresas_accesibles_de_usuario(uuid) is
  'Empresas activas a las que accede una persona (Administrador: las de su organización; resto: las asignadas). Para resolver destinatarios sin sesión, como el disparador de Consultas.';

-- Misma emisión que 20261210120400 con un alcance opcional por empresa.
drop function if exists private.emitir_aviso(text, uuid, jsonb);

create function private.emitir_aviso(
  p_tipo text,
  p_organizacion uuid,
  p_datos jsonb,
  p_empresa uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seccion text;
  v_destinatario uuid;
  v_encolados integer := 0;
  v_grupo uuid;
  v_vence timestamptz;
begin
  select t.seccion into v_seccion from public.tipos_aviso t where t.clave = p_tipo;
  if not found then
    raise exception 'Tipo de aviso desconocido' using errcode = '22023';
  end if;

  -- Nunca se amplía el alcance por error: una empresa de otra organización no emite.
  if p_empresa is not null and not exists (
    select 1 from dominio.empresas e
    where e.id = p_empresa and e.organizacion_id = p_organizacion
  ) then
    raise exception 'La empresa no pertenece a la organización' using errcode = '22023';
  end if;

  for v_destinatario in
    select u.user_id
    from public.usuarios_organizacion u
    join auth.users a on a.id = u.user_id
    where u.organizacion_id = p_organizacion
      and u.estado = 'activo'
      and btrim(coalesce(a.email, '')) <> ''
      and private.nivel_seccion_de_usuario(u.user_id, v_seccion) <> 'ninguno'
      and (
        p_empresa is null
        or exists (
          select 1 from private.empresas_accesibles_de_usuario(u.user_id) ea(id)
          where ea.id = p_empresa
        )
      )
      and coalesce(
        (select p.activo from public.preferencias_aviso p
          where p.user_id = u.user_id and p.tipo_aviso = p_tipo),
        true
      )
  loop
    -- Evita que dos emisiones simultáneas abran dos grupos para lo mismo.
    perform pg_advisory_xact_lock(hashtextextended(v_destinatario::text || ':' || p_tipo, 0));

    v_grupo := null;
    select a.grupo_id, a.ventana_vence_en into v_grupo, v_vence
    from public.avisos_pendientes a
    where a.user_id = v_destinatario
      and a.tipo_aviso = p_tipo
      and a.organizacion_id = p_organizacion
      and a.estado = 'pendiente'
      and a.ventana_vence_en > now()
    order by a.ventana_vence_en desc
    limit 1;

    if v_grupo is null then
      v_grupo := gen_random_uuid();
      v_vence := now() + (select private.ventana_agrupacion_aviso());
    end if;

    insert into public.avisos_pendientes
      (organizacion_id, user_id, tipo_aviso, grupo_id, datos, ventana_vence_en, creado_en)
    values
      -- clock_timestamp(): el orden de llegada del detalle no se pierde entre avisos de una misma transacción.
      (p_organizacion, v_destinatario, p_tipo, v_grupo, coalesce(p_datos, '{}'::jsonb), v_vence, clock_timestamp());
    v_encolados := v_encolados + 1;
  end loop;

  return v_encolados;
end;
$$;

comment on function private.emitir_aviso(text, uuid, jsonb, uuid) is
  'Encola un aviso para cada destinatario con acceso a la sección del tipo y preferencia encendida, agrupando por destinatario + tipo en la ventana de private.ventana_agrupacion_aviso(). Con p_empresa, solo destinatarios con acceso a esa empresa. Devuelve la cantidad de destinatarios. Solo para funciones security definer de otros componentes.';

revoke execute on function
  private.ventana_agrupacion_aviso(),
  private.empresas_accesibles_de_usuario(uuid),
  private.emitir_aviso(text, uuid, jsonb, uuid)
  from public, anon, authenticated;

create or replace function private.encolar_aviso_consulta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa text;
  v_producto text;
begin
  select e.nombre into v_empresa
  from dominio.empresas e
  where e.id = new.empresa_id and e.organizacion_id = new.organizacion_id;

  if new.producto_id is not null then
    select p.nombre into v_producto
    from dominio.productos p
    where p.id = new.producto_id and p.organizacion_id = new.organizacion_id;
  end if;

  begin
    perform private.emitir_aviso(
      'consulta_nueva',
      new.organizacion_id,
      jsonb_strip_nulls(jsonb_build_object(
        'Empresa', v_empresa,
        'Origen', case new.origen when 'whatsapp' then 'WhatsApp' else 'Formulario de contacto' end,
        'Nombre', new.nombre,
        'Contacto', new.contacto,
        'Producto', v_producto,
        'Mensaje', left(nullif(btrim(coalesce(new.mensaje, '')), ''), 300)
      )),
      new.empresa_id
    );
  exception when others then
    raise warning 'No se pudo emitir el aviso de la consulta %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

comment on function private.encolar_aviso_consulta() is
  'MSF-562 (FR-012): al crearse una consulta emite el aviso consulta_nueva con private.emitir_aviso (respeta preferencias y agrupación). Un fallo se registra y no frena el alta.';

revoke execute on function private.encolar_aviso_consulta() from public, anon, authenticated;
