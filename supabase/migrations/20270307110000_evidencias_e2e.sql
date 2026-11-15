-- Spec 022 (T007): bucket privado de evidencias E2E por historia.
--
-- Las corridas suben `<run-id>/cobertura-e2e.json` + videos `.webm` con la
-- service-role del CI (bypassa RLS). El navegador solo lee, por URL firmada
-- (patrón `evidencias-ejecuciones`, sin service-role en el cliente).
-- ATENCIÓN (privacidad): la policy de lectura deja que CUALQUIER usuario `authenticated`, de cualquier
-- organización, liste y lea TODOS los videos del bucket. Por eso los videos de evidencia no deben contener datos
-- reales de clientes: solo siembras de prueba. En MSF no hay consumidor del visor (vive en el panel SDLC); no se
-- sabe si el panel lee con `authenticated`, así que el comportamiento de la policy no se cambia acá.
-- Reversión: delete from storage.buckets where id = 'evidencias-e2e';
--   (tras vaciar el bucket; las policies caen con el bucket).

insert into storage.buckets (id, name, public)
values ('evidencias-e2e', 'evidencias-e2e', false)
on conflict (id) do nothing;

-- Lectura: cualquier usuario autenticado (la ruta del visor exige además
-- permisos de panel; los videos no son datos de una organización).
drop policy if exists evidencias_e2e_select_authenticated on storage.objects;
create policy evidencias_e2e_select_authenticated on storage.objects
  for select to authenticated
  using (bucket_id = 'evidencias-e2e');

-- Sin policy de insert/update/delete: solo service-role (bypassa RLS) sube
-- desde el CI; ningún rol de navegador escribe.
