-- Nombre visible entre miembros de una organización (spec 010). Reversión:
-- drop function public.listar_miembros_organizacion(); — no toca tablas,
-- columnas ni policies existentes (aditiva).

-- ============================================================================
-- RPC: listar_miembros_organizacion (usada por apps/web/.../miembros/list.tsx)
-- ============================================================================
-- Security definer porque perfiles_usuario_select_titular (spec 008) es
-- self-only: sin esto, un administrador no podría leer nombre/apellido de
-- sus compañeros. El chequeo de private.puede_gestionar_membresias() vive
-- ACÁ DENTRO, no solo en accessControlProvider.ts del frontend — al ser
-- security definer con grant execute a authenticated, cualquier persona
-- autenticada podría invocar la RPC directo sin pasar por la pantalla; sin
-- este chequeo interno, un miembro raso podría leer nombre/apellido de sus
-- compañeros aunque no administre membresías (contracts/listar-miembros-organizacion.md).
create or replace function public.listar_miembros_organizacion()
returns table (
  user_id uuid,
  rol_id text,
  created_at timestamptz,
  nombre text,
  apellido text
)
language sql
stable
security definer
set search_path = ''
as $$
  with v as (select private.organizacion_id() as organizacion_id)
  select u.user_id, u.rol_id, u.created_at, p.nombre, p.apellido
  from v
  join public.usuarios_organizacion u on u.organizacion_id = v.organizacion_id
  left join public.perfiles_usuario p on p.user_id = u.user_id
  where v.organizacion_id is not null
    and private.puede_gestionar_membresias(v.organizacion_id);
$$;

comment on function public.listar_miembros_organizacion() is
  'Contrato: specs/010-nombre-miembros-organizacion/contracts/listar-miembros-organizacion.md. Left join obligatorio a perfiles_usuario (FR-004): una persona sin perfil completado sigue apareciendo, con nombre/apellido en null. No modifica perfiles_usuario_select_titular ni usuarios_organizacion_select — solo agrega esta lectura puntual acotada a nombre/apellido (FR-005).';

revoke execute on function public.listar_miembros_organizacion() from public;
grant execute on function public.listar_miembros_organizacion() to authenticated;
