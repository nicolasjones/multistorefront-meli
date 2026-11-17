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

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix) | `gh pr view 965 --json mergeable,mergeStateStatus` y `git merge-base --is-ancestor 4f22868d3 origin/dokploy` | pass | El PR #965 sigue `CONFLICTING` (no se toca: la entrega es un PR **nuevo** de esta rama, `fix/bug-MSF-988`, contra `dokploy`). El fix de esta rama sí está sobre `origin/dokploy` (4 migraciones nuevas + pgTAP + front + docs). |
| New / updated tests (front) | `vitest run src/lib/tiendaCuentaDatos.test.ts src/lib/tiendaPedido.test.ts src/pages/tienda-publica/cuenta/BotonFavorito.test.tsx` | pass | 71 pruebas en verde (3 archivos). |
| Regression suite (front) | `vitest run` de `tiendaOpiniones`, `favoritosSoloEnLaTienda`, `useListadoPorCursor`, `useFavoritosEntre` y la carpeta `cuenta` | pass | 87 pruebas en verde (6 archivos). Son los que dependen de `tiendaCuentaDatos`/`tiendaPedido`. |
| New / updated tests (pgTAP) | `supabase/tests/database/tienda_cierre_hallazgos.test.sql` | not-run | No hay Postgres ni Docker en este nodo. Queda para el job `database` del CI (55 aserciones). |
| Lint / type-check | `pnpm --filter @platform/web lint` | pass | Solo avisos preexistentes de `oxlint` en archivos que la historia no toca. |
| Build | `pnpm build` (`tsc -b` + `vite build`) | pass | Sin errores de tipos ni de build. |
| Guard de migraciones | `node scripts/verificar-migraciones.mjs --estricto` | pass | 754 archivos, 4 nuevos contra `origin/dokploy`; versiones `20270507140101` a `20270507140104`, por encima del máximo real de la base (`20270507140100`). |
| Documentación | `pnpm docs:check` | pass | Documentación de cambios OK; migraciones OK; trampas conocidas OK (4 migraciones y 1 pgTAP revisados). |
| DER de la spec | `node scripts/verificar-der.mjs specs/20270306-100000-tienda-compra-y-cuentas/spec.md` | pass | DER OK (la columna alterada está marcada). |
| Matriz pantalla↔criterios | `pnpm matriz:check` | pass | 0 specs nuevas revisadas (esta historia no agrega pantallas). |
| Calidad | `pnpm calidad` | partial | `oxlint`, `knip`, `jscpd`, `dependency-cruiser` y `syncpack` en OK; `gitleaks` no se pudo correr (necesita Docker). |
| Equivalencia de cuerpos | Comparación carácter a carácter entre los cuerpos de `20270507140104` y sus migraciones de origen | pass | `enviar_lista_pedido` y `crear_presupuesto_tienda` son idénticos salvo las dos constantes de caracteres. Las cinco RPC de `20270507140103` difieren de las vigentes solo por el cupo, el bloque anidado y `stable` → `volatile`. `fusionar_clientes` de `20270507140102` es el vigente más los dos `update` que repuntan. |

## Output Excerpts

```
 Test Files  3 passed (3)
      Tests  71 passed (71)
```

```
 Test Files  6 passed (6)
      Tests  87 passed (87)
```

```
Migraciones OK: 754 archivo(s), 4 nuevo(s) contra origin/dokploy.
Trampas conocidas: OK (4 migración(es), 1 prueba(s) pgTAP y 0 E2E revisados contra origin/dokploy).
```

```
✅ specs/20270306-100000-tienda-compra-y-cuentas/spec.md: DER OK
```

```
✓ built in 3.00s
```

## Residual Risks

- **El pgTAP no se ejecutó localmente** (sin Postgres ni Docker en este nodo): si algún detalle de la base difiere de lo asumido, el
  job `database` del CI lo detecta. Los puntos más expuestos son: (a) el orden de los cascades al borrar la organización (el pgTAP
  exige que la baja **no** se bloquee) y (b) el conteo de filas de `dominio.presupuestos_tienda` tras la fusión y la baja del usuario de
  Auth (3 vínculos sin cuenta).
- El cupo de `crear_presupuesto_tienda` es de 10 por minuto (real): el pgTAP lo sube a 100 **solo dentro de su transacción** para
  poder hacer la ráfaga de H-6; el valor real no cambia.
- La migración `20270507140101` cambia la regla de borrado de tres FK de `dominio.presupuestos_tienda`: es el punto de la historia que
  toca datos. Su reversión está documentada en el propio archivo (FK de la cuenta a `cascade`, las otras dos a `no action` y
  `set not null` en la columna).
- H-1 (hash de IP reversible) no se corrige: queda trazado como **MSF-945**.
- `gitleaks` no se pudo correr en este nodo: el CI lo corre.

## Recommendation

Cerrar la historia como **aplicada y verificada en el código**, dejando la confirmación del pgTAP al job `database` del CI: si el job
`database` sale en verde, el fix queda verificado end-to-end y se puede pedir la revisión de seguridad (el diff toca RLS/FK/migraciones:
revisión completa). Si el job `database` falla, el arreglo es acotado (un ajuste del fixture del pgTAP, no del código de producción).
