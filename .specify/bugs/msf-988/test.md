# Bug Verification: MSF-988 — cierre de los hallazgos H-2 a H-6 de MSF-176 sobre `dokploy` actual

- **Slug**: msf-988
- **Tested**: 2026-11-17
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

## Summary

El fix está aplicado y verificado **en el código**: las cuatro migraciones del cierre se construyeron sobre las definiciones vigentes de
`dokploy` (comprobado carácter a carácter contra la migración de origen), el front del PR aplicaba limpio y todos los guards que se
pueden correr en este nodo pasan (lint, build, Vitest de lo tocado, guard de migraciones, docs, DER, trampas conocidas). El **pgTAP no
se pudo ejecutar localmente**: este nodo no tiene Postgres ni Docker (el socket de Docker responde «permission denied»), así que la
parte de base de datos queda para el job `database` del CI. Por eso el veredicto es `partial` y no `verified`: el síntoma original (el
PR sin mergear, con el fix de seguridad ausente de la base) sí está resuelto en el código, pero la prueba de base de datos no se
ejercitó acá.

**Ronda del CI (2026-11-17, jobs `application`, `database` y `validacion` en rojo sobre el commit anterior):** el log sunken los cuatro
puntos que faltaban y este commit los corrige — la versión `REUSADA` de las cuatro migraciones, el `duplicate key` del fixture del pgTAP
del cierre, la ráfaga de 203 favoritos contra el cupo nuevo y el comentario de `mis_compras_por_dominio` que perdía el «DEFENSA EN
PROFUNDIDAD» (lo fijaba `tienda_menores_revision.test.sql`). Los detalles están en la fila «Correcciones del CI» de la tabla.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix) | `gh pr view 965 --json mergeable,mergeStateStatus` y `git merge-base --is-ancestor 4f22868d3 origin/dokploy` | pass | El PR #965 sigue `CONFLICTING` (no se toca: la entrega es un PR **nuevo** de esta rama, `fix/bug-MSF-988`, contra `dokploy`). El fix de esta rama sí está sobre `origin/dokploy` (4 migraciones nuevas + pgTAP + front + docs). |
| New / updated tests (front) | `vitest run src/lib/tiendaCuentaDatos.test.ts src/lib/tiendaPedido.test.ts src/lib/tiendaPedido.caracteres.test.ts src/hooks/useListadoPorCursor.test.tsx src/hooks/useFavoritosEntre.test.tsx src/pages/tienda-publica/cuenta/` | pass | 142 pruebas en verde (8 archivos). |
| El test vigila la regla (FEAT-236) | Mutación a propósito en `tiendaCuentaDatos.ts`: (a) `menseLimite` devuelve siempre el texto genérico; (b) `esLimite` devuelve siempre `false` | pass | (a) rompe 12 pruebas de 5 archivos; (b) rompe los tests del cupo: los tests **detectan** el cambio de la regla, no la describen. Las dos mutaciones se revirtieron. |
| Regression suite (front) | `vitest run src/lib/tiendaOpiniones.test.ts src/pages/tienda-publica/cuenta/favoritosSoloEnLaTienda.test.ts src/pages/tienda-publica/lista/ src/pages/tienda-publica/opiniones/ src/hooks/useComprasCliente.test.tsx src/components/consultas/` | pass | 188 pruebas en verde (12 archivos). Son los que dependen de `tiendaCuentaDatos`/`tiendaPedido`. |
| New / updated tests (pgTAP) | `supabase/tests/database/tienda_cierre_hallazgos.test.sql` | not-run | No hay Postgres ni Docker en este nodo. Queda para el job `database` del CI (64 aserciones). |
| Lint / type-check | `pnpm --filter @platform/web lint` | pass | Código 0; solo avisos preexistentes de `oxlint` y **ninguno** en los archivos que la historia toca. |
| Build | `pnpm build` (`tsc -b` + `vite build`) | pass | Sin errores de tipos ni de build (`✓ built in 5.34s`). |
| Guard de migraciones | `node scripts/verificar-migraciones.mjs --base origin/dokploy --estricto` | pass | Código 0: 757 archivos, 4 nuevos contra `origin/dokploy`; versiones `20270507170001` a `20270507170004`, por encima del máximo real de la base (`20270507170000`, que entró con el merge del PR #1124). |
| Documentación | `pnpm docs:check` | pass | Documentación de cambios OK (4047 archivos comparados); migraciones OK (757 archivos, 4 nuevos); trampas conocidas OK (4 migraciones y 2 pruebas pgTAP revisados). |
| DER de la spec | `node scripts/verificar-der.mjs specs/20270306-100000-tienda-compra-y-cuentas/spec.md` | pass | DER OK (la columna alterada está marcada). |
| Matriz pantalla↔criterios | `pnpm matriz:check` | pass | 0 specs nuevas revisadas (esta historia no agrega pantallas). |
| Calidad | `pnpm calidad:code` | pass | `oxlint`, `knip`, `jscpd`, `dependency-cruiser` y `syncpack` en OK; `gitleaks` **saltado** (necesita Docker, que en este nodo da «permission denied»). |
| Equivalencia de cuerpos | Comparación carácter a carácter entre los cuerpos de `20270507170004` y sus migraciones de origen | pass | `enviar_lista_pedido` y `crear_presupuesto_tienda` son idénticos salvo las dos constantes de caracteres. Las cinco RPC de `20270507170003` difieren de las vigentes solo por el cupo, el bloque anidado y `stable` → `volatile`. `fusionar_clientes` de `20270507170002` es el vigente más los dos `update` que repuntan. |
| Correcciones del CI (2026-11-17) | Logs de los jobs `application`, `database` y `validacion` del PR #1128 | pass | El CI en rojo señalaba cuatro cosas, todas corregidas en este commit: (a) `application`: las cuatro migraciones tenían versión `REUSADA` (por debajo del máximo de `dokploy`) → renumeradas a `20270507170001`–`20270507170004`; (b) `database`: el pgTAP del cierre moría en la línea 46 con «duplicate key … existencias_pkey» (el trigger `productos_crear_existencias` ya deja una fila por producto) → el fixture ahora hace `on conflict (producto_id) do update`; (c) `database`: `tienda_favoritos.test.sql` fallaba 20 de 111 (la ráfaga de 203 favoritos chocaba con el cupo nuevo de 120 por minuto) → el test sube el cupo **dentro de su transacción**, igual que hacía el PR #965; (d) `database`: `tienda_menores_revision.test.sql` fallaba la prueba 50 (el comentario de `mis_compras_por_dominio` perdía el «DEFENSA EN PROFUNDIDAD») → los comentarios de las ocho funciones redefinidas reproducen los de la base y suman la nota del hallazgo. |

## Output Excerpts

```
 Test Files  8 passed (8)
      Tests  142 passed (142)
```

```
 Test Files  12 passed (12)
      Tests  188 passed (188)
```

```
Migraciones OK: 757 archivo(s), 4 nuevo(s) contra origin/dokploy.
Trampas conocidas: OK (4 migración(es), 2 prueba(s) pgTAP y 0 E2E revisados contra origin/dokploy).
```

```
Documentación de cambios: OK (4047 archivos comparados contra 54ea7b1bad793d5968ffe2d1f629128c40f3bee3).
```

```
✓ built in 5.34s
```

```
✅ specs/20270306-100000-tienda-compra-y-cuentas/spec.md: DER OK
```

```
Matriz pantalla↔criterios: OK (0 specs nuevas revisadas, 0 exentas).
```

## Residual Risks

- **El pgTAP no se ejecutó localmente** (sin Postgres ni Docker en este nodo): si algún detalle de la base difiere de lo asumido, el
  job `database` del CI lo detecta. Los puntos más expuestos son: (a) el orden de los cascades al borrar la organización (el pgTAP
  exige que la baja **no** se bloquee) y (b) el conteo de filas de `dominio.presupuestos_tienda` tras la fusión y la baja del usuario de
  Auth (3 vínculos sin cuenta).
- El cupo de `crear_presupuesto_tienda` es de 10 por minuto (real): el pgTAP lo sube a 100 **solo dentro de su transacción** para
  poder hacer la ráfaga de H-6; el valor real no cambia.
- La migración `20270507170001` cambia la regla de borrado de tres FK de `dominio.presupuestos_tienda`: es el punto de la historia que
  toca datos. Su reversión está documentada en el propio archivo (FK de la cuenta a `cascade`, las otras dos a `no action` y
  `set not null` en la columna).
- H-1 (hash de IP reversible) no se corrige: queda trazado como **MSF-945**.
- `gitleaks` no se pudo correr en este nodo: el CI lo corre.

## Recommendation

Cerrar la historia como **aplicada y verificada en el código**, dejando la confirmación del pgTAP al job `database` del CI: si el job
`database` sale en verde, el fix queda verificado end-to-end y se puede pedir la revisión de seguridad (el diff toca RLS/FK/migraciones:
revisión completa). Si el job `database` falla, el arreglo es acotado (un ajuste del fixture del pgTAP, no del código de producción).
