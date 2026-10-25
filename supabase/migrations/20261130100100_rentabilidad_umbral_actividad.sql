-- F-REN-01 (MSF-204): registra `rentabilidad.umbral_actualizado` (actor, antes/después) en Actividad.
-- Disparador SECURITY DEFINER porque `private.insertar_actividad` no es ejecutable por la app.
-- Sin evento si el valor no cambió (insertar el 0,10 por defecto tampoco cuenta como cambio).
--
-- Migración aditiva. Reversión (migración posterior):
--   drop trigger rentabilidad_config_registrar on dominio.rentabilidad_config;
--   drop function private.registrar_umbral_margen();

create or replace function private.registrar_umbral_margen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_antes numeric := case when tg_op = 'UPDATE' then old.umbral_margen_bajo else 0.10 end;
begin
  if v_actor is null or v_antes = new.umbral_margen_bajo then
    return new;
  end if;
  perform private.insertar_actividad(
    new.organizacion_id, v_actor, 'rentabilidad.umbral_actualizado',
    format(
      'Cambió el umbral de margen bajo: %s %% → %s %%',
      replace(trim_scale(round(v_antes * 100, 2))::text, '.', ','),
      replace(trim_scale(round(new.umbral_margen_bajo * 100, 2))::text, '.', ',')
    )
  );
  return new;
end;
$$;

revoke execute on function private.registrar_umbral_margen() from public, anon, authenticated;

create trigger rentabilidad_config_registrar
  after insert or update on dominio.rentabilidad_config
  for each row execute function private.registrar_umbral_margen();
