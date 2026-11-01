# Fix: MSF-588

- `package.json`: `dev:supabase` = `supabase start && supabase migration up --local`, para que el arranque local deje siempre las migraciones aplicadas sin pasos manuales.
- `README.md`: explica cuándo `supabase start` no aplica migraciones y cómo recuperarlas.
- Desvío: la causa exacta (flag vs. config) no se reprodujo por falta de Docker; el fix es seguro en ambos casos.
