-- F-SVC-01 (MSF-254, épica MSF-182): registra la funcionalidad `service-tecnico` en el panel.
-- Esquema: sin tablas nuevas; solo una fila del catálogo `public.features` (Principio VII).
--
-- Patrón descentralizado de la spec 009: la funcionalidad se registra desde su propia migración con
-- `registrar_feature`, que exige un superadmin real. En un reset desde cero todavía no hay superadmin
-- (lo crea `supabase/seed.sql`, que corre después), por eso el seed completa el registro. Registrarla
-- NO la habilita: un superadmin la activa por organización desde Funcionalidades. Mientras no esté
-- habilitada, el menú «Service técnico» y sus rutas no se ofrecen (FR-009); los datos siguen
-- protegidos por RLS y el nivel de la sección `service_tecnico`.
--
-- Migración aditiva. Reversión (migración posterior): deshabilitar la funcionalidad en las
-- organizaciones (`delete from public.organizaciones_features where feature_id = 'service-tecnico'`)
-- y luego `delete from public.features where id = 'service-tecnico'`.

do $$
declare
  v_actor uuid;
begin
  select user_id into v_actor from public.superadmins order by user_id limit 1;

  if v_actor is null then
    raise notice 'No existe ningún superadmin todavía — Service técnico en Funcionalidades queda para que lo registre seed.sql (dev/CI) o un alta manual posterior (producción)';
    return;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_actor)::text, true);

  if not exists (select 1 from public.features where id = 'service-tecnico') then
    perform public.registrar_feature(
      'service-tecnico',
      'Service técnico',
      'Reparaciones de equipos: modelos, estados configurables, alta y seguimiento de cada reparación.'
    );
  end if;
end $$;
