# Bug Fix: el guard de migraciones juzgaba el árbol entero contra la punta de la base

- **Slug**: msf-749
- **Fixed**: 2026-11-15
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

`scripts/verificar-migraciones.mjs` comparaba **todas** las migraciones del árbol de la rama contra la
**punta** de `origin/dokploy`, así que una base que renumera migraciones hacía fallar el job
`application` de todo PR abierto antes del renumerado (13 PRs `BEHIND`), aunque no tocara
migraciones. Ahora el guard juzga **las migraciones propias de la rama** (las que agregó, renombró o
modificó desde el punto de divergencia, `git merge-base` con la base) y sigue comparando las
colisiones contra la punta de la base: no pierde dientes, pero deja de culpar al PR por lo que hizo
la base.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `scripts/verificar-migraciones.mjs` | modified | Alcance por `merge-base`; aviso (no error) cuando la base renumeró migraciones que la rama heredó; fallback a `HEAD~1` sin ancestro común |
| `scripts/verificar-migraciones.test.mjs` | added tests | 7 casos: rama atrás sin tocar migraciones, REUSADA propia, MODIFICADA propia, idempotencia heredada, duplicado propio, nombre inválido propio vs heredado, `merge-base` irresoluble |
| `docs/guard-migraciones.md` | modified | Sección «Qué revisa (y qué no): el alcance es la rama, no el árbol entero» |
| `docs/verificar-migraciones.md` | modified | Tabla de reglas con el alcance y el aviso de renumeración |
| `docs/control-ci.md` | modified | Runbook: qué hacer con un PR `BEHIND` que falla el guard |

## Diff Highlights

```js
// El punto de divergencia separa lo que la rama trajo de lo que la base ya tenía.
const propias = fork && commitBase !== head ? (() => {
  const cambios = (git(['diff', '--name-status', '--cached', fork, '--', 'supabase/migrations']).stdout || '')
    .split('\n').map((x) => x.trim()).filter(Boolean);
  const set = new Set();
  for (const linea of cambios) {
    const partes = linea.split('\t');
    const estado = (partes[0] || '')[0];
    const rutas = estado === 'R' || estado === 'C' ? partes.slice(2) : partes.slice(1);
    for (const r of rutas) if (r.startsWith('supabase/migrations/')) set.add(r);
  }
  return set;
})() : null;
const enAlcance = (f) => propias === null || propias.has(f);
```

Cada regla (nombre inválido, versión duplicada, `REUSADA`, `MODIFICADA`, idempotencia) se aplica
sólo a las migraciones en alcance; las colisiones se siguen comparando contra la **punta** de la base.

## Tests Added or Updated

- `scripts/verificar-migraciones.test.mjs::rama atrás de la base (la base renumeró una migración) sin tocar migraciones: no falla` — el síntoma reportado (exit 1 por `REUSADA` de una migración heredada).
- `scripts/verificar-migraciones.test.mjs::rama atrás que agrega su propia migración con versión reusada: sigue fallando` — el guard no pierde dientes.
- `scripts/verificar-migraciones.test.mjs::rama atrás que modifica una migración publicada: sigue siendo MODIFICADA` — idem.
- `scripts/verificar-migraciones.test.mjs::migración heredada de la base sin guard de idempotencia: no se revisa (no es nueva de la rama)` — la migración heredada tampoco entra en la revisión de idempotencia.
- `scripts/verificar-migraciones.test.mjs::rama atrás que agrega dos archivos con la misma versión: sigue siendo duplicado`.
- `scripts/verificar-migraciones.test.mjs::nombre inválido: el de la rama es error y el heredado no culpa a la rama`.
- `scripts/verificar-migraciones.test.mjs::sin ancestro común con la base (clone superficial): cae a HEAD~1 y no se rompe`.

## Local Verification

- `node --test scripts/verificar-migraciones.test.mjs` → 17/17 en verde (10 previos + 7 nuevos).
- Los 3 tests que fijan el síntoma **fallan con el código viejo** (verificado revirtiendo sólo
  `scripts/verificar-migraciones.mjs` y volviendo a correr la suite).
- Reproducción del assessment (`/tmp/opencode/repro2`: base que renumera dos migraciones, rama
  atrás): con el código viejo exit 1 con dos «REUSADA» falsas; con el código nuevo exit 0 y el aviso
  «la base origin/dokploy renumeró o quitó 2 migración(es) que tu rama heredó».
- Reproducción sobre el **historial real** (worktree en `46e78928^`, la rama que quedó abierta antes
  del renumerado `46e78928`): con el script del repo exit 1 (`versión 20270308100000 REUSADA …`,
  el síntoma exacto del tracker); con el script nuevo exit 0 + el aviso de renumeración.
- `pnpm docs:check` → «Documentación de cambios: OK» + «Migraciones OK: 675 archivo(s), 0 nuevo(s)».
- `GITHUB_BASE_REF=dokploy node scripts/verificar-migraciones.mjs` → exit 0.
- `GITHUB_BASE_REF=epic/MSF-515-lote-2-higiene-y-docs node scripts/verificar-migraciones.mjs` → exit 0
  (4 migraciones propias de la rama, por encima de la máxima de la base de la épica).

## Deviations from Assessment

- La assessment proponía aplicar las reglas «sólo a las migraciones propias»; se mantiene, pero el
  alcance se calcula contra el **índice** (`git diff --name-status --cached`) y no contra `HEAD`, para
  que el guard vea lo mismo que revisa (el índice) y para que un checkout del CI con el merge de la
  base no meta en el alcance las migraciones que la base agregó después de la divergencia.
- Cuando la base **es** el `HEAD` (push a la rama base) no hay migraciones propias: se revisa el árbol
  entero, como antes, para no perder la cobertura de nombres inválidos y duplicados en el push.
- El aviso de «la base renumeró» se emite sólo cuando el punto de divergencia salió de `merge-base`
  (con el fallback a `HEAD~1` no hay historia común y el aviso sería ruido).
- El alcance por `merge-base` se aplica **también** cuando la base es una rama de épica (la épica
  también renumera migraciones al integrar): el guard juzga lo que la historia agregó o modificó y
  deja de heredar los fallos de la épica. La colisión real contra la punta de la base sigue siendo error.
- El aviso de renumeración es **informativo** (no bloqueante): la colisión real al integrar
  (migración duplicada) se resuelve en el merge, no en el guard.
- No se cambió el flujo (mergear la base en la rama antes de `Validate`): la assessment lo marca como
  complemento y el tracker lo deja como la otra salida posible; queda como seguimiento.

## Follow-ups

- El flujo determinista que actualiza la rama del PR antes de correr `Validate` (la otra salida que
  propone el tracker) no se implements acá: es un cambio de orquestación, no del guard.
- El aviso de renumeración resume el número de migraciones y muestra las primeras cinco: en una
  rama muy atrasada puede no listar todas.
