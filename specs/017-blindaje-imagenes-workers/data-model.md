# Modelo de datos y artefactos

Esta spec no agrega tablas ni migraciones de Supabase. El modelo describe artefactos y ejecuciones operativas que deben poder observarse y relacionarse.

## Worker

- `id`: nombre canónico de integración declarado por el producto derivado (por ejemplo `fixture`, o el nombre real de su primera integración).
- `package_name`: paquete del workspace asociado.
- `entrypoint`: proceso puntual que ejecuta y termina.
- `runtime_contract`: parámetros, secretos permitidos, códigos de salida y marcadores de error.

## Artefacto de ejecución

- `worker_id`: referencia al Worker.
- `source_commit`: commit que originó el build.
- `image_ref`: referencia de registry por repositorio y nombre de worker.
- `digest`: identificador inmutable del contenido publicado.
- `platform`: `linux/amd64`.
- `components`: inventario de componentes/SBOM.
- `provenance`: metadatos del workflow y del builder.
- `published_at`: timestamp de publicación.
- `retained_until`: fecha mínima hasta la que puede usarse para rollback.

## Ejecución

- `execution_id`: identificador aportado por Kestra o el consumidor.
- `worker_id` y `artifact_digest`: worker y versión exacta.
- `organizacion_id`: organización de la ejecución, nunca un valor inferido solo del log.
- `flow_id`: flow que la despachó.
- `input_ref`: referencia de entrada sanitizada, sin credenciales.
- `status`: `started`, `succeeded`, `failed`, `cancelled` o `timed_out`.
- `started_at`, `finished_at` y `exit_code`.
- `failure_marker`: marcador contractual sanitizado, por ejemplo `CREDENCIAL_INVALIDA`.
- `attempt`: número de intento para verificar idempotencia.

## Política de publicación

- `blocked_severities`: `critical`, `high`.
- `exception_ref`, `owner` y `expires_at` cuando exista una excepción.
- `registry_permissions`: actor que puede publicar y actores que solo pueden extraer.
- `rollback_window`: período que conserva al menos una versión anterior.

## Relaciones y estados

```text
Worker 1 ── N Artefacto de ejecución
Artefacto 1 ── N Ejecución
Política de publicación ── valida ──> Artefacto
```

Una ejecución solo puede marcarse como exitosa después de que el proceso finaliza con código cero y persiste su resultado idempotente. Un reintento conserva el mismo `execution_id` de negocio y aumenta `attempt`; no crea duplicados.
