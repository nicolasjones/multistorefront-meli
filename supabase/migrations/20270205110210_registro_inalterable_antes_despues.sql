-- MSF-259 · F-AUD-02 (épica MSF-170, spec 20261102-100000-auditoria-avanzada-y-soporte,
-- FR-001…FR-006): registro de actividad inalterable, con valor anterior y nuevo.
--
-- Esquema (Principio VII), verificado objeto por objeto — todo es plataforma / transversal:
--   public.tipos_evento_actividad  NUEVA  → `public` (catálogo transversal, no es una entidad de negocio).
--   public.registro_actividad      ALTERA → `public` (agrega valor_anterior / valor_nuevo; triggers de inalterabilidad).
-- No se crea ni se altera nada en `dominio`.
--
-- RLS: `tipos_evento_actividad` tiene RLS (select para `authenticated`, nada para `anon`, sin escritura desde la app:
-- solo migraciones). `registro_actividad` conserva su RLS por organización y `nivel_seccion('actividad')`; no se agregan
-- policies de escritura.
--
-- Migración aditiva: columnas nullable, tabla nueva y funciones nuevas o reemplazadas con la misma firma
-- (`insertar_actividad`, `guardar_matriz_permisos`, `restablecer_matriz_permisos`, trigger de membresía).
--
-- Reversión (en una migración posterior, no en el mismo PR; los eventos ya escritos se conservan):
--   drop trigger registro_actividad_inalterable_fila on public.registro_actividad;
--   drop trigger registro_actividad_inalterable_truncate on public.registro_actividad;
--   drop function private.bloquear_alteracion_actividad();
--   restaurar insertar_actividad de 20261016120000_registro_actividad.sql, guardar_matriz_permisos de
--     20261020130100_rol_tecnico.sql, restablecer_matriz_permisos y registrar_actividad_membresia de
--     20261016120000_registro_actividad.sql;
--   drop function public.obtener_detalle_actividad(uuid);
--   drop function private.registrar_cambio_actividad(text, text, jsonb, jsonb, uuid);
--   drop function private.insertar_cambio_actividad(uuid, uuid, text, text, jsonb, jsonb, uuid);
--   drop function private.instantanea_matriz(uuid); drop function private.diferencia_valores(jsonb, jsonb);
--   alter table public.registro_actividad drop column valor_anterior, drop column valor_nuevo;  (pierde los valores)
--   drop table public.tipos_evento_actividad;
--   grant update, delete, truncate sobre registro_actividad solo si hiciera falta (no hace falta: nunca se concedieron).

-- ============================================================================
-- Catálogo de tipos de evento (FR-001)
-- ============================================================================

create table public.tipos_evento_actividad (
  tipo text primary key check (tipo ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$' and length(tipo) <= 60),
  sensible boolean not null default false,
  descripcion text
);

comment on table public.tipos_evento_actividad is
  'Catálogo global de tipos de evento del historial (F-AUD-02). `sensible` exige guardar valor anterior y nuevo. Un tipo ausente se trata como no sensible. Solo se edita por migración.';

alter table public.tipos_evento_actividad enable row level security;

create policy tipos_evento_actividad_select on public.tipos_evento_actividad
  for select to authenticated
  using (true);

revoke all on public.tipos_evento_actividad from public, anon, authenticated;
grant select on public.tipos_evento_actividad to authenticated;

insert into public.tipos_evento_actividad (tipo, sensible, descripcion) values
  ('usuario.rol_cambiado', true, 'Cambio del rol de una persona'),
  ('usuario.removido', true, 'Persona quitada de la organización'),
  ('usuario.suspendido', true, 'Persona suspendida'),
  ('usuario.reactivado', true, 'Persona reactivada'),
  ('permisos.matriz_guardada', true, 'Cambios en la matriz de permisos'),
  ('permisos.matriz_restablecida', true, 'Matriz de permisos restablecida a los valores iniciales'),
  ('usuario.agregado', false, 'Persona sumada a la organización'),
  ('usuario.empresa_activa_cambiada', false, 'Cambio de la empresa activa'),
  ('usuario.empresas_asignadas', false, 'Empresas asignadas a una persona'),
  ('invitacion.enviada', false, 'Invitación enviada'),
  ('invitacion.reenviada', false, 'Invitación reenviada'),
  ('invitacion.cancelada', false, 'Invitación cancelada'),
  ('empresa.actualizada', false, 'Empresa actualizada'),
  ('empresa.pausada', false, 'Empresa pausada'),
  ('empresa.reactivada', false, 'Empresa reactivada'),
  ('cliente.creado', false, 'Cliente creado'),
  ('cliente.editado', false, 'Cliente editado'),
  ('cliente.archivado', false, 'Cliente archivado'),
  ('cliente.restaurado', false, 'Cliente restaurado'),
  ('comprobante.estado_cambiado', false, 'Cambio de estado de un comprobante'),
  ('ingreso.registrado', false, 'Ingreso de mercadería registrado'),
  ('ingreso.anulado', false, 'Ingreso de mercadería anulado'),
  ('stock.deposito_creado', false, 'Depósito creado'),
  ('stock.deposito_editado', false, 'Depósito editado'),
  ('stock.deposito_defecto', false, 'Depósito por defecto cambiado'),
  ('campana_correo.baja', false, 'Baja de una campaña de correo'),
  ('sistema.depurada', false, 'Depuración por retención del historial');

-- ============================================================================
-- Valores anterior y nuevo (FR-002)
-- ============================================================================

alter table public.registro_actividad
  add column if not exists valor_anterior jsonb,
  add column if not exists valor_nuevo jsonb;

alter table public.registro_actividad
  add constraint registro_actividad_valores_check check (
    (valor_anterior is null or (jsonb_typeof(valor_anterior) = 'object' and octet_length(valor_anterior::text) <= 8192))
    and (valor_nuevo is null or (jsonb_typeof(valor_nuevo) = 'object' and octet_length(valor_nuevo::text) <= 8192))
  );

comment on column public.registro_actividad.valor_anterior is
  'Objeto {campo: valor} antes del cambio (hasta 8 KB). Obligatorio en los tipos sensibles; null en los demás y en los eventos anteriores a F-AUD-02.';
comment on column public.registro_actividad.valor_nuevo is
  'Objeto {campo: valor} después del cambio (hasta 8 KB). Obligatorio en los tipos sensibles.';

-- ============================================================================
-- Registro con antes y después (FR-003)
-- ============================================================================

-- Escritura interna con valores. Organización y actor llegan por parámetro (los fija quien llama, desde el
-- servidor). Nunca expuesta a la API ni a `anon`.
create or replace function private.insertar_cambio_actividad(
  p_organizacion_id uuid,
  p_actor_id uuid,
  p_tipo text,
  p_detalle text,
  p_valor_anterior jsonb,
  p_valor_nuevo jsonb,
  p_empresa_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_detalle text := btrim(coalesce(p_detalle, ''));
  v_sensible boolean;
  v_nombre text;
  v_id uuid;
begin
  if p_organizacion_id is null then
    raise exception 'La actividad necesita una organización' using errcode = '22023';
  end if;
  if p_tipo is null or p_tipo !~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$' or length(p_tipo) > 60 then
    raise exception 'Tipo de actividad inválido: use el formato entidad.accion' using errcode = '22023';
  end if;
  if v_detalle = '' then
    raise exception 'El detalle de la actividad no puede estar vacío' using errcode = '22023';
  end if;
  if length(v_detalle) > 500 then
    v_detalle := left(v_detalle, 499) || '…';
  end if;

  select coalesce((select t.sensible from public.tipos_evento_actividad t where t.tipo = p_tipo), false)
    into v_sensible;

  if (p_valor_anterior is not null and jsonb_typeof(p_valor_anterior) <> 'object')
     or (p_valor_nuevo is not null and jsonb_typeof(p_valor_nuevo) <> 'object') then
    raise exception 'Los valores anterior y nuevo deben ser objetos' using errcode = '22023';
  end if;
  if v_sensible and (p_valor_anterior is null or p_valor_nuevo is null) then
    raise exception 'El evento % es sensible: exige valor anterior y valor nuevo', p_tipo using errcode = '22023';
  end if;
  if octet_length(coalesce(p_valor_anterior::text, '')) > 8192 or octet_length(coalesce(p_valor_nuevo::text, '')) > 8192 then
    raise exception 'El valor anterior o el nuevo supera los 8 KB' using errcode = '22023';
  end if;

  if p_empresa_id is not null and not exists (
    select 1 from dominio.empresas e
    where e.id = p_empresa_id and e.organizacion_id = p_organizacion_id
  ) then
    raise exception 'La empresa no pertenece a la organización' using errcode = '22023';
  end if;

  if p_actor_id is not null then
    select coalesce(nullif(btrim(concat_ws(' ', p.nombre, p.apellido)), ''), u.email::text)
      into v_nombre
      from auth.users u
      left join public.perfiles_usuario p on p.user_id = u.id
      where u.id = p_actor_id;
  end if;

  insert into public.registro_actividad (organizacion_id, empresa_id, actor_id, actor_nombre, tipo, detalle, valor_anterior, valor_nuevo)
  values (p_organizacion_id, p_empresa_id, p_actor_id, v_nombre, p_tipo, v_detalle, p_valor_anterior, p_valor_nuevo)
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function private.insertar_cambio_actividad(uuid, uuid, text, text, jsonb, jsonb, uuid) from public, anon, authenticated;

comment on function private.insertar_cambio_actividad(uuid, uuid, text, text, jsonb, jsonb, uuid) is
  'Inserta un evento con valor anterior y nuevo (F-AUD-02, FR-003). Los tipos sensibles exigen ambos objetos jsonb (alta: anterior {}; baja: nuevo {}); 22023 si faltan o superan 8 KB.';

-- Contrato para los demás componentes: organización y actor salen de la sesión.
create or replace function private.registrar_cambio_actividad(
  p_tipo text,
  p_detalle text,
  p_valor_anterior jsonb,
  p_valor_nuevo jsonb,
  p_empresa_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
begin
  if v_organizacion is null or v_actor is null then
    raise exception 'Se necesita una sesión con organización para registrar actividad' using errcode = '42501';
  end if;
  return private.insertar_cambio_actividad(v_organizacion, v_actor, p_tipo, p_detalle, p_valor_anterior, p_valor_nuevo, p_empresa_id);
end;
$$;

revoke execute on function private.registrar_cambio_actividad(text, text, jsonb, jsonb, uuid) from public, anon, authenticated;

comment on function private.registrar_cambio_actividad(text, text, jsonb, jsonb, uuid) is
  'Registra un cambio con valor anterior y nuevo con la organización y el actor de la sesión (F-AUD-02, FR-003). Se invoca desde RPC security definer, en la misma transacción que la operación.';

-- Misma firma que F-AUD-01: ahora rechaza los tipos sensibles (deben usar insertar_cambio_actividad).
create or replace function private.insertar_actividad(
  p_organizacion_id uuid,
  p_actor_id uuid,
  p_tipo text,
  p_detalle text,
  p_empresa_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.tipos_evento_actividad t where t.tipo = p_tipo and t.sensible) then
    raise exception 'El evento % es sensible: registrelo con valor anterior y nuevo (registrar_cambio_actividad)', p_tipo
      using errcode = '22023';
  end if;
  return private.insertar_cambio_actividad(p_organizacion_id, p_actor_id, p_tipo, p_detalle, null, null, p_empresa_id);
end;
$$;

-- `registrar_actividad(text, text, uuid)` delega en `insertar_actividad`: hereda el rechazo sin cambios.

-- ============================================================================
-- Inalterabilidad (FR-004)
-- ============================================================================

-- Rechaza update, delete y truncate para cualquier rol (incluido el dueño). Única excepción: el borrado en cascada
-- al eliminar la organización — cuando se dispara, la organización ya no existe. Security definer: la lectura de
-- `organizaciones` no depende de la RLS de quien ejecuta.
create or replace function private.bloquear_alteracion_actividad()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.organizaciones o where o.id = old.organizacion_id) then
      return old;
    end if;
  end if;
  raise exception 'El registro de actividad es inalterable: no se puede % ', lower(tg_op) using errcode = '42501';
end;
$$;

revoke execute on function private.bloquear_alteracion_actividad() from public, anon, authenticated;

create trigger registro_actividad_inalterable_fila
  before update or delete on public.registro_actividad
  for each row execute function private.bloquear_alteracion_actividad();

create trigger registro_actividad_inalterable_truncate
  before truncate on public.registro_actividad
  for each statement execute function private.bloquear_alteracion_actividad();

revoke update, delete, truncate on public.registro_actividad from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
    revoke update, delete, truncate on public.registro_actividad from service_role;
  end if;
end;
$$;

-- ============================================================================
-- Detalle de un evento (FR-006). Security invoker: rige la RLS de la tabla.
-- ============================================================================

create or replace function public.obtener_detalle_actividad(p_id uuid)
returns table (
  id uuid,
  creado_en timestamptz,
  tipo text,
  empresa_id uuid,
  empresa_nombre text,
  actor_id uuid,
  actor_nombre text,
  detalle text,
  sensible boolean,
  valor_anterior jsonb,
  valor_nuevo jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.id, r.creado_en, r.tipo, r.empresa_id, e.nombre, r.actor_id, r.actor_nombre, r.detalle,
    coalesce((select t.sensible from public.tipos_evento_actividad t where t.tipo = r.tipo), false),
    r.valor_anterior, r.valor_nuevo
  from public.registro_actividad r
  left join dominio.empresas e on e.id = r.empresa_id
  where r.id = p_id
    and r.organizacion_id = (select private.organizacion_id());
$$;

comment on function public.obtener_detalle_actividad(uuid) is
  'Detalle de un evento del historial con valor anterior y nuevo (F-AUD-02, FR-006). Security invoker: la RLS de registro_actividad decide; 0 filas si no es de la organización o sin permiso.';

revoke execute on function public.obtener_detalle_actividad(uuid) from public, anon;
grant execute on function public.obtener_detalle_actividad(uuid) to authenticated;

-- ============================================================================
-- Antes y después de la matriz de permisos (FR-005)
-- ============================================================================

-- Foto de la matriz de la organización: {"Rol · sección": nivel, "Rol · sección · acción": permitido}.
create or replace function private.instantanea_matriz(p_organizacion_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((
      select jsonb_object_agg(format('%s · %s', private.etiqueta_rol(p.rol_id), p.seccion), p.nivel)
      from public.permisos_rol p where p.organizacion_id = p_organizacion_id
    ), '{}'::jsonb)
    || coalesce((
      select jsonb_object_agg(format('%s · %s · %s', private.etiqueta_rol(a.rol_id), a.seccion, a.accion), a.permitido)
      from public.permisos_rol_accion a where a.organizacion_id = p_organizacion_id
    ), '{}'::jsonb);
$$;

revoke execute on function private.instantanea_matriz(uuid) from public, anon, authenticated;

-- Solo las claves cuyo valor cambió. Acota el tamaño (< 8 KB por valor): si hay demasiados cambios, el resto se
-- resume en «otros cambios».
create or replace function private.diferencia_valores(p_antes jsonb, p_despues jsonb, out anterior jsonb, out nuevo jsonb)
language plpgsql
immutable
set search_path = ''
as $$
declare
  k record;
  v_omitidos integer := 0;
begin
  anterior := '{}'::jsonb;
  nuevo := '{}'::jsonb;
  for k in
    select coalesce(a.key, d.key) as clave, a.value as valor_antes, d.value as valor_despues
    from jsonb_each(coalesce(p_antes, '{}'::jsonb)) a
    full join jsonb_each(coalesce(p_despues, '{}'::jsonb)) d on d.key = a.key
    where a.value is distinct from d.value
    order by 1
  loop
    if octet_length(anterior::text) + octet_length(nuevo::text)
       + octet_length(coalesce(k.valor_antes::text, '')) + octet_length(coalesce(k.valor_despues::text, ''))
       + 2 * octet_length(k.clave) < 6000 then
      if k.valor_antes is not null then anterior := anterior || jsonb_build_object(k.clave, k.valor_antes); end if;
      if k.valor_despues is not null then nuevo := nuevo || jsonb_build_object(k.clave, k.valor_despues); end if;
    else
      v_omitidos := v_omitidos + 1;
    end if;
  end loop;
  if v_omitidos > 0 then
    anterior := anterior || jsonb_build_object('… otros cambios', 'sin detalle');
    nuevo := nuevo || jsonb_build_object('… otros cambios', v_omitidos);
  end if;
end;
$$;

revoke execute on function private.diferencia_valores(jsonb, jsonb) from public, anon, authenticated;

-- Trigger de membresía: los eventos de Acceso sensibles guardan antes y después (los demás, igual que antes).
create or replace function private.registrar_actividad_membresia()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_persona text;
  v_tipo text;
  v_detalle text;
  v_antes jsonb := null;
  v_despues jsonb := null;
begin
  select coalesce(
      nullif(btrim(concat_ws(' ', p.nombre, p.apellido)), ''),
      new.target_email,
      u.email::text,
      'una persona'
    )
    into v_persona
    from (select 1) uno
    left join auth.users u on u.id = new.target_user_id
    left join public.perfiles_usuario p on p.user_id = new.target_user_id;

  case new.accion
    when 'invitacion_enviada' then
      v_tipo := 'invitacion.enviada';
      v_detalle := format('Invitó a %s con el rol %s', v_persona, private.etiqueta_rol(new.rol_nuevo));
    when 'invitacion_reenviada' then
      v_tipo := 'invitacion.reenviada';
      v_detalle := format('Reenvió la invitación a %s', v_persona);
    when 'invitacion_cancelada' then
      v_tipo := 'invitacion.cancelada';
      v_detalle := format('Canceló la invitación a %s', v_persona);
    when 'miembro_agregado' then
      v_tipo := 'usuario.agregado';
      v_detalle := format('%s se sumó con el rol %s', v_persona, private.etiqueta_rol(new.rol_nuevo));
    when 'rol_cambiado' then
      v_tipo := 'usuario.rol_cambiado';
      v_detalle := format('Cambió el rol de %s: %s → %s', v_persona, private.etiqueta_rol(new.rol_anterior), private.etiqueta_rol(new.rol_nuevo));
      v_antes := jsonb_build_object('rol', private.etiqueta_rol(new.rol_anterior));
      v_despues := jsonb_build_object('rol', private.etiqueta_rol(new.rol_nuevo));
    when 'miembro_removido' then
      v_tipo := 'usuario.removido';
      v_detalle := format('Quitó a %s de la organización', v_persona);
      v_antes := jsonb_build_object('rol', private.etiqueta_rol(coalesce(new.rol_anterior, new.rol_nuevo)), 'estado', 'Miembro');
      v_despues := '{}'::jsonb;
    when 'suspendido' then
      v_tipo := 'usuario.suspendido';
      v_detalle := format('Suspendió a %s', v_persona);
      v_antes := jsonb_build_object('estado', 'Activo');
      v_despues := jsonb_build_object('estado', 'Suspendido');
    when 'reactivado' then
      v_tipo := 'usuario.reactivado';
      v_detalle := format('Reactivó a %s', v_persona);
      v_antes := jsonb_build_object('estado', 'Suspendido');
      v_despues := jsonb_build_object('estado', 'Activo');
    else
      return new;
  end case;

  perform private.insertar_cambio_actividad(new.organizacion_id, new.actor_user_id, v_tipo, v_detalle, v_antes, v_despues, null);
  return new;
end;
$$;

revoke execute on function private.registrar_actividad_membresia() from public, anon, authenticated;

-- ============================================================================
-- Matriz de permisos (FR-005). Mismo cuerpo que 20261020130100 (con el rechazo del Técnico); solo cambia el cierre:
-- guarda la foto de lo que cambió, antes y después.
-- ============================================================================

create or replace function public.guardar_matriz_permisos(p_niveles jsonb default '[]', p_acciones jsonb default '[]')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_cambio jsonb;
  v_antes jsonb;
  v_cambios record;
begin
  if v_org is null or not (select private.puede_escribir()) then
    raise exception 'Solo un Administrador de la organización puede editar la matriz de permisos' using errcode = '42501';
  end if;

  if jsonb_typeof(p_niveles) is distinct from 'array' or jsonb_typeof(p_acciones) is distinct from 'array' then
    raise exception 'Los cambios deben ser listas' using errcode = '22023';
  end if;

  -- Tope de tamaño (hay 6×16 niveles y 6×16×3 acciones editables): evita que un envío
  -- enorme ocupe el lock y la CPU de la organización.
  if jsonb_array_length(p_niveles) > 200 or jsonb_array_length(p_acciones) > 400 then
    raise exception 'Demasiados cambios en un solo guardado' using errcode = '22023';
  end if;

  -- Un guardado concurrente o un restablecer en curso (borra y resiembra) no deben
  -- verse como filas «desconocidas»: se serializan por organización.
  perform pg_advisory_xact_lock(hashtextextended('matriz_permisos:' || v_org::text, 0));
  v_antes := private.instantanea_matriz(v_org);

  for v_cambio in select * from jsonb_array_elements(p_niveles) loop
    if jsonb_typeof(v_cambio) is distinct from 'object'
       or jsonb_typeof(v_cambio -> 'rol_id') is distinct from 'string'
       or jsonb_typeof(v_cambio -> 'seccion') is distinct from 'string' then
      raise exception 'Cada cambio de nivel debe ser un objeto con rol_id y seccion' using errcode = '22023';
    end if;
    -- FR-003: el Administrador no se restringe (además lo impide un check en la tabla).
    if v_cambio ->> 'rol_id' = 'administrador' then
      raise exception 'El rol Administrador no se puede restringir' using errcode = '22023';
    end if;
    if v_cambio ->> 'rol_id' = 'miembro' then
      raise exception 'El rol miembro (template) no se edita desde la matriz' using errcode = '22023';
    end if;
    if v_cambio ->> 'rol_id' = 'tecnico' then
      raise exception 'El rol Técnico tiene una matriz fija y no se edita desde la matriz' using errcode = '22023';
    end if;
    if jsonb_typeof(v_cambio -> 'nivel') is distinct from 'string'
       or v_cambio ->> 'nivel' not in ('edicion', 'lectura', 'ninguno') then
      raise exception 'Nivel inválido: %', v_cambio ->> 'nivel' using errcode = '22023';
    end if;
    -- Solo se actualizan filas existentes (sembradas): rol o sección desconocidos fallan.
    update public.permisos_rol
       set nivel = v_cambio ->> 'nivel'
     where organizacion_id = v_org
       and rol_id = v_cambio ->> 'rol_id'
       and seccion = v_cambio ->> 'seccion';
    if not found then
      raise exception 'Rol o sección desconocidos: % / %', v_cambio ->> 'rol_id', v_cambio ->> 'seccion' using errcode = '22023';
    end if;
  end loop;

  for v_cambio in select * from jsonb_array_elements(p_acciones) loop
    if jsonb_typeof(v_cambio) is distinct from 'object'
       or jsonb_typeof(v_cambio -> 'rol_id') is distinct from 'string'
       or jsonb_typeof(v_cambio -> 'seccion') is distinct from 'string'
       or jsonb_typeof(v_cambio -> 'accion') is distinct from 'string' then
      raise exception 'Cada cambio de acción debe ser un objeto con rol_id, seccion y accion' using errcode = '22023';
    end if;
    if v_cambio ->> 'rol_id' = 'administrador' then
      raise exception 'El rol Administrador no se puede restringir' using errcode = '22023';
    end if;
    if v_cambio ->> 'rol_id' = 'miembro' then
      raise exception 'El rol miembro (template) no se edita desde la matriz' using errcode = '22023';
    end if;
    if v_cambio ->> 'rol_id' = 'tecnico' then
      raise exception 'El rol Técnico tiene una matriz fija y no se edita desde la matriz' using errcode = '22023';
    end if;
    if jsonb_typeof(v_cambio -> 'permitido') is distinct from 'boolean' then
      raise exception 'permitido debe ser booleano' using errcode = '22023';
    end if;
    update public.permisos_rol_accion
       set permitido = (v_cambio ->> 'permitido')::boolean
     where organizacion_id = v_org
       and rol_id = v_cambio ->> 'rol_id'
       and seccion = v_cambio ->> 'seccion'
       and accion = v_cambio ->> 'accion';
    if not found then
      raise exception 'Rol, sección o acción desconocidos: % / % / %',
        v_cambio ->> 'rol_id', v_cambio ->> 'seccion', v_cambio ->> 'accion' using errcode = '22023';
    end if;
  end loop;

  -- Trazabilidad inalterable (F-AUD-02, FR-005): solo lo que cambió, antes y después.
  select * into v_cambios from private.diferencia_valores(v_antes, private.instantanea_matriz(v_org));
  perform private.registrar_cambio_actividad(
    'permisos.matriz_guardada',
    format('Guardó cambios en la matriz de permisos (%s niveles, %s acciones)', jsonb_array_length(p_niveles), jsonb_array_length(p_acciones)),
    v_cambios.anterior,
    v_cambios.nuevo
  );
end;
$$;

comment on function public.guardar_matriz_permisos(jsonb, jsonb) is
  'Guarda cambios de la matriz de permisos de la organización actual (F-ROL-02, FR-013). Solo Administrador; todo o nada; el Administrador no es restringible y el Técnico (matriz fija, MSF-182) ni miembro se editan. Registra antes y después (F-AUD-02).';

revoke all on function public.guardar_matriz_permisos(jsonb, jsonb) from public, anon;
grant execute on function public.guardar_matriz_permisos(jsonb, jsonb) to authenticated;

create or replace function public.restablecer_matriz_permisos()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_antes jsonb;
  v_cambios record;
begin
  if v_org is null or not (select private.puede_escribir()) then
    raise exception 'Solo un Administrador de la organización puede restablecer la matriz de permisos' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('matriz_permisos:' || v_org::text, 0));

  v_antes := private.instantanea_matriz(v_org);

  delete from public.permisos_rol_accion where organizacion_id = v_org;
  delete from public.permisos_rol where organizacion_id = v_org;
  perform private.sembrar_permisos(v_org);

  select * into v_cambios from private.diferencia_valores(v_antes, private.instantanea_matriz(v_org));
  perform private.registrar_cambio_actividad(
    'permisos.matriz_restablecida',
    'Restableció la matriz de permisos a los valores iniciales',
    v_cambios.anterior,
    v_cambios.nuevo
  );
end;
$$;

comment on function public.restablecer_matriz_permisos() is
  'Restablece la matriz de la organización actual a los valores iniciales (F-ROL-02, FR-015). Solo Administrador. Registra antes y después (F-AUD-02).';

revoke all on function public.restablecer_matriz_permisos() from public, anon;
grant execute on function public.restablecer_matriz_permisos() to authenticated;
