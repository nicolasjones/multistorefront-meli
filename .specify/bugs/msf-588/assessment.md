# Evaluación: MSF-588 — `supabase start` no aplica las migraciones locales

- Síntoma: tras `supabase start --ignore-health-check` (CLI 2.122.0) faltaba `supabase_migrations.schema_migrations` y PostgREST daba 503 (`schema "dominio" does not exist`); hubo que correr `supabase migration up --local`.
- Causa: NO confirmada por reproducción (el entorno del Desarrollador no tiene acceso al daemon de Docker, no se pudo probar sin el flag). El CLI aplica las migraciones solo al inicializar la base; con un volumen existente o con el flag que ignora la salud de los servicios el paso puede omitirse.
- Remediación: `dev:supabase` encadena `supabase migration up --local` (idempotente, no-op si ya está al día) y el README lo documenta. Sin migraciones nuevas ni cambio en producción.
