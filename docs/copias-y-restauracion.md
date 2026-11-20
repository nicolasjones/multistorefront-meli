---
owner: operacion
sources:
  - specs/011-backups-postgres
  - specs/20261018-120000-operacion-copias-y-documentacion
  - infra/kestra/flows/respaldo-postgres.yml
  - infra/kestra/flows/respaldo-imagenes.yml
  - infra/kestra/flows/retencion-copias.yml
  - infra/kestra/flows/verificar-restauracion.yml
  - infra/kestra/flows/purgar-almacenamiento-kestra.yml
  - infra/kestra/flows/alerta-ausencia-respaldos.yml
  - infra/kestra/flows/aviso-fallo-copias.yml
  - infra/kestra/compose.yaml
  - supabase/migrations/20270418000301_reaplica_privilegios_copias.sql
  - supabase/migrations/20270507200101_verificacion_restore_simulacro.sql
  - supabase/tests/database/simulacro_verificacion_restore_msf520.test.sql
---

# Copias de seguridad y restauración (F-OPS-01)

Épica MSF-457 · spec `specs/20261018-120000-operacion-copias-y-documentacion`. Extiende la copia
diaria de la base de la spec 011 (`specs/011-backups-postgres`).

## Qué se copia, cuándo y dónde

| Qué | Flow (Kestra, namespace `platform.backups`) | Horario (UTC del servidor) | Registro auditable |
|-----|---------------------------------------------|----------------------------|--------------------|
| Base de datos completa (`pg_dump`, formato custom) | `respaldo-postgres` | 03:00 diario | `public.respaldos` |
| Imágenes (todos los objetos de Supabase Storage) | `respaldo-imagenes` | 03:15 diario | `public.respaldos_imagenes` |
| Purga según retención | `retencion-copias` | 04:30 diario | — (el resultado queda en la ejecución de Kestra) |
| Prueba de restauración de la última copia de base | `verificar-restauracion` | lunes 05:00 | `public.verificaciones_restauracion` |
| Aviso por correo ante cualquier fallo | `aviso-fallo-copias` (subflow) | — | — |

**Destino:** un directorio dedicado **del mismo servidor** (`RESPALDOS_DIR_HOST`, por defecto
`/var/lib/automation-platform/respaldos`), fuera de los volúmenes de Supabase. Los flows nunca lo
tocan directamente: siempre pasan por un remoto `rclone` de nombre estable, `respaldos`.

```
<destino>/base/AAAAMMDD-HHMMSS-<id>.dump        # una por corrida de respaldo-postgres
<destino>/imagenes/AAAAMMDD-HHMMSS/...          # una «foto» completa de Storage por corrida
```

Solo el **superadmin** puede leer los historiales (RLS); ningún rol de organización ni `anon` ve
nada, y solo el rol `kestra_backups` escribe (vía funciones `security definer`).

### Retención (por días, con tope)

La retención es **por días**, no por cantidad (MSF-714): se conservan las copias de los últimos `RESPALDOS_RETENCION_DIAS` días (30 por
defecto; el nombre anterior `RESPALDOS_RETENCION_DIARIAS` se acepta como respaldo en el Compose) más la primera copia de cada uno de los
`RESPALDOS_RETENCION_MENSUALES` últimos meses (12). Las **fotos completas de imágenes** pesan todo Storage, así que tienen plazo y tope
propios: `RESPALDOS_IMAGENES_RETENCION_DIAS` (7), `RESPALDOS_IMAGENES_RETENCION_MENSUALES` (2) y `RESPALDOS_IMAGENES_MAX_COPIAS` (7, mínimo 1: **tope total**, mensuales incluidas: nunca quedan más de 7 fotos, contando desde la más nueva; 0 no significa «sin tope», se rechaza). La purga **nunca borra la copia más reciente** y solo toca nombres con la forma
`AAAAMMDD-HHMMSS…` (cualquier otro archivo del destino se ignora). Una corrida puntual puede usar otros valores con los inputs `dias` y
`mensuales` del flow `retencion-copias`.

### Almacenamiento interno de Kestra (MSF-707)

El dump completo de la base se publica como archivo de salida de la tarea `pg_dump` y quedaba en el almacenamiento de Kestra (volumen
`kestra-data`) sin purga. Ahora `respaldo-postgres` y `verificar-restauracion` tienen un bloque `finally` con
`PurgeCurrentExecutionFiles` (borra los archivos de la ejecución, con éxito o con error) y el flow `purgar-almacenamiento-kestra` (diario
04:45) borra ejecuciones terminadas con más de `KESTRA_RETENCION_EJECUCIONES_DIAS` días (7), con sus archivos, logs y métricas. Las copias
durables están en el destino de respaldos, no en Kestra: purgar Kestra no pierde ningún respaldo.

### Alerta de ausencia y tiempos máximos (MSF-709)

Los flows avisaban cuando **fallaban**, no cuando **no corrían** (Kestra caído, trigger apagado, destino que dejó de recibir archivos).
`alerta-ausencia-respaldos` (diario 06:30) lista el destino y compara la fecha del **nombre** de cada copia (`AAAAMMDD-HHMMSS`, UTC) con el corte, porque `rclone lsf --max-age` no filtra carpetas, y falla, con aviso por correo a `SOPORTE_CORREO`, si no hay una
copia de la base **y** una foto de imágenes de las últimas `RESPALDOS_AUSENCIA_HORAS` horas (30). Los plazos de `retencion-copias` (días, meses, tope) y las horas de la alerta son enteros sin ceros a la izquierda y de hasta 4 dígitos (máximo 9999): `08`, vacío, texto o un valor más largo se rechazan con un mensaje claro y sin borrar nada (`retencion-copias.yml:65-72`, `alerta-ausencia-respaldos.yml:54`). Toda tarea de copia tiene `timeout`
(`pg_dump` 2 h, copia al destino 1 h, imágenes 3 h, retención 30 min). El resto de los flows programados ahora tienen bloque `errors:` con
aviso (`aviso-fallo-flujo`, que solo informa la tarea que falló, no el mensaje del error), `timeout` en cada tarea de red/base/correo y,
si corren cada 15 minutos o menos, `concurrency` (una corrida a la vez; el reclamo de cada outbox es mayor o igual que el peor caso, declarado en los
comentarios `reclamo-s`/`peor-caso-s` de cada flow y verificado por el test). El contrato lo fija `pnpm test:kestra:copias` (`validar-robustez-flows.test.mjs`).

### La verificación de restauración falla ante un error real (MSF-708)

`verificar-restauracion` ya no corre `pg_restore ... || true`. Restaura la última copia en un Postgres descartable **sin red** (dentro del
contenedor, nunca contra una base viva) y: (1) exige que el índice del archivo (`pg_restore --list`) se pueda leer y tenga tablas con datos;
(2) clasifica la salida de `pg_restore`: solo se aceptan los errores esperados en un Postgres pelado (roles, extensiones, esquemas y permisos
propios de Supabase, lista `PATRON_ESPERADOS` en el flow), **cualquier otro error falla la verificación**; el log muestra solo el código de salida y un conteo por categoría, nunca el texto crudo (puede citar valores de los datos); (3) cada tabla con
datos del índice debe existir en la base restaurada; (4) las tablas de `RESPALDOS_VERIFICAR_TABLAS` deben tener filas. Si aparece un error
esperado nuevo e inocuo, se agrega explícitamente al patrón (un falso rojo es preferible a un verde mentiroso). Cubierto por
`validar-robustez-flows.test.mjs` (el filtro rechaza datos corruptos, relaciones ausentes y archivos cortados).

### Objetivo de recuperación (propuesta, a confirmar con el cliente)

- Perder como máximo **24 horas** de datos (una copia por día).
- Volver a operar en **4 horas**.

El simulacro de restauración en staging (guía `docs/simulacro-restauracion.md`) mide el tiempo real
contra este objetivo; hoy está **documentado pero pendiente de ejecución** (falta la autorización del
propietario sobre staging, ver el estado en esa guía). Mientras tanto, los pasos y tiempos de la
sección de restauración de este documento son la referencia. El simulacro debe incluir un envío de
prueba del aviso por correo (ver «Puesta en marcha»).

## ⚠️ Riesgo asumido: todo queda en el mismo servidor

Por decisión del propietario (2026-10-17) las copias viven en el mismo servidor (VPS) que la
aplicación. **Si se pierde el servidor entero (disco, VPS), se pierden también las copias.**
Mitigaciones hoy: usar un disco o punto de montaje propio para `RESPALDOS_DIR_HOST`, permisos `700`
en la carpeta (dueño `root`, que es quien corre Kestra y rclone en `infra/kestra/compose.yaml`) (las copias contienen `auth.users` y datos de **todas** las
organizaciones) y cifrado en reposo si el disco lo permite. El traslado a un destino fuera del
servidor queda como seguimiento y se activa **solo cambiando variables**, sin tocar los flows.

### Migrar el destino a S3 / B2 / SFTP

En `infra/kestra/.env` (nunca en Git), y reiniciar Kestra:

| Variable | Local (hoy) | S3 / compatible | SFTP |
|----------|-------------|-----------------|------|
| `RESPALDOS_RCLONE_TIPO` | `local` | `s3` | `sftp` |
| `RESPALDOS_RUTA` | `/respaldos` | `bucket/prefijo` | `/ruta/en/el/servidor` |
| `RESPALDOS_RCLONE_PROVIDER` / `_ENDPOINT` / `_REGION` | vacías | las del proveedor | vacías |
| `RESPALDOS_RCLONE_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` | vacías | credenciales | vacías |
| `RESPALDOS_RCLONE_HOST` / `_USER` / `_PASS` | vacías | vacías | host, usuario y clave (ofuscada con `rclone obscure`) |

`RESPALDOS_DIR_HOST` deja de usarse (el montaje es inocuo pero la carpeta del host debe existir).
Para Backblaze B2 se usa el tipo `s3` con el endpoint S3 de B2. Tras migrar, mover o copiar el
contenido previo del directorio al nuevo destino y volver a correr `verificar-restauracion`.

## Variables

Todas viven solo en `.env.example` / `infra/kestra/.env.example` (valores reales en
`infra/kestra/.env`): `RESPALDOS_*` (destino, retención, tablas a comprobar, origen de Storage),
`KESTRA_SMTP_*` y `SOPORTE_CORREO` (aviso). Las del origen de imágenes
(`RESPALDOS_STORAGE_ENDPOINT`, `…_ACCESS_KEY_ID`, `…_SECRET_ACCESS_KEY`) son las claves del
endpoint S3 de Supabase Storage. Preparación única: crear `RESPALDOS_DIR_HOST` en el servidor,
`chmod 700` con dueño `root` (Kestra y rclone corren como `root`; lo que protege las copias es el 700 del directorio).

**Puesta en marcha (obligatoria): probar el correo de aviso.** Los flows avisan con
`transmitFailed: false`, así que si el SMTP está sin configurar (valores por defecto
`host.docker.internal` / `example.com`) el aviso de fallo se pierde sin que nadie lo note. Tras
configurar `KESTRA_SMTP_*` y `SOPORTE_CORREO`, ejecutar a mano `aviso-fallo-copias` desde la UI de
Kestra y confirmar que el correo llega; repetirlo en cada simulacro.

## Cómo leer el historial

Como superadmin (o desde el SQL editor de Studio):

```sql
select id, estado, iniciado_en, finalizado_en, tamano_bytes, ubicacion, motivo_error
  from public.respaldos order by id desc limit 10;
select id, estado, iniciado_en, cantidad_objetos, tamano_bytes, ubicacion, motivo_error
  from public.respaldos_imagenes order by id desc limit 10;
select v.id, v.estado, v.iniciado_en, v.duracion_segundos, v.detalle, v.motivo_error, r.ubicacion
  from public.verificaciones_restauracion v join public.respaldos r on r.id = v.respaldo_id
  order by v.id desc limit 10;
```

Sano = una fila `completado` por día en `respaldos` y `respaldos_imagenes`, y la última
verificación `completado`. `en_progreso` por más de 3 horas se marca `error` solo en la corrida
siguiente.

## Qué hacer ante el correo de fallo

El correo «[Copias] Falló <flow>» trae el motivo (tarea que falló + mensaje) y el id de la
ejecución de Kestra.

1. Abrir la ejecución en Kestra (namespace `platform.backups`) y leer el log de la tarea fallida.
2. Causas típicas: disco lleno o sin permisos en `RESPALDOS_DIR_HOST`; Storage o base no
   alcanzables; copia corrupta (la verificación de restauración falló → la copia de ese día no es
   confiable: correr `respaldo-postgres` a mano y luego `verificar-restauracion`).
3. «Ya hay un respaldo en progreso» no es un daño: otra corrida seguía activa.
4. Corregir y relanzar el flow a mano desde la UI de Kestra (`origen` queda en `manual`). No hace
   falta limpiar nada: una corrida fallida no deja copias a medias (las fotos parciales de
   imágenes se borran solas).

## Procedimiento guiado de restauración

> Restaurar **sobrescribe** el entorno destino. Hacerlo primero en staging; en producción exige
> aprobación manual (Constitución, Delivery Workflow). Objetivo: operar de nuevo en **4 horas**.

### A. Base de datos

1. **Elegir la copia.** La última `completado` de `public.respaldos` (columna `ubicacion`, p. ej.
   `respaldos:/respaldos/base/20261018-030000-12.dump`) o la anterior si se sospecha corrupción.
   Con destino local el archivo es `<RESPALDOS_DIR_HOST>/base/<nombre>.dump`.
2. **Traer el archivo** al host donde se restaura (si el destino es remoto:
   `rclone copyto respaldos:<ruta>/base/<nombre>.dump ./respaldo.dump` con las variables
   `RCLONE_CONFIG_RESPALDOS_*` equivalentes).
3. **Detener la escritura**: apagar la app (`web`), los workers y Kestra para que nada escriba
   mientras se restaura.
4. **Restaurar** sobre una base vacía (nueva instancia o base recreada del Supabase self-hosted):

   ```bash
   pg_restore --dbname="$DATABASE_URL" --clean --if-exists --no-owner --no-privileges \
     --single-transaction respaldo.dump
   ```

   Los roles y extensiones propios de Supabase deben existir ya en el destino (instancia nueva de
   Supabase self-hosted). Revisar los errores que muestre `pg_restore`.
5. **Reaplicar los privilegios del historial de copias.** `--no-privileges` no aplica los ACL del
   dump: las nueve funciones `security definer` del historial (`iniciar_respaldo`,
   `finalizar_respaldo_completado`, `finalizar_respaldo_error`, `iniciar_respaldo_imagenes`,
   `finalizar_respaldo_imagenes_completado`, `finalizar_respaldo_imagenes_error`,
   `iniciar_verificacion_restauracion`, `finalizar_verificacion_completado` y
   `finalizar_verificacion_error`) quedan ejecutables por `PUBLIC` —`anon` podría escribir el
   historial— y las tablas `respaldos`, `respaldos_imagenes` y `verificaciones_restauracion` quedan sin
   lectura para `authenticated`. Ejecutar, con la misma conexión `postgres` del restore:

   ```bash
   psql "$DATABASE_URL" -c 'select private.reaplicar_privilegios_copias();'
   ```

   Si la base restaurada es más vieja que la migración que creó la función, aplicar antes las
   migraciones pendientes (`supabase migration up`): el paso necesita que la función exista.
6. **Correr el gate del restore** (MSF-520): comprueba de una vez que el restore se aplicó, que la
   app puede servir datos y que el invariante del historial de copias sigue en pie:

   ```sql
   select * from private.verificar_restore_simulacro(<id de la copia restaurada>);
   ```

   Devuelve las ocho comprobaciones (`restore_aplicado`, `app_usa_private`,
   `app_lee_organizaciones`, `app_lee_empresas`, `anon_no_lee_organizaciones`,
   `historial_solo_kestra`, `historial_legible`, `anon_no_lee_historial`). **Si alguna viene con
   `cumple = false`, el restore no sirve**: no se sigue (ni se mide ni se firma nada).

   - `restore_aplicado` = false: la base tiene respaldos posteriores a la copia → el restore no se
     aplicó (la base viva siguió ahí).
   - `app_lee_organizaciones` / `app_lee_empresas` = false: el restore no dejó los permisos que la
     app necesita (este procedimiento usa `--no-privileges`, que no aplica los ACL del dump) →
     **restaurar otra vez sin `--no-privileges`**: el dump `pg_dump --format=custom` lleva los ACL
     (`infra/kestra/flows/respaldo-postgres.yml:86`).
   - `historial_solo_kestra` / `historial_legible` = false: repetir el paso 5
     (`private.reaplicar_privilegios_copias()`).
7. **Comprobar**: `select count(*) from public.organizaciones;` y `public.respaldos` con datos;
   entrar a la app con un superadmin.
8. **Volver a levantar** Kestra, workers y la app. Dejar corriendo `respaldo-postgres` a mano para
   una copia fresca post-restauración.

### B. Imágenes (Storage)

1. **Elegir la foto**: la más reciente de `public.respaldos_imagenes` en `completado`
   (`ubicacion`, p. ej. `respaldos:/respaldos/imagenes/20261018-031500`).
2. **Subirla de vuelta** al Storage con rclone (mismas variables `RCLONE_CONFIG_RESPALDOS_*` y
   `RCLONE_CONFIG_STORAGE_*` que usa el flow):

   ```bash
   rclone copy "respaldos:<ruta>/imagenes/<foto>" storage:
   ```

   Cada carpeta de primer nivel de la foto es un bucket; los buckets deben existir (los crean las
   migraciones del Storage).
3. **Comprobar** abriendo una imagen de un producto en el catálogo.

### Tiempos a registrar

Anotar hora de inicio y fin de cada paso: son el dato del simulacro y de la confirmación del
objetivo de recuperación con el cliente.
