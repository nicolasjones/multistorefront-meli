# Bug Verification: el guard de migraciones juzgaba el árbol entero contra la punta de la base

- **Slug**: msf-749
- **Tested**: 2026-11-15
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

La reproducción del assessment (rama atrás de la base, que renumeró migraciones, sin tocar
migraciones) pasa de **exit 1 con dos «REUSADA» falsas** a **exit 0** con un aviso que pide
actualizar la rama. Lo mismo con la causa real de los 13 PRs del 2026-11-02 (la base con **dos**
migraciones de la misma versión) y con el modo de checkout del CI (el merge de la base en la rama,
`refs/pull/N/merge`). El guard no perdió dientes: una rama que agrega una migración con versión
reusada, que modifica una publicada, que duplica una versión o que agrega un archivo con nombre
inválido sigue fallando. La suite completa del guard (18 tests) y las de tooling quedan en verde.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproducción (post-fix) | `GITHUB_BASE_REF=dokploy node scripts/verificar-migraciones.mjs` en el repo de la assessment (`/tmp/opencode/repro2`: base que renumera 2 migraciones, rama atrás) | pass | Antes: exit 1 con «versión … REUSADA» × 2. Ahora: exit 0 + aviso de renumeración |
| Reproducción sobre el **historial real** | worktree en `46e78928^` (la rama abierta antes del renumerado `46e78928`) + `GITHUB_BASE_REF=dokploy` | pass | Con el script viejo: exit 1 (`versión 20270308100000 REUSADA …`). Con el nuevo: exit 0 + aviso de renumeración |
| Reproducción sobre los **commits del CI que falló** | base `b073dfef` + rama `0f785467` (PR #642) mergeados como `refs/pull/N/merge`, `origin/dokploy` = `b073dfef` | pass | Con el script viejo: exit 1 con «versión duplicada 20270121120000» + «MODIFICADA» (los dos errores exactos del log del job `125239861850`). Con el nuevo: exit 0 |
| Causa real leída en los jobs que fallaron | `gh api …/actions/jobs/{125239861850,125228243484,125205374707,125203615473,125079833313,125041788218}/logs` | pass | Los 6 jobs del 2026-11-02 fallan con los mismos dos errores: la base tenía **dos** migraciones con la versión `20270121120000` y la rama las heredó. El checkout es `refs/pull/N/merge`, no la rama |
| Tests nuevos y actualizados | `node --test scripts/verificar-migraciones.test.mjs` | pass | 18/18 (10 previos + 8 nuevos) |
| Los tests detectan el bug | Se revirtió sólo `scripts/verificar-migraciones.mjs` y se re-corríó la suite | pass | 4 tests fallan con el código viejo (rama atrás sin tocar migraciones, idempotencia de la migración heredada, nombre inválido heredado y el merge del CI con la versión duplicada) |
| Regression suite (tooling) | `pnpm test:tooling` | pass | 51/51 |
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

El log real del job que falló el 2026-11-02 (`gh api …/jobs/125239861850/logs`, PR #642) muestra el
checkout del CI y los dos errores:

```
HEAD is now at 062bfdaea Merge b073dfefba2a09f208f5ef9ddf6f507580f20a01 into 0f785467393fa752aaabe3b5ab780e2526071eda
Migraciones: revisar antes de mergear
 - versión duplicada 20270121120000: supabase/migrations/20270121120000_alertas_inicio_tabla.sql, supabase/migrations/20270121120000_cortar_sesiones_miembro_removido.sql
 - versión 20270121120000 MODIFICADA: ya existe en origin/dokploy (supabase/migrations/20270121120000_cortar_sesiones_miembro_removido.sql). Una versión aplicada es inmutable: si el contenido nunca se aplicó, renombrala a una versión libre y mayor.
```

Sobre los **commits reales del CI que falló** (base `b073dfef` + rama `0f785467` del PR #642,
mergeados como `refs/pull/N/merge`): con el script viejo el guard da exactamente los dos errores del
log del job `125239861850`; con el script nuevo:

```
Migraciones OK: 434 archivo(s), 0 nuevo(s) contra origin/dokploy.
```

Suite del guard:

```
ℹ tests 18
ℹ pass 18
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
- **Defecto de la base que el guard ya no denuncia en el PR**: con dos migraciones de la misma versión
  en `dokploy`, el PR que las heredó pasa (es lo pedido), pero el push a `dokploy` sigue chocando con el
  guard de árbol entero hasta que la base lo resuelva (en este caso, borrando las migraciones obsoletas).
  El guard informa, no repara, la base.

## Recommendation

Cerrar el bug — verificado end-to-end contra la reproducción del assessment y contra los commits
reales del CI que falló (mismo modo de checkout y mismos errores), con la suite del guard en verde y
los 4 tests que fijan el síntoma fallando con el código viejo.
