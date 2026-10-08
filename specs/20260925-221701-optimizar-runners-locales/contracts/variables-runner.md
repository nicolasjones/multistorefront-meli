# Contrato: variables de entorno del runner

Se leen del `.env` del repositorio (`pnpm dev:runner` pasa `--env-file .env`).
Ninguna es secreta; todas tienen default y figuran en `.env.example`.

| Variable | Default | Valores válidos | Efecto |
|----------|---------|-----------------|--------|
| `RUNNER_REPLICAS` | `3` | entero ≥ 0 | Cantidad de contenedores runner del repo. `0` no levanta ninguno. Un texto o negativo hace fallar `docker compose` al interpolar. |
| `RUNNER_MEMORY_LIMIT` | ver `research.md` R5 | tamaño Docker (`3g`, `2048m`) | Tope de memoria de cada réplica (no de los contenedores que lanza el job). Un valor inválido hace fallar `docker compose`. |
| `RUNNER_PNPM_STORE_VOLUME` | `platform-runner-pnpm-store` | nombre de volumen Docker | Volumen del store de pnpm. Mismo nombre en varios productos = store compartido en la máquina; otro nombre = store aislado. |
| `RUNNER_PNPM_NETWORK_CONCURRENCY` | `16` | entero ≥ 1 | Descargas simultáneas de cada `pnpm install` en el runner. |

Fijadas en el entorno del contenedor (no configurables por `.env`, heredadas
por cada step de los jobs):

| Variable | Valor | Motivo |
|----------|-------|--------|
| `pnpm_config_store_dir` | `/pnpm/store` | Gana sobre `$PNPM_HOME/store` que implica `pnpm/action-setup`. |
| `pnpm_config_cache_dir` | `/pnpm/cache` | R2b: metadata y verificación del lockfile compartidas. |
| `pnpm_config_network_concurrency` | `${RUNNER_PNPM_NETWORK_CONCURRENCY:-16}` | R4. |
| `pnpm_config_fetch_retries` | `5` | R4: reintentar `ECONNRESET` y cortes transitorios. |
| `pnpm_config_fetch_timeout` | `600000` | R4b: que un tarball grande (binario de Supabase, 57 MB) termine de bajar en un Wi-Fi lento y quede en el store. |
