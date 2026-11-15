# Bug Verification: el guard de migraciones juzgaba el árbol entero contra la punta de la base

- **Slug**: msf-749
- **Tested**: 2026-11-15
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

La reproducción del assessment (rama atrás de la base, que renumeró migraciones, sin tocar
migraciones) pasa de **exit 1 con dos «REUSADA» falsas** a **exit 0** con un aviso que pide
actualizar la rama. El guard no perdió dientes: una rama que agrega una migración con versión
reusada, que modifica una publicada, que duplica una versión o que agrega un archivo con nombre
inválido sigue fallando. La suite completa del guard (17 tests) y las de tooling quedan en verde.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix) | `GITHUB_BASE_REF=dokploy node scripts/verificar-migraciones.mjs` en el repo de la assessment (`/tmp/opencode/repro2`: base que renumera 2 migraciones, rama atrás) | pass | Antes: exit 1 con «versión … REUSADA» × 2. Ahora: exit 0 + aviso de renumeración |
| Reproduction sobre el **historial real** | worktree en `46e78928^` (la rama abierta antes del renumerado `46e78928`) + `GITHUB_BASE_REF=dokploy` | pass | Con el script viejo: exit 1 (`versión 20270308100000 REUSADA …`). Con el nuevo: exit 0 + aviso de renumeración |
| Reproduction (post-fix, forma del tracker) | `git merge origin/dokploy` en la misma rama | pass | Con la base integrada el resultado es idéntico a `dokploy`, como decía el tracker |
| Tests nuevos y actualizados | `node --test scripts/verificar-migraciones.test.mjs` | pass | 17/17 (10 previos + 7 nuevos) |
| Los tests detectan el bug | Se revirtió sólo `scripts/verificar-migraciones.mjs` y se re-corró la suite | pass | 3 tests fallan con el código viejo (rama atrás sin tocar migraciones, idempotencia de la migración heredada, nombre inválido heredado) |
| Regression suite (tooling) | `pnpm test:tooling` | pass | 50/50 |
| Regression suite (guard de DDL) | `pnpm test:db:guard-migraciones` | pass | 30/30 |
| Guard de documentación | `pnpm docs:check` | pass | «Documentación de cambios: OK» + «Migraciones OK: 675 archivo(s), 0 nuevo(s)» |
| Lint | `pnpm lint` (oxlint) | pass | exit 0; sólo avisos previos de `apps/web` (archivos que esta historia no toca) |
| Build | `pnpm build` | pass | «✓ built in 4.11s» |
| Calidad (secretos/SAST/código muerto/duplicación/arquitectura/versiones) | `pnpm calidad` | partial | Todo ok salvo **gitleaks**: el check corre gitleaks dentro de Docker y en este entorno no hay acceso al daemon («permission denied … /var/run/docker.sock») → quedó *not-run*, no es un hallazgo del cambio |
| Push a la rama base (cobertura del árbol entero) | `GITHUB_BASE_REF=dokploy node scripts/verificar-migraciones.mjs` sobre esta rama | pass | exit 0; 4 migraciones propias de la rama, por encima de la máxima de la base de la épica |

## Output Excerpts

Antes del fix (rama atrás de la base, sin tocar migraciones):

```
Migraciones: revisar antes de mergear
 - versión 20270121120000 REUSADA: ya existe 20270311100000 o mayor en origin/dokploy; usá una versión nueva y mayor (supabase/migrations/20270121120000_cortar.sql)
 - versión 20270308100000 REUSADA: ya existe 20270311100000 o mayor en origin/dokploy; usá una versión nueva y mayor (supabase/migrations/20270308100000_estilo.sql)
```

Después del fix (mismo repo, mismo comando):

```
aviso: la base origin/dokploy renumeró o quitó 2 migración(es) que tu rama heredó (20270121120000, 20270308100000): actualizá tu rama (merge de origin/dokploy) antes de mergear
Migraciones OK: 2 archivo(s), 0 nuevo(s) contra origin/dokploy.
```

Sobre el **historial real** (worktree en `46e78928^`, la rama que quedó abierta antes del renumerado
`46e78928`): con el script del repo el guard daba exit 1 con el síntoma exacto del tracker; con el
script nuevo:

```
aviso: la base origin/dokploy renumeró o quitó 1 migración(es) que tu rama heredó (20270308100000): actualizá tu rama (merge de origin/dokploy) antes de mergear
Migraciones OK: 650 archivo(s), 0 nuevo(s) contra origin/dokploy.
```

Suite del guard:

```
ℹ tests 17
ℹ pass 17
ℹ fail 0
```

## Residual Risks

- **El aviso no es bloqueante**: si la base renumeró una migración y la rama no se actualiza, al
  integrar pueden coexistir la migración vieja y la renumerada. Eso no lo resuelve el guard (no puede):
  se resuelve con el merge de la base en la rama del PR antes de mergear. El aviso lo dice; el cambio
  de flujo que lo haga determinista queda como seguimiento (la otra salida que propone el tracker).
- **La colisión real se sigue detectando**: el alcance más angosto no afloja las reglas (versiones reusadas,
  modificadas, duplicadas, nombres inválidos e idempotencia) para las migraciones que la rama agrega o
  modifica, y la comparación de colisiones sigue siendo contra la punta de la base.
- **Push a la rama base**: cuando la base *es* el `HEAD` no hay migraciones propias y el guard revisa el
  árbol entero (como antes), para no perder la cobertura de nombres inválidos y duplicados en el push.
- **Clone superficial sin ancestro común**: el guard cae a `HEAD~1`; si tampoco puede, revisa el árbol
  entero. No se verificó contra un clon real de GitHub (aquí se reprodujo con un repo huérfano).
- **La lista concreta de los 13 PRs** no se pudo verificar desde este entorno (sin `gh`): lo verificado
  es el mecanismo y su reproducción, no la lista.

## Recommendation

Cerrar el bug — verificado end-to-end contra la reproducción del assessment, con la suite del guard
en verde y los tests que fijan el síntoma fallando con el código viejo.
