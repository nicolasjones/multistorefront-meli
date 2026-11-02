# Fix: MSF-588

- `package.json`: `dev:supabase` = `supabase start; rc=$?; supabase migration up --local && exit $rc` (las migraciones se aplican aunque `start` falle por un servicio no saludable; se conserva su código de salida), para que el arranque local deje siempre las migraciones aplicadas sin pasos manuales.
- `README.md`: explica cuándo `supabase start` no aplica migraciones y cómo recuperarlas.
- Desvío: la causa exacta (flag vs. config) no se reprodujo por falta de Docker; el fix es seguro en ambos casos.
