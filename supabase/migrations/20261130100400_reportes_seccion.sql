-- F-REN-01 (MSF-204): restricción por sección de permisos para emitir el guest token (FR-007).
-- Esquema (Principio VII): `public.reportes` es plataforma (spec 007) → la columna nueva va en `public`.
--
-- `reportes.seccion` (nullable) marca el reporte que exige una sección de la matriz de permisos.
-- Con la columna definida, `public.resolver_organizacion_reporte` (misma firma) solo devuelve la
-- organización si además de las reglas vigentes (`private.puede_ver_asignacion`) el llamador tiene
-- `lectura` o `edicion` en esa sección; si no devuelve null y `emitir-acceso-reporte` responde 403
-- sin emitir token. Además exige que el reporte esté asignado a la organización activa (el rol
-- `administrador` pasa `puede_ver_asignacion` sin fila de asignación; un reporte ajeno o inexistente
-- no debe emitir token). Con `seccion` nula el comportamiento es el de la spec 007, sin cambios.
--
-- Migración aditiva. Reversión (migración posterior):
--   restaurar public.resolver_organizacion_reporte al cuerpo de 20260909140000_analitica_embebida.sql;
--   alter table public.reportes drop column seccion;

alter table public.reportes
  add column seccion text check (seccion is null or btrim(seccion) <> '');

comment on column public.reportes.seccion is
  'Sección de la matriz de permisos que exige el reporte para emitir el token (p. ej. rentabilidad). Nula = sin exigencia extra (spec 007).';

create or replace function public.resolver_organizacion_reporte(p_reporte_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.puede_ver_asignacion(p_reporte_id, private.organizacion_id())
      and exists (
        select 1 from public.reportes_organizaciones ro
         where ro.reporte_id = p_reporte_id and ro.organizacion_id = private.organizacion_id()
      )
      and coalesce(
        (select private.nivel_seccion(r.seccion) in ('lectura', 'edicion')
           from public.reportes r
          where r.id = p_reporte_id and r.seccion is not null),
        true
      )
      then private.organizacion_id()
    else null
  end;
$$;

comment on function public.resolver_organizacion_reporte(uuid) is
  'Contrato: specs/007-analitica-embebida/contracts/acceso-reporte.md. Resuelve la organización con la que emitir-acceso-reporte arma la cláusula rls del guest token; si el reporte declara una sección (reportes.seccion) exige lectura o edición en ella (F-REN-01). Devuelve null si no hay acceso.';

revoke execute on function public.resolver_organizacion_reporte(uuid) from public, anon;
grant execute on function public.resolver_organizacion_reporte(uuid) to authenticated;
