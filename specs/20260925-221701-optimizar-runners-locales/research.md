# Research: Runners locales que no saturan la red ni la memoria

Fuentes: inspección de los runners en marcha del template el 2026-09-25
(`docker exec` sobre `automation-platform-template-runner-dev-runner-*`), el
código de pnpm 11.19.0 instalado en la imagen (`/usr/lib/node_modules/pnpm/dist`)
y pruebas de `docker compose config`.

## R1. Dónde vive hoy el store y por qué cada réplica descarga todo

- **Hallazgo**: en los jobs, `pnpm/action-setup` exporta `PNPM_HOME=/root/setup-pnpm/node_modules/.bin`
  y pnpm usa `$PNPM_HOME/store/v11` como store. Medido: 82 MB, 262 MB y 323 MB
  en las réplicas 1, 2 y 3 — cada una con su copia, dentro de la capa del
  contenedor (se pierde al recrearlo). `/root/.local/share/pnpm/store` solo
  tiene restos de un store `v3` viejo.
- **Decisión**: montar un volumen con nombre en `/pnpm` y fijar
  `pnpm_config_store_dir=/pnpm/store` y `pnpm_config_cache_dir=/pnpm/cache`
  (ver R2b) en el entorno del contenedor runner.
- **Por qué**: pnpm 11 lee su configuración de variables `pnpm_config_*`
  (las `npm_config_*` ya no aplican a opciones de pnpm). Probado en el
  contenedor: con `PNPM_HOME` fijado como lo deja `action-setup`,
  `pnpm_config_store_dir=/tmp/b pnpm store path` devuelve `/tmp/b/v11`, o sea
  la variable gana sobre `PNPM_HOME`. El runner de GitHub hereda el entorno del
  contenedor a cada step, así que no hace falta tocar `validate.yml`.
- **Alternativas descartadas**: montar el volumen en `$PNPM_HOME/store`
  (depende de un detalle interno de `action-setup` que puede cambiar);
  `store-dir` en `pnpm-workspace.yaml` (afectaría el desarrollo local fuera
  del runner); `cache: pnpm` de `setup-node` o `actions/cache` (guardan en el
  storage de GitHub — descartado de antemano, ver `docs/ci-self-hosted-storage.md`).

## R2. ¿Es seguro que varias réplicas (y varios repos) usen el mismo store a la vez?

Sí, con dos límites. Verificado en el código de pnpm 11.19.0:

1. **Archivos de contenido** (`files/`): son direccionados por hash. La
   escritura (`writeBufferToCafs` → `writeOrCheck`) crea el archivo con
   `flag: "wx"` (exclusivo); si otro proceso ya lo creó (`EEXIST`) verifica su
   integridad y, si no coincide (por ejemplo, porque el otro todavía estaba
   escribiendo), lo reescribe de forma atómica: archivo temporal + `rename`.
   Dos escritores del mismo archivo escriben los mismos bytes, así que el
   resultado final es siempre el contenido correcto. Además, pnpm verifica la
   integridad del archivo al importarlo en `node_modules`
   (`verify-store-integrity`, activo por defecto) y lo vuelve a bajar si está
   dañado.
2. **Índice** (`index.db`): en pnpm 11 es SQLite en modo `journal_mode=WAL`
   con `busy_timeout=5000`, pensado para varios procesos pnpm a la vez. SQLite
   coordina con locks POSIX y memoria compartida (`index.db-shm`), que
   funcionan entre contenedores porque comparten el kernel del host y el
   volumen es local.
3. **Detalle entre contenedores**: el nombre del temporal usa `pid + threadId`;
   en contenedores distintos dos procesos pueden tener el mismo PID. Solo
   importa si ambos reescriben el mismo archivo a la vez, y aun así escriben
   bytes idénticos: el peor caso es un archivo transitoriamente incompleto que
   la verificación de integridad detecta y reescribe. Riesgo aceptado.

**Límites (documentados en `docs/deployment.md`)**:

- El volumen tiene que ser un volumen local de Docker (o un disco local del
  host Linux). **No** una carpeta de Windows montada ni un sistema de archivos
  de red: ahí los locks de SQLite y el `rename` atómico no son confiables.
- `pnpm store prune` **no** es seguro con instalaciones en curso (borra
  archivos que otra instalación puede estar por enlazar). Se corre a mano con
  todos los runners sin jobs (o detenidos), nunca automático.

**Compartir entre productos**: por defecto el volumen tiene nombre fijo
(`platform-runner-pnpm-store`), igual en todos los productos que adopten la
capacidad, así una dependencia se baja una sola vez por máquina. No amplía la
confianza: los runners ya montan `/var/run/docker.sock` (equivalente a root en
el host) y todos los repositorios son del mismo operador. Quien quiera aislar
un producto fija `RUNNER_PNPM_STORE_VOLUME` con otro nombre.

## R2b. Caché de metadata y verificación del lockfile

- **Hallazgo**: aun con el store completo, cada install de pnpm 11 corre
  "Verifying lockfile against supply-chain policies (367 entries)": pide la
  metadata de cada paquete al registro (por `minimum-release-age`, 1 día por
  defecto). En la prueba con la red saturada llevó ~2 min 40 s y tuvo
  `ECONNRESET`. El resultado se cachea por hash del lockfile en
  `<cache-dir>/lockfile-verified.jsonl`, y la metadata en `<cache-dir>/`, que
  por defecto es `~/.cache/pnpm` de cada contenedor.
- **Decisión**: compartir también el cache dir en el mismo volumen
  (`/pnpm/cache`). Con el caché compartido, el install siguiente mostró
  "✓ Lockfile passes supply-chain policies (verified 9m ago)" sin consultas.
- **Seguridad concurrente** (código de pnpm 11.19.0): la metadata se escribe
  con temporal + `renameOverwrite` y es best-effort (un error solo se loguea en
  debug); `lockfile-verified.jsonl` se escribe con `appendFileSync` de una
  línea, la lectura ignora líneas que no parsean y la compactación escribe un
  temporal y hace `rename`. Una carrera en el peor caso pierde un registro y
  repite la verificación una vez.

## R2c. Prueba de concurrencia real

Tres contenedores con la imagen del runner (PID namespaces separados, como
las réplicas) instalando el lockfile del repo a la vez contra un volumen de
prueba:

| Escenario | Resultado |
|-----------|-----------|
| Store vacío, 3 en paralelo | los 3 terminaron con `RC=0` (dos mostraron `downloaded 316/315`; 12–15 min por la red saturada y el binario de R4b) |
| Store lleno sin caché compartido, 3 en paralelo | 3 × `reused 316, downloaded 0`, pero ~10 min cada uno (verificación R2b + reintentos R4b) |
| Store y caché llenos, con R4b, 3 en paralelo | 3 × `reused 317, downloaded 0`, 0 consultas al registro, 16–17 s cada uno |
| `pnpm store status` después | "Packages in the store are untouched", RC 0 |

## R3. Enlaces duros vs. copia

- **Hallazgo**: el directorio de trabajo del job (`/home/runner/_work`) queda
  en la capa del contenedor y el store en otro volumen: son sistemas de
  archivos distintos, así que pnpm no puede usar enlaces duros y
  `package-import-method=auto` cae a copia.
- **Decisión**: aceptar la copia. Copiar desde disco local es mucho más barato
  que descargar por Wi-Fi, y evita tener que mover `_work` a un volumen (que
  además quedaría compartido o habría que declarar uno por réplica, cosa que
  Compose con `replicas` no permite).
- **Medición**: tiempos de instalación de las corridas en `quickstart.md` y en
  el PR.

## R4. Concurrencia de red y reintentos

- **Hallazgo**: pnpm 11 calcula la concurrencia de descarga como
  `min(96, max(workers × 3, 64))` → 64 en esta máquina de 12 núcleos, y
  `maxsockets = network-concurrency × 3`. Con tres réplicas y dos repos, hasta
  ~380 descargas simultáneas sobre el mismo Wi-Fi. `fetch-retries` por
  defecto es 2. El propio pnpm sugiere, ante `ECONNRESET`, bajar
  `network-concurrency` y subir `fetch-retries`.
- **Decisión**: `pnpm_config_network_concurrency=${RUNNER_PNPM_NETWORK_CONCURRENCY:-16}`
  y `pnpm_config_fetch_retries=5` en el entorno del runner.
- **Por qué**: 16 era el valor por defecto de pnpm antes de la heurística por
  núcleos y sigue siendo el fallback interno (`pLimit(networkConcurrency ?? 16)`).
  Con el store compartido la concurrencia solo pesa en instalaciones en frío o
  con dependencias nuevas; el costo de bajarla es poco.
- **Alternativas**: 1 (lo que sugiere pnpm como último recurso: demasiado
  lento en frío); fijarlo en `pnpm-workspace.yaml` (afectaría también a
  instalaciones locales con buena red).

### R4b. Timeout de descarga: el binario de Supabase nunca llegaba al store

- **Hallazgo** (prueba local y corrida base): `@supabase/cli-linux-x64`
  (dependencia opcional del paquete `supabase`) pesa 57 MB. A la velocidad
  medida esa noche (0,58 MB/s, 99 s) supera el `fetch-timeout` de 60 s de pnpm
  ("error (23) The operation was aborted due to timeout"). Como es opcional,
  pnpm termina el install sin él, así que **nunca queda en el store** y cada
  install de cada réplica lo vuelve a intentar: ~2 min perdidos por install con
  los reintentos por defecto, ~8 min con 5, más decenas de MB parciales por
  intento. En la corrida base falló en los dos jobs.
- **Decisión**: `pnpm_config_fetch_timeout=600000` (10 min). Probado: el
  primer install lo bajó (`downloaded 1`, 1 min 20 s) y el siguiente tardó
  7,3 s con `reused 317, downloaded 0`.
- **Alternativa descartada**: excluir dependencias opcionales en el CI; cambia
  el árbol instalado respecto del desarrollo y es una decisión del repositorio,
  no del runner.

## R5. Tope de memoria por contenedor

- **Medición**: muestreo de `docker stats` cada 2 s sobre las tres réplicas
  del template durante corridas reales del CI (ver tabla abajo).
- **Decisión**: `deploy.resources.limits.memory: ${RUNNER_MEMORY_LIMIT:-<valor>}`
  con el pico observado + ~50 %, redondeado hacia arriba a GiB.
- **Qué cubre y qué no**: limita lo que corre dentro del runner (pnpm, `tsc`,
  `vite build`, `vitest`, `pg_prove`). Los contenedores que un job levanta por
  el socket de Docker (stack de Supabase del CI) corren fuera y no cuentan.
- **Si un job lo supera**: el OOM killer del kernel mata el proceso más
  grande (el del job, no el runner); el step falla con código 137 y el runner
  sigue registrado. Si muriera el runner, `restart: unless-stopped` lo
  levanta y el entrypoint lo vuelve a registrar.

Muestreo del 2026-09-25 22:19–22:44 (978 muestras), cubriendo la corrida base
36207983612 del PR (application con lint, build y vitest; infrastructure;
database) y jobs de otros PRs:

| Réplica | Pico observado | Momento |
|---------|----------------|---------|
| runner-1 | 1502 MiB | 22:20:58 |
| runner-2 | 1378 MiB | 22:42:27 |
| runner-3 | 1437 MiB | 22:27:48 |

Pico 1,47 GiB × 1,5 ≈ 2,2 GiB → **default `3g`**. Tres réplicas suman como
máximo 9 GiB de los 15,5 GiB que ve Docker, frente a "sin límite" antes.

## R6. Réplicas configurables

- **Decisión**: `deploy.replicas: ${RUNNER_REPLICAS:-3}`.
- **Probado con `docker compose config`**: sin variable → 3; `0` → 0 (válido:
  no levanta runners de ese repo); `abc` → error `failed to cast to expected
  type`; `-1` → error `must be greater than or equal to 0`; tope de memoria
  `xx` → error `invalid size`. Los valores inválidos fallan de forma visible.
- **Cuándo bajarla**: ver `docs/deployment.md`. Con 1 réplica los jobs de un
  PR corren en serie (application → infrastructure → database) y el CI tarda
  más, pero la máquina solo ejecuta un job de ese repo a la vez.

## R7. Publicación como capacidad

- **Decisión**: capacidad nueva `local-ci-runners` 1.0.0 con ruta
  `infra/runner/compose.yaml`, y guía `docs/adoptar-runners-locales.md`.
  `infra/runner/entrypoint.mjs` sigue perteneciendo a
  `portable-typescript-tooling` y no cambia.
- **Por qué nueva y no versión de otra**: ninguna capacidad publicada cubre
  la configuración de los runners; `isolated-ci-database` es la base del CI,
  no el runner.
