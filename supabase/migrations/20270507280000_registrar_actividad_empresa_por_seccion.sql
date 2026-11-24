-- Lote 44 (menor del lote 42): `public.registrar_actividad` exigía `private.puede_escribir()` (administrador), pero desde
-- `20270507240000` la política `empresas_update` exige `nivel_seccion('empresas') = 'edicion'`. Un rol personalizado con
-- Empresas en edición podía pausar/reactivar o editar la empresa (la RLS lo deja) y el evento de Actividad (`empresa.*`) se
-- perdía: el RPC lo rechazaba con 42501 y el frontend, que registra la actividad como mejor esfuerzo (`emitirEventoActividad`
-- atrapa el error y deja un `console.warn`), no avisaba. Resultado: ediciones sin rastro en el historial.
--
-- Ahora el RPC acepta a quien puede escribir O tiene la sección Empresas en edición, la misma condición que la RLS de update
-- (el comentario original de la función ya decía «la misma condición que su RLS de update»). Todo lo demás queda igual:
-- lista cerrada de tipos (`empresa.pausada`, `empresa.reactivada`, `empresa.actualizada`), empresa obligatoria y de la
-- organización de la sesión (la valida `private.registrar_actividad`), organización y actor fijados por el servidor,
-- mismos grants. Derivada de la definición vigente (`20261016120000`, la única).
--
-- Migración aditiva (`create or replace`, misma firma). Reversión (migración posterior): volver a crear la función con
-- `if not (select private.puede_escribir()) then` como en `20261016120000`.

create or replace function public.registrar_actividad(
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
  if not (
    (select private.puede_escribir())
    or (select private.nivel_seccion('empresas')) = 'edicion'
  ) then
    raise exception 'Solo quien puede editar la organización o la sección Empresas registra actividad desde la app' using errcode = '42501';
  end if;
  if p_tipo is null or p_tipo not in ('empresa.pausada', 'empresa.reactivada', 'empresa.actualizada') then
    raise exception 'Ese tipo de actividad lo registra solo el servidor' using errcode = '42501';
  end if;
  if p_empresa_id is null then
    raise exception 'El evento de empresa necesita la empresa' using errcode = '22023';
  end if;
  return private.registrar_actividad(p_tipo, p_detalle, p_empresa_id);
end;
$$;

revoke execute on function public.registrar_actividad(text, text, uuid) from public, anon;
grant execute on function public.registrar_actividad(text, text, uuid) to authenticated;

comment on function public.registrar_actividad(text, text, uuid) is
  'Registra actividad desde el frontend (F-AUD-01, FR-002). Organización y actor los fija el servidor; exige private.puede_escribir() o la sección empresas en edición (la misma condición que empresas_update) y acepta solo empresa.pausada, empresa.reactivada y empresa.actualizada.';
