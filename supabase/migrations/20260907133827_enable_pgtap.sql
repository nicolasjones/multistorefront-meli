-- Habilita pgtap: lo necesitan los tests de supabase/tests/database/.
-- Antes lo habilitaba "supabase test db" solo, como efecto secundario
-- oculto; queda explicito para que corra igual via pg_prove directo
-- (necesario en el runner self-hosted, ver docs/deployment.md).
create extension if not exists pgtap with schema extensions;
