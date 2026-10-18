# CI: ranuras del stack de Supabase (S3a)

Cada corrida del job `database` reserva una **ranura** (`scripts/supabase-ci.mjs reclamar`) sobre el volumen
compartido `/pnpm/.ci-locks`, en vez de usar `concurrency` por repo (BUG-179: GitHub cancelaba las corridas en
cola). Sin ranura libre, el job **espera**. Este archivo existe sólo para que el clasificador de cambios del CI
(`db`) dispare el job y verificar el cableado de punta a punta.
