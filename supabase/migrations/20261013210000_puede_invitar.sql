-- F-USR-01 (MSF-211): puerta previa de la Edge Function `invitar-miembro` tras la devolución del PR #34.
-- La función resuelve la cuenta de Auth (service-role) ANTES de `registrar_invitacion`; sin una verificación
-- de rol previa, cualquier usuario autenticado podía disparar ese barrido y distinguir el 409 (cuenta existente)
-- del 403 (FR-009: no revelar si el correo tiene cuenta). `puede_invitar()` devuelve la organización de trabajo
-- de quien llama solo si puede gestionar membresías; si no, 42501. No crea tablas (sin impacto de esquema/RLS).
-- Reversión: drop function public.puede_invitar();

create or replace function public.puede_invitar()
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_org uuid;
begin
  select private.organizacion_id() into v_org;
  if v_org is null or not private.puede_gestionar_membresias(v_org) then
    raise exception 'No puede gestionar usuarios de esta organización' using errcode = '42501';
  end if;
  return v_org;
end;
$$;
revoke execute on function public.puede_invitar() from public, anon;
grant execute on function public.puede_invitar() to authenticated;
