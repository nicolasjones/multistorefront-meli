# Bug Fix: el guard de migraciones no detecta `ADD COLUMN` en línea aparte

- **Slug**: msf-682
- **Fixed**: 2026-11-01
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

Las reglas de idempotencia del guard (`scripts/verificar-migraciones.mjs`) se evaluaban **línea
por línea**: `ADD COLUMN` exigía `alter table` y `add column` en la misma línea, así que la
forma habitual del repo (`alter table t` + `add column x` en la línea siguiente) pasaba sin
marcar. Ahora el detector (`scripts/guard-migraciones-ddl.mjs`) parte el SQL en **sentencias**
(por `;`) y evalúa cada sentencia completa, con comentarios, literales, identificadores y
cuerpos dollar-quoted (`$$...$$`) enmascarados: se marca el `ADD COLUMN` sin guard y NO se marca
el SQL dinámico que sólo es texto de una plantilla.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `scripts/guard-migraciones-ddl.mjs` | added | detector por sentencia; reemplaza a `scripts/detectar-add-column.mjs` (mismo alcance + el resto de las reglas de DDL) |
| `scripts/guard-migraciones-ddl.test.mjs` | added | 18 tests del detector (unitarios) |
| `scripts/verificar-migraciones.test.mjs` | added | 7 tests de integración: código de salida del guard ante migraciones sintéticas |
| `scripts/verificar-migraciones.mjs` | modified | las 5 reglas de idempotencia salen del bucle por línea y usan `revisarDdl()` |
| `scripts/detectar-add-column.mjs` | removed | sustituido por `scripts/guard-migraciones-ddl.mjs` (el módulo ya no es sólo de `ADD COLUMN`) |
| `scripts/detectar-add-column.test.mjs` | removed | sustituido por `scripts/guard-migraciones-ddl.test.mjs` |
| `package.json` | modified | `test:db:guard-migraciones` corre los dos archivos de test |
| `.github/workflows/validate.yml` | modified | el job de validación corre `pnpm test:db:guard-migraciones` (antes el test no corría en el CI) |
| `docs/guard-migraciones.md` | modified | reglas, severidades y enmascarado (doc y código coinciden) |
| `.specify/bugs/msf-682/fix.md`, `.specify/bugs/msf-682/test.md` | modified | informe de fix y verificación |

## Diff Highlights

```js
// scripts/guard-migraciones-ddl.mjs — antes: anclado al inicio de línea
const alter = /^[ \t]*alter\s+table\b[^;]*/gim;   // `select 1; alter table t ...` escapaba

// ahora: por sentencia, sobre el SQL enmascarado
for (const sentencia of partirEnmascarado(enmascarar(sql))) {
  for (const regla of REGLAS) {
    for (const offset of regla.offsets(sentencia.texto)) { /* línea real del hallazgo */ }
  }
}
```

## Tests Added or Updated

- `scripts/guard-migraciones-ddl.test.mjs` — `ADD COLUMN` en una línea, en línea aparte, con la
  sentencia sin anclaje (`select 1; alter table ...`), con `IF NOT EXISTS` (una o varias
  líneas), varios `ADD COLUMN` (línea correcta), comentarios/literales, cuerpo dollar-quoted
  (`$$` y `$tag$`), `CREATE INDEX`/`DROP FUNCTION`/`DROP TABLE`/`CREATE TABLE` con el guard en la
  línea siguiente, `;` dentro de un literal.
- `scripts/verificar-migraciones.test.mjs` — el guard contra una migración sintética en un repo
  git temporal: exit 1 + mensaje con `ADD COLUMN` (una línea, línea aparte, sin anclaje),
  exit 0 con `IF NOT EXISTS` y con SQL dinámico, exit 1 con `CREATE INDEX` sin guard.

## Local Verification

- `pnpm test:db:guard-migraciones` → 25/25 OK (18 unitarios + 7 de integración).
- `node scripts/verificar-migraciones.mjs --solo-idempotencia` → `Migraciones OK: 419 archivo(s),
  0 nuevo(s) contra origin/dokploy` (exit 0).
- `pnpm docs:check` → OK.
- `pnpm lint` → exit 0 (los warnings de React son preexistentes de `apps/web`).
- `pnpm build` → exit 0.
- `pnpm calidad` → `oxlint`, `jscpd`, `dependency-cruiser` y `syncpack` OK; `knip` OK tras usar
  `partirSentencias` en el test; `gitleaks` no se pudo correr (sin binario y sin Docker en el
  entorno: `permission denied` al hablar con el socket de Docker) — queda para el CI.
- Contraste contra el corpus histórico (419 migraciones): `ADD COLUMN` sin guard → 27 hallazgos
  en 20 migraciones (los mismos que el módulo anterior, con la misma línea); las otras 4 reglas
  → 290 hallazgos, **sin ninguna diferencia** con la versión por línea (ni altas ni bajas): el
  cambio de línea a sentencia no altera el veredicto de las migraciones ya publicadas.

## Deviations from Assessment

- El assessment proponía extraer **sólo** la regla `ADD COLUMN`. La devolución del Revisor pidió
  además (a) que la regla no quede anclada al inicio de línea, (b) enmascarar los cuerpos
  dollar-quoted y (c) que `CREATE INDEX`/`DROP FUNCTION`/`DROP TABLE`/`CREATE TABLE` también se
  evalúen por sentencia. Por eso el módulo nuevo cubre las 5 reglas de DDL y no sólo
  `ADD COLUMN`; el enmascarado compartido es el mismo para todas.
- El assessment nombraba `scripts/verificar-migraciones.test.mjs` como test nuevo: se agregó
  (integración, código de salida del guard) además del test unitario del detector.
- El módulo se renombró de `detectar-add-column.mjs` a `guard-migraciones-ddl.mjs` porque ya no
  detecta sólo `ADD COLUMN`.

## Follow-ups

- Las 20 migraciones históricas con `ADD COLUMN` sin guard (27 ocurrencias) no se corrigen acá:
  sus versiones ya están publicadas (inmutables) y el guard sólo revisa archivos nuevos. Una
  migración en vuelo con esa forma debe agregar `IF NOT EXISTS` antes de mergear.
