-- F-SVC-03 (MSF-303, épica MSF-182): entrega de una reparación (`registrar_entrega_reparacion`).
-- Esquema: sin tablas nuevas (Principio VII: `dominio.reparaciones` y `dominio.reparacion_historial`).
--
-- SECURITY DEFINER con control explícito (organización, `edicion` en `service_tecnico`, tienda
-- accesible) y bloqueo de la fila. El estado elegido debe ser activo, de la organización y con
-- `cierra = true`. `entrega_real` no puede ser anterior al ingreso ni futura (hora de Argentina) y
-- `entregado_por` es obligatorio (22023 con `hint` del campo). Guarda `entrega_real`/`entregado_por`,
-- cambia el estado y escribe el evento `entrega` en la misma transacción. No admite anuladas ni ya
-- cerradas (55000). Si el estado actual ya era el elegido no hay nada que cerrar: igual se rechaza
-- como ya cerrada, porque una reparación cerrada no se vuelve a entregar.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.registrar_entrega_reparacion(uuid, uuid, date, text);

create or replace function public.registrar_entrega_reparacion(
  p_id uuid,
  p_estado_id uuid,
  p_entrega_real date,
  p_entregado_por text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_actual dominio.reparaciones;
  v_cierra_actual boolean;
  v_nuevo dominio.estados_reparacion;
  v_quien text := btrim(coalesce(p_entregado_por, ''));
begin
  if v_org is null or (select auth.uid()) is null
     or (select private.nivel_seccion('service_tecnico')) <> 'edicion' then
    raise exception 'Tu rol no puede registrar entregas' using errcode = '42501';
  end if;

  select * into v_actual
    from dominio.reparaciones r
   where r.id = p_id and r.organizacion_id = v_org
   for update;
  if not found then
    raise exception 'La reparación no existe' using errcode = 'P0002';
  end if;
  if not exists (select 1 from private.empresas_accesibles() a(id) where a.id = v_actual.empresa_id) then
    raise exception 'No tenés acceso a la tienda de esta reparación' using errcode = '42501';
  end if;
  if v_actual.anulada_en is not null then
    raise exception 'La reparación está anulada y no se puede modificar' using errcode = '55000';
  end if;
  select s.cierra into v_cierra_actual
    from dominio.estados_reparacion s
   where s.id = v_actual.estado_id and s.organizacion_id = v_org;
  if v_actual.entrega_real is not null or coalesce(v_cierra_actual, false) then
    raise exception 'La reparación ya fue entregada o cerrada' using errcode = '55000';
  end if;

  if p_estado_id is null then
    raise exception 'Elegí el estado' using errcode = '22023', hint = 'estado_id';
  end if;
  select * into v_nuevo
    from dominio.estados_reparacion s
   where s.id = p_estado_id and s.organizacion_id = v_org;
  if not found or not v_nuevo.activo then
    raise exception 'El estado no existe o está desactivado' using errcode = '22023', hint = 'estado_id';
  end if;
  if not v_nuevo.cierra then
    raise exception 'Ese estado no cierra la reparación' using errcode = '22023', hint = 'estado_id';
  end if;
  if p_entrega_real is null then
    raise exception 'Ingresá la fecha de entrega' using errcode = '22023', hint = 'entrega_real';
  end if;
  if p_entrega_real < v_actual.ingreso_en then
    raise exception 'La entrega no puede ser anterior al ingreso' using errcode = '22023', hint = 'entrega_real';
  end if;
  if p_entrega_real > v_hoy then
    raise exception 'La entrega no puede ser una fecha futura' using errcode = '22023', hint = 'entrega_real';
  end if;
  if v_quien = '' then
    raise exception 'Indicá quién retira o recibe el equipo' using errcode = '22023', hint = 'entregado_por';
  end if;
  if length(v_quien) > 200 then
    raise exception 'Máximo 200 caracteres' using errcode = '22023', hint = 'entregado_por';
  end if;

  update dominio.reparaciones
     set estado_id = v_nuevo.id, entrega_real = p_entrega_real, entregado_por = v_quien
   where id = p_id;

  insert into dominio.reparacion_historial (organizacion_id, reparacion_id, tipo, estado_anterior_id, estado_nuevo_id, nota, usuario_id, creado_en)
  values (v_org, p_id, 'entrega', v_actual.estado_id, v_nuevo.id, left('Entregó: ' || v_quien, 500), (select auth.uid()), clock_timestamp());

  return private.reparacion_json(p_id);
end;
$$;

comment on function public.registrar_entrega_reparacion(uuid, uuid, date, text) is
  'F-SVC-03: entrega con estado que cierra, fecha (no anterior al ingreso ni futura) y quién entregó; cambia el estado en la misma transacción. Solo con edición en Service técnico.';

revoke execute on function public.registrar_entrega_reparacion(uuid, uuid, date, text) from public, anon;
grant execute on function public.registrar_entrega_reparacion(uuid, uuid, date, text) to authenticated;
