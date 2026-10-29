-- F-STK-01 (MSF-268, épica MSF-231) · FR-009: stock actual en vivo.
--
-- Publica `dominio.existencias` (esquema `dominio`: cantidad vigente, regla de
-- negocio del producto; no se altera) en la publicación `supabase_realtime` del
-- Supabase self-hosted (sin Supabase Cloud). Realtime aplica a cada suscriptor la
-- RLS de la tabla (organización y `nivel_seccion('stock')`), por lo que otra
-- organización no recibe sus cambios.
--
-- Aditiva e idempotente: no crea tablas ni columnas; si la tabla ya está
-- publicada no hace nada. Si la publicación no existe (entorno sin Realtime) avisa
-- y sigue, para no romper el reset local.
--
-- Reversión (en una migración posterior, no en este PR):
--   alter publication supabase_realtime drop table dominio.existencias;
-- El listado /stock sigue funcionando sin avisos en vivo (carga por consulta).

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'La publicación supabase_realtime no existe: existencias no se publica.';
  elsif not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'dominio' and tablename = 'existencias'
  ) then
    alter publication supabase_realtime add table dominio.existencias;
  end if;
end
$$;
