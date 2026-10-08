-- Storage protege sus objetos de eliminaciones SQL directas. La purga se
-- orquesta desde packages/ia: lista las evidencias pendientes, elimina cada
-- objeto con la API de Storage y recién entonces confirma la limpieza aquí.
create or replace function private.purgar_evidencias_ia(
  p_hasta timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = private, public
as $$
begin
  raise exception using
    errcode = '0A000',
    message = 'La purga de evidencias IA requiere la API de Storage',
    detail = 'Use evidencias_ia_pendientes_purga, elimine cada objeto con Storage y confirme con finalizar_purga_evidencias_ia.';
end;
$$;
