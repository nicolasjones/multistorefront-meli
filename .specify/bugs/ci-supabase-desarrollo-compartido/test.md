# Bug Verification: el job `database` del CI resetea el Supabase de desarrollo

- **Slug**: ci-supabase-desarrollo-compartido
- **Tested**: 2026-09-25
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

Con el fix, el job `database` del template levanta y usa
`ci-automation-platform-template` (base en 25434) y no envía ninguna
sentencia a la base de desarrollo del template (5434). Una tabla centinela
creada en 5434 sobrevivió a una corrida completa del job. Durante la prueba,
el CI del **producto**, que todavía no adoptó el fix, borró la centinela tres
veces: el bug se reprodujo en vivo del lado que falta corregir.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproducción (post-fix, template) | Centinela `public.centinela_ci_stack_aislado` en 5434 → re-ejecución del job `database` (run 36173668738, job 108201856561) → consulta de la centinela | pass | La centinela (id 5, 18:36:52 UTC) sigue ahí después del job (18:39:29 UTC) |
| Sin tráfico hacia desarrollo | `docker logs` del contenedor de desarrollo (log_statement=all) desde la creación de la centinela | pass | 0 sentencias desde el gateway Docker (172.21.0.1); el `drop schema` del reset aparece en `supabase_db_ci-automation-platform-template` a las 18:39:21 |
| Primer arranque del stack de CI | Run 36173668738, primer intento | pass | `start` real: 41 s; reset en 25434 a las 18:35:35; 0 sentencias hacia 5434 en la ventana 18:34:50–18:35:45 |
| Stack persistente entre corridas | Re-ejecución del mismo job | pass | `supabase start is already running`; paso de arranque de 3 s |
| Guarda | `node --test scripts/supabase-ci.test.mjs` (local y en CI) + guarda real contra Docker | pass | 10/10. Localmente, `SUPABASE_DB_PORT=5434` aborta y el reset sin stack de CI aborta antes de conectar |
| pgTAP en el stack de CI | `pnpm test:db:ci` | pass | `Files=12, Tests=406 … Result: PASS` |
| Contenedores de desarrollo intactos | `docker inspect` StartedAt / `pg_postmaster_start_time()` | pass | Template y producto: `12:34:48Z`, sin reinicios |
| Regresión del resto del CI | Jobs `application` e `infrastructure` del run 36173668738 | pass | En el run 36171526916 fallaron por descargas de npm (`error (23)`), sin relación con el cambio |
| Catálogo/adopción/docs | `template:capabilities:check`, `template:adoption:check`, `test:template:adoption`, `docs:check` | pass | Después de integrar `main` (conflicto con `embedded-analytics-runtime` resuelto conservando ambas capacidades) |
| Limpieza | `drop table public.centinela_ci_stack_aislado` en 5434 | done | 0 tablas `centinela%` restantes |

## Output Excerpts

```text
Stack de CI: ci-automation-platform-template (base en el puerto 25434, workdir …/.supabase-ci).
Puente 127.0.0.1:25434 → host.docker.internal:25434 activo.
supabase start is already running.
Destino verificado: ci-automation-platform-template en el puerto 25434.
All tests successful.
Files=12, Tests=406
Result: PASS
```

Centinela después del job:

```text
5|2026-09-25 18:36:52.677739+00
postmaster|2026-09-25 12:34:58.681533+00   (sin reinicio)
```

`drop schema public/private/dominio` sobre 5434 durante la prueba, todos
desde el gateway Docker, ninguno del template:

| Hora (UTC) | Origen | Corrida |
|------------|--------|---------|
| 18:02:54 | CI del producto, rama `bug-credencial-en-error` | `db:reset:ci` 18:02:52 (run 36169984823) |
| 18:16:43 | CI del producto, rama `bug-credencial-en-error` | `db:reset:ci` 18:16:41 |
| 18:31:47 | CI del producto, rama `arreglo-superset-embebido` | `db:reset:ci` 18:31:46 |

Hubo además resets locales (`[local]`, 18:07:14) del E2E del worktree
observabilidad-plataforma, ajenos al CI.

Intentos fallidos durante la validación (ver `fix.md`): run 36170610204
(`ECONNREFUSED 127.0.0.1:25434` → puente) y run 36171526916 (PostgREST sin
`dominio` y health-check de Kong por 127.0.0.1 → se excluyen). En ninguno de
los dos se llegó al reset.

## Residual Risks

- **El producto sigue borrando la base de desarrollo del template** en cada
  PR hasta que adopte `isolated-ci-database` (`docs/adoptar-ci-base-aislada.md`).
  Esto sigue afectando al E2E del worktree observabilidad-plataforma.
- El stack del CI no relee `config.toml` mientras siga levantado; después de
  cambiarlo hay que correr `supabase stop --project-id ci-automation-platform-template --no-backup`.
- `concurrency` descarta las corridas pendientes más viejas del job `database`
  cuando hay varias en cola.
- No se validó en runners Linux nativos (sólo Docker Desktop). El puente y
  `host.docker.internal` dependen del `extra_hosts: host-gateway` que ya
  declara `infra/runner/compose.yaml`.

## Recommendation

Cerrar el bug en el template: verificado de punta a punta con una corrida
real, una centinela que sobrevivió y el log de sentencias de la base de
desarrollo. Mergear el PR #59 con `--no-ff` y adoptar la capacidad en
estudio-contable-automation cuanto antes, porque su CI es hoy quien borra la
base de desarrollo del template.
