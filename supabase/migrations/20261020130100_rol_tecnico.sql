-- F-SVC-05 · Permisos de Service técnico y rol Técnico (épica MSF-182, spec
-- 20261020-100000-service-alta-estados-y-permisos, FR-040…FR-042, SC-006).
--
-- Esquemas (Principio VII, re-verificado): mecanismo de acceso transversal →
-- solo DATOS en `public` (roles_organizacion, permisos_rol, permisos_rol_accion)
-- y funciones en `private`/`public`. No se crea ni altera ninguna tabla.
--
-- Matriz del Técnico (Decisiones abiertas 2, confirmada 2026-10-19):
--   service_tecnico = edicion; inicio, clientes, productos, stock = lectura;
--   el resto = ninguno. Acciones: sin eliminar, exportar ni ver_costos
--   (private.matriz_acciones_iniciales() ya lo deriva de matriz_inicial(): solo
--   concede por rol a administrador / operador / administracion, así que el
--   Técnico queda en false sin redefinirla).
-- Ningún nivel de los roles existentes cambia (la matriz solo agrega filas).
--
-- Migración aditiva. Camino de reversión (no se ejecuta; solo válido mientras
-- ningún usuarios_organizacion / usuarios_empresas / invitación use `tecnico`):
--   delete from public.permisos_rol_accion where rol_id = 'tecnico';
--   delete from public.permisos_rol where rol_id = 'tecnico';
--   delete from public.roles_organizacion where id = 'tecnico';
--   -- volver a private.matriz_inicial() y public.guardar_matriz_permisos(jsonb, jsonb)
--   -- tal como los dejan 20261013130002 y 20261016120000.

-- ============================================================================
-- Rol (FR-040)
-- ============================================================================

insert into public.roles_organizacion (id, descripcion) values
  ('tecnico', 'Opera Service técnico: reparaciones, modelos y estados.')
on conflict (id) do nothing;

-- ============================================================================
-- Matriz inicial con `tecnico` (mismos valores que 20261013130002 + columna nueva)
-- ============================================================================

create or replace function private.matriz_inicial()
returns table (rol_id text, seccion text, nivel text)
language sql
immutable
set search_path = ''
as $$
  select r.rol, v.seccion,
    case r.c when 'E' then 'edicion' when 'L' then 'lectura' else 'ninguno' end
  from (values
    ('inicio',            'E','E','L','L','L','L','L','L'),
    ('productos',         'E','E','L','L','L','L','L','L'),
    ('categorias',        'E','E','L','N','N','N','L','N'),
    ('stock',             'E','E','L','L','E','L','L','L'),
    ('cotizacion_dolar',  'E','L','L','L','N','E','L','N'),
    ('empresas',          'E','N','N','N','N','N','N','N'),
    ('mercado_libre',     'E','N','N','N','N','N','N','N'),
    ('rentabilidad',      'E','N','N','N','N','L','N','N'),
    ('usuarios_permisos', 'E','N','N','N','N','N','N','N'),
    ('actividad',         'E','L','N','N','N','L','N','N'),
    ('consultas',         'E','E','L','N','N','L','L','N'),
    ('ventas',            'E','E','L','E','L','E','L','N'),
    ('clientes',          'E','E','L','E','N','E','L','L'),
    ('proveedores',       'E','N','N','N','N','E','N','N'),
    ('reportes',          'E','N','N','N','N','E','N','N'),
    ('service_tecnico',   'E','E','L','L','N','L','L','E')
  ) as v(seccion, administrador, operador, consulta, mostrador, deposito, administracion, miembro, tecnico)
  cross join lateral (values
    ('administrador', v.administrador), ('operador', v.operador), ('consulta', v.consulta),
    ('mostrador', v.mostrador), ('deposito', v.deposito), ('administracion', v.administracion),
    ('miembro', v.miembro), ('tecnico', v.tecnico)
  ) as r(rol, c);
$$;

comment on function private.matriz_inicial() is
  'Matriz inicial rol × sección → nivel (Roles.dc.html + rol Técnico de MSF-182). Fuente única para sembrar permisos_rol y para el valor por omisión cuando falta una fila (nunca acceso total).';

revoke execute on function private.matriz_inicial() from public, anon, authenticated;

-- ============================================================================
-- Backfill (FR-040): organizaciones existentes. El trigger de organización
-- nueva ya llama a private.sembrar_permisos, que lee la matriz redefinida.
-- `on conflict do nothing` de la siembra: no pisa filas editadas de otros roles.
-- ============================================================================

select private.sembrar_permisos(id) from public.organizaciones;

-- ============================================================================
-- Matriz fija del Técnico (FR-041/FR-042): el servidor rechaza editarla.
-- Mismo cuerpo que 20261016120000; solo se agrega el rechazo de `tecnico`.
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

  -- Trazabilidad (Principio III, F-AUD-01): quién y cuántos cambios.
  perform private.registrar_actividad(
    'permisos.matriz_guardada',
    format('Guardó cambios en la matriz de permisos (%s niveles, %s acciones)', jsonb_array_length(p_niveles), jsonb_array_length(p_acciones))
  );
end;
$$;

comment on function public.guardar_matriz_permisos(jsonb, jsonb) is
  'Guarda cambios de la matriz de permisos de la organización actual (F-ROL-02, FR-013). Solo Administrador; todo o nada; el Administrador no es restringible y el Técnico (matriz fija, MSF-182) ni miembro se editan.';

revoke all on function public.guardar_matriz_permisos(jsonb, jsonb) from public, anon;
grant execute on function public.guardar_matriz_permisos(jsonb, jsonb) to authenticated;
