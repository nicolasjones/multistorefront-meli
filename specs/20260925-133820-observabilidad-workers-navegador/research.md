# Research: Observabilidad de plataforma para workers de navegador

Las decisiones R1–R5 se verificaron con un spike descartable en el Kestra
local del template (`kestra/kestra:v1.3.35`, `plugin-fs 2.11.1`, clave de
orquestación ed25519, host SSH fixture de la spec 014). El spike se borró.

## R1 — Dónde escribe el worker sus capturas

- **Decision**: con evidencia habilitada, el despacho crea en el host
  `<EVIDENCIA_DIR_HOST>/<execution.id>/<organizacion_id>/` (permisos `0777`
  en la hoja, base `0700` del usuario de despacho) y la monta en el worker
  como `/evidencia`, única escritura adicional al rootfs `--read-only`. El
  worker recibe `EVIDENCIA_DIR=/evidencia`.
- **Rationale**: el daemon resuelve el bind mount con la misma ruta que ve el
  usuario SSH (verificado también a través del fixture que monta el socket
  Docker, siempre que monte la base con la misma ruta absoluta). Una hoja
  `0777` dentro de una base `0700` deja escribir a cualquier UID no root de la
  imagen sin exponer la evidencia a otros usuarios del host.
- **Alternatives considered**: `docker cp` desde un volumen anónimo (obliga a
  cambiar el Dockerfile y la capacidad `worker-image-security`); `--user` del
  usuario SSH (rompe imágenes que dependen de su propio usuario); subir a
  Supabase Storage desde el worker (mezcla evidencia visual con el bucket de
  auditoría de la spec 016 y no la deja en Kestra).

## R2 — Cómo llegan las capturas a los outputs de Kestra

- **Decision**: `io.kestra.plugin.fs.sftp.Downloads` en el bloque `finally`
  de la secuencia de despacho, con `rootDir: false`, `action: DELETE` y
  `maxFiles` acotado; `runIf` según la evidencia efectiva; `allowFailure` +
  `allowWarning` para que un fallo de publicación no cambie el estado.
- **Rationale**: el output `outputFiles` queda en la pestaña Outputs con
  vista previa y descarga; `DELETE` deja el host sin copia (FR-008); `finally`
  corre en éxito y en error. Verificado: la clave ed25519 funciona con sftp y
  `rootDir` por defecto (`true`) resuelve rutas relativas al home, por eso se
  fija en `false`.
- **Alternatives considered**: imprimir binarios por stdout (prohibido);
  flow outputs a nivel de flow (no cubren iteraciones del `ForEach`).

## R3 — Cómo se publican los logs como output

- **Decision**: `io.kestra.plugin.core.log.Fetch` con `tasksId:
  [despacho_ssh]` en el `finally` a nivel de flow; produce un archivo con los
  logs del despacho (incluidos los eventos JSON) como output de la ejecución.
- **Rationale**: no exige nada nuevo al worker; los logs ya están sanitizados
  por contrato y Kestra los conserva igual. En el genérico, un único `Fetch`
  al final reúne todas las organizaciones (cada línea conserva su
  `taskRunId`).
- **Alternatives considered**: que el worker escriba `eventos.jsonl` en la
  carpeta de evidencia (duplica stdout y solo existiría con evidencia
  habilitada); `tee` en el comando SSH (pierde el código de salida sin
  `pipefail` portable).

## R4 — Limpieza de evidencia vencida

- **Decision**: flow `limpieza-evidencia` programado diariamente con
  `io.kestra.plugin.core.execution.PurgeExecutions` en modo solo storage
  (`purgeExecution`, `purgeLog` y `purgeMetric` en `false`, `purgeStorage:
  true`), estados terminales y `endDate = now - EVIDENCIA_RETENCION_DIAS`,
  sobre el prefijo de namespace de los flows de despacho.
- **Rationale**: verificado: la primera corrida borró 8 archivos y la segunda
  0 (idempotente); la ejecución y sus 13 logs quedaron consultables. No toca
  Supabase: la auditoría (`ejecuciones_worker`) y el bucket
  `evidencias-ejecuciones` de la spec 016 quedan fuera de su alcance.
- **Consecuencia documentada**: purga todo el almacenamiento interno de las
  ejecuciones del prefijo; por contrato, los flows de despacho no guardan
  datos de negocio en el almacenamiento interno de Kestra. El archivo de logs
  publicado vence junto con la evidencia; los logs de Kestra no.
- **Alternatives considered**: `find -delete` en cada host desde el flow
  (requiere enumerar hosts de todas las organizaciones); retención nativa
  global de Kestra (afecta a todos los flows y no es por entorno de evidencia).

## R5 — Residuos en el host de despacho

- **Decision**: además del `DELETE` tras la descarga, cada despacho con
  evidencia borra en su host los directorios de ejecución más antiguos que el
  plazo (`find -mindepth 1 -maxdepth 1 -type d -mtime +N`).
- **Rationale**: cubre descargas fallidas sin un flow que conozca todos los
  hosts; un host que ya no despacha no genera evidencia nueva.

## R6 — Dónde vive la configuración

- **Decision**: `EVIDENCIA_VISUAL` (default `false`),
  `EVIDENCIA_RETENCION_DIAS` (default `30`) y `EVIDENCIA_DIR_HOST` (default
  `/var/lib/automation-platform/evidencia`) son variables de Kestra por
  entorno (`ENV_*` en `infra/kestra/compose.yaml`). Las plantillas aceptan un
  input opcional `evidencia_visual` que, si se informa, reemplaza el valor del
  entorno para esa ejecución.
- **Rationale**: un único lugar por entorno; el override permite diagnosticar
  una ejecución puntual y validar el E2E sin reiniciar Kestra. El worker solo
  recibe `EVIDENCIA_VISUAL` y `EVIDENCIA_DIR`: la retención es de plataforma.

## R7 — Estado de negocio intacto

- **Decision**: ningún mensaje de evidencia del despacho va a stderr
  (`warningOnStdErr` convertiría el éxito en `WARNING`); si la carpeta no se
  puede preparar, el despacho imprime un evento JSON `evidencia/fallida` en
  stdout y sigue sin montar nada. Las tareas de publicación usan
  `allowFailure` + `allowWarning`.

## R8 — Diferencias con el contrato del producto de origen

El README del producto definía una línea JSON por hito con nombres de etapa
de negocio, sin campos fijos ni ubicación de capturas. Este contrato:

1. Fija los campos `etapa`, `estado`, `timestamp`, `ejecucion`, `mensaje` y
   los valores de `estado`.
2. Fija la ubicación de capturas (`EVIDENCIA_DIR`, montada por la plataforma)
   y el formato de nombre de archivo.
3. Saca la retención del worker: `EVIDENCIA_RETENCION_DIAS` la aplica la
   plataforma; el worker no borra evidencia.
4. Deja los nombres de etapa a cada producto.

El producto debe adaptar su logger a estos campos al adoptar la versión.
