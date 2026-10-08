# Quickstart: validar los runners optimizados

## 1. Configuración

```bash
pnpm infra:config
RUNNER_REPLICAS=1 docker compose -f infra/runner/compose.yaml config | grep replicas   # 1
RUNNER_REPLICAS=abc docker compose -f infra/runner/compose.yaml config                # falla
```

## 2. Recrear los runners sin cortar jobs

```bash
gh api repos/<owner>/<repo>/actions/runners \
  -q '.runners[] | select(.status=="online") | "\(.name) busy=\(.busy)"'
# Solo si ninguno tiene busy=true:
pnpm dev:runner
docker volume inspect platform-runner-pnpm-store
```

## 3. Entorno visto por los jobs

```bash
docker exec <proyecto>-runner-1 sh -c 'env | grep ^pnpm_config_'
docker inspect <proyecto>-runner-1 --format '{{.HostConfig.Memory}}'
```

## 4. Dos corridas del CI

1. Primera corrida del PR con los runners recreados (store vacío o parcial):
   en el log del step `pnpm install --frozen-lockfile`, la línea
   `Progress: resolved N, reused R, downloaded D, added A, done` muestra
   `D > 0`.
2. Re-ejecutar el workflow (`gh run rerun <id>`) sin cambiar el lockfile: la
   misma línea muestra `downloaded 0` en los jobs `application` y `database`,
   y el step dura menos.
3. Tamaño del store: `docker run --rm -v platform-runner-pnpm-store:/s busybox du -sh /s`.

Resultados de la validación de esta spec: ver `tasks.md` (fase de validación).
