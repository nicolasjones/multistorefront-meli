# Bug Verification: los flows plantilla reintentan un worker con credencial inválida

- **Slug**: reintentos-credencial-invalida
- **Tested**: 2026-09-26
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

La reproducción del assessment (credencial inválida por las plantillas en el
Kestra real del template) ya no relanza el worker: un solo intento de
`despacho_ssh` y un solo lanzamiento, en el genérico y en el dedicado. Un
reintento técnico posterior a que el worker cerró su ejecución (caso Xubio)
no vuelve a abrir sesión, y las fallas técnicas siguen con sus 3 intentos.
Sin regresiones en pgTAP ni en los estáticos.

## Checks Performed

Stack de desarrollo del template (Kestra `:8082`, Supabase `:5434`), en
ventanas sin CI viejo del producto.

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproducción antes del arreglo | `pnpm test:kestra:reintentos:e2e` con flows y fixture de `main` | fail (esperado) | `despacho_ssh tuvo 3 intentos` (ejecución `J6sucZlgFg1MMBVTPskcg`). |
| Reproducción después | `pnpm test:kestra:reintentos:e2e` | pass | 6 escenarios; detalle abajo. |
| Estáticos nuevos | `node --test infra/kestra/validar-reintentos-flows.test.mjs infra/kestra/validar-evidencia-flows.test.mjs` | pass | 11/11 (0/6 antes del arreglo). |
| pgTAP nuevo | `ejecucion_en_curso_worker.test.sql` | pass | 21/21 (antes: `not ok 1..2`, funciones inexistentes). |
| pgTAP completo | `pnpm test:db` | pass | 13 archivos, 427 pruebas. |
| Runtime del fixture | `node infra/kestra/validar-workers-runtime.mjs --execute` | pass | 100 corridas, `invalid-credential` → 78. |
| Publicación de flows | `pnpm test:kestra:deploy-flow` | pass | 4/4. |
| Compose / catálogo / docs | `pnpm infra:config:kestra`, `template:capabilities:check --base origin/main`, `template:adoption:check`, `test:template:adoption`, `docs:check` | pass | Tras integrar `main` (capacidad `isolated-ci-database`). |
| Residuos | SQL y `docker ps` | pass | 0 organizaciones `fixture-reint*`, 0 ejecuciones `en_curso`, 0 contenedores. |
| Lint / build web | `pnpm lint`, `pnpm build` | skipped | No se tocó código de `apps/web`. |

Escenarios del E2E:

| Escenario | Resultado |
|-----------|-----------|
| Genérico, credencial inválida | 1 intento, 1 lanzamiento, `no_reintentable=CREDENCIAL_INVALIDA`, `resolver_resultado_despacho` FAILED en 1 intento, el handler recibe `CREDENCIAL_INVALIDA:<conexion>`. La clasificación del genérico no se asevera (defecto preexistente, ver fix.md). |
| Dedicado, credencial inválida | Igual, clasificada `credencial`, conexión `credencial_invalida`. |
| Dedicado, técnica que cierra su ejecución | 2 intentos: el primero cierra y falla técnico; el segundo verifica `en_curso` → `EJECUCION_NO_EN_CURSO` sin llegar a `sesion`. Ejecución `fallida/FALLA_TECNICA_SANITIZADA`. |
| Dedicado, éxito con `EJECUCION_ID` en curso | SUCCESS en 1 intento; eventos con `ejecucion = EJECUCION_ID`. |
| Worker de otra organización | `private.ejecucion_worker_en_curso` → `NO_AUTORIZADO`. |
| Dedicado, falla técnica | 3 intentos (retry conservado), clasificada técnica. |

## Output Excerpts

```
Genérico: credencial inválida...          generico-credencial: ejecución 1g8UCCCYy4NuxohJK5Yx6b
Dedicado: credencial inválida...          dedicado-credencial: ejecución 5MrKnJ8Y9fCxuOr2CxVT4m
Dedicado: falla técnica que cierra la ejecución (caso Xubio)...  3ukyuSinX9xVWqghHGtKM6
Dedicado: éxito con ejecución en curso... 7VilGuLWDf5fM6mmpNFYVA
Dedicado: falla técnica transitoria (el retry se conserva)...  3kMvHOAV6WDuZh74LiOJPZ
OK: reintentos validados en ejecuciones reales sin apariciones del centinela.
Files=13, Tests=427 ... Result: PASS
```

## Incidencias durante la verificación

- El CI viejo del producto (corridas sin el CI aislado) reseteó dos veces la
  base 5434 con el esquema del producto (23:29–23:35 y 23:42–23:49 UTC). Se
  restauró con backup previo (`C:/Users/Nico/backups-template-dev/`) y el
  procedimiento de `scripts/reset-db-ci.mjs`, no con `supabase db reset`.
- Ese procedimiento recrea `public` sin el `USAGE` de fábrica para
  `PUBLIC`/`anon`: el rol `worker_*` no podía llamar funciones de `public`.
  Se restauró el grant a mano; ver Residual Risks.
- La verificación destapó un error del fixture (ver commit 31eb6a5): trataba
  cualquier error de la consulta de verificación como
  `EJECUCION_NO_EN_CURSO`; ahora solo una respuesta `f`, y el contrato lo
  explicita.
- Kestra se quedó sin heap al publicar el genérico en 2 de 8 publicaciones de
  la estructura final (ver fix.md); la corrida válida se hizo tras un
  reinicio.

## Residual Risks

- Clasificación del genérico rota (preexistente) y agotamiento intermitente
  de heap de Kestra al publicarlo: bug aparte.
- `scripts/reset-db-ci.mjs` crea `public` sin `USAGE` para `PUBLIC`/`anon`;
  en CI no afecta a pgTAP, pero una base restaurada así no sirve para E2E de
  workers. Mejora aparte.
- Los workers reales de productos (Xubio, Colppy) siguen saliendo con 1: la
  marca `CREDENCIAL_INVALIDA:` los cubre, pero la verificación `en_curso` y el
  código 78 requieren adoptarlos en cada worker.

## Recommendation

Cerrar el bug: verificado de punta a punta en el Kestra y el Supabase del
template. Mergear antes que #61 (`conexion-invalida-trabada`), que depende de
este corte de reintentos.
