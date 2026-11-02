-- MSF-361 · F-INI-02 (FR-023, FR-024): superficie de lectura de las alertas de Inicio.
--
-- Esquema (Principio VII): ninguna tabla nueva; las vistas viven en `public` (superficie de lectura, no
-- almacenan datos) sobre dominio.alertas_inicio y dominio.alertas_inicio_calculos.
--
-- Seguridad: ambas vistas son `security_invoker`, así que aplican la RLS de las tablas: sección con
-- ≥ lectura, empresa accesible y organización de la sesión. `anon` sin privilegios.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop view public.alertas_inicio_calculo;
--   drop view public.alertas_inicio_visibles;

create or replace view public.alertas_inicio_visibles
with (security_invoker = true) as
select a.id, a.empresa_id, a.tipo, a.seccion, a.cantidad, a.referencia_id, a.enlace, a.calculada_en
  from dominio.alertas_inicio a;

comment on view public.alertas_inicio_visibles is
  'F-INI-02: alertas de Inicio que la RLS deja ver al usuario (sección ≥ lectura, empresa accesible). Contrato en specs/20261030-100000-inicio-y-alertas/contracts/inicio-y-alertas.md.';

-- Fecha del último cálculo de la organización: permite avisar la demora aunque no haya alertas.
create or replace view public.alertas_inicio_calculo
with (security_invoker = true) as
select c.calculada_en
  from dominio.alertas_inicio_calculos c;

comment on view public.alertas_inicio_calculo is
  'F-INI-02: fecha del último cálculo de alertas de la organización de la sesión (base del aviso de demora, FR-024).';

revoke all on public.alertas_inicio_visibles from public, anon, authenticated;
revoke all on public.alertas_inicio_calculo from public, anon, authenticated;
grant select on public.alertas_inicio_visibles to authenticated;
grant select on public.alertas_inicio_calculo to authenticated;
