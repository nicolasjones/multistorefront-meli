# Bug Assessment: el guard de migraciones no detecta `ADD COLUMN` en línea aparte

- **Slug**: msf-682 (provisto por el usuario)
- **Created**: 2026-11-01
- **Source**: pasted text (Jira MSF-682)
- **Verdict**: valid
- **Severity**: medium

## Report (summarized)
`scripts/verificar-migraciones.mjs` no detecta `ADD COLUMN` sin `IF NOT EXISTS` cuando se escribe en una línea aparte de `ALTER TABLE` (falso negativo). El reporte indica 34 migraciones con esa forma.

## Symptom
Una migración nueva con `alter table t` / `  add column x ...` pasa el guard, pese a no ser idempotente: una aplicación parcial traba el reintento. Esperado: el guard la marca como problema, igual que la forma en una sola línea.

## Reproduction
1. Crear una migración nueva con `alter table public.t\n  add column x int;`.
2. Correr `node scripts/verificar-migraciones.mjs --solo-idempotencia`.
3. Sale OK (0 problemas). Con `alter table public.t add column x int;` en una línea sí falla.
[NEEDS CLARIFICATION: no se corrió el script contra una migración sintética; la conclusión sale de leer el código y de un conteo con regex.]

## Suspected Code Paths
- `scripts/verificar-migraciones.mjs:118` (función `revisar`, regla ADD COLUMN) — analiza línea por línea con `/^alter\s+table\s+[^;]*\badd\s+column\b/i`. Exige `alter table` y `add column` en la MISMA línea, así que la forma multilínea (`add column` al inicio de su propia línea, incluso las adicionales tras una coma) nunca coincide.
- `scripts/verificar-migraciones.mjs:112-117` — `revisar` parte el SQL en líneas y sólo ignora comentarios `--`; no hay análisis por sentencia (`;`).
- `package.json:72` — `docs:check` invoca el guard (así corre en CI).
- Mismo defecto potencial en `DROP FUNCTION`/`CREATE INDEX`/`CREATE TABLE`: son por línea, pero empiezan con la palabra clave en la misma línea, así que el síntoma práctico se limita a `ADD COLUMN`. (`CREATE INDEX` con `IF NOT EXISTS` en la línea siguiente daría falso positivo, no negativo.)

## Root Cause Hypothesis
La regla es línea-a-línea y requiere `alter table` y `add column` en la misma línea; el SQL multilínea (formato habitual de `ALTER TABLE ... \n ADD COLUMN ...`) escapa. Confianza: alta.

Cifras: un conteo de `add column` sin guard al inicio de línea, en todo `supabase/migrations`, da 22 ocurrencias en 16 archivos (no 34; el número del reporte no se pudo reproducir, puede contar de otra forma, p. ej. incluir líneas con otros guards o `ALTER TABLE` multilínea con varios `ADD`). Además, el guard sólo revisa archivos NUEVOS respecto de `origin/dokploy` (`nuevos`), por lo que esas migraciones históricas no fallarían tras el fix; sólo las futuras.

## Proposed Remediation
**Preferred**: en `revisar`, dejar de analizar por línea para esta regla: quitar comentarios (`--` y `/* */`), partir el SQL en sentencias por `;` (cuidando `$$ ... $$` de funciones), y para cada sentencia que empiece con `alter table`, buscar con regex global todos los `\badd\s+column\b(?!\s+if\s+not\s+exists)` (`\s` cubre saltos de línea). Reportar `archivo:línea` de cada ocurrencia calculando la línea desde el offset. Extraer la lógica a una función exportable (`detectarAddColumnSinGuard(sql)`) para poder testearla.
**Alternatives**:
- Regex multilínea sobre todo el archivo sin partir por sentencias: más simple, pero puede dar falsos positivos con `add column` dentro de strings o cuerpos `$$` (p. ej. SQL dinámico).
- Reutilizar el parser de `scripts/validar-migraciones-aditivas.mjs` si ya segmenta sentencias.

**Files likely to change**:
- `scripts/verificar-migraciones.mjs`
- `scripts/verificar-migraciones.test.mjs` (nuevo; el guard no tiene test)
- `docs/` o la spec que describe el guard (regla de documentación obligatoria; `pnpm docs:check`)

**Tests to add or update**:
- `alter table t\n add column x int;` → problema.
- `alter table t\n add column if not exists x int;` → OK.
- Varios `add column` separados por coma en líneas distintas, uno sin guard → problema con la línea correcta.
- Forma de una línea sigue detectándose; comentarios `--` con `add column` se ignoran; `add column` dentro de `$$...$$` no da falso positivo.

## Risks & Considerations
- Sólo aplica a migraciones nuevas, pero cualquier PR en vuelo con la forma multilínea empezará a fallar: avisar y corregir esas migraciones (agregar `IF NOT EXISTS`; si la versión ya está publicada, sólo agregar guards está permitido por el normalizador `sinGuards`).
- No editar las 16 migraciones históricas (versiones inmutables, BUG-182/231); no son alcanzadas por el guard.
- Cuidar falsos positivos con SQL dinámico/`DO $$` y con `ALTER TABLE ... ADD COLUMN` dentro de `ALTER TYPE`/`ALTER TABLE ... ADD CONSTRAINT` (no matchean `add column`).
- `--solo-idempotencia` y el modo CI deben conservar el mismo código de salida.

## Open Questions
- [NEEDS CLARIFICATION: ¿de dónde sale el "34" del reporte? El conteo local da 22 ocurrencias/16 archivos.]
- [NEEDS CLARIFICATION: ¿hay migraciones nuevas pendientes en otras ramas con la forma multilínea que fallarían al mergear el fix?]
