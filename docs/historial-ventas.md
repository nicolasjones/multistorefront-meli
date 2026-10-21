# Historial de ventas importado (F-VTA-37 / MSF-293)

Archivo de consulta de las ventas, los cobros y las cotizaciones del dólar que
ocurrieron **antes** de la plataforma. Se importa una sola vez desde una
planilla `.csv` o `.xlsx` del panel anterior y desde ese momento es solo
lectura. No toca el stock ni los comprobantes vivos.

## Alcance

- Tres tablas en `dominio`: `historial_comprobantes`, `historial_cobros` y
  `historial_cotizaciones_dolar`.
- Bucket privado `historial-importaciones` con la planilla original.
- RPC `public.solicitar_importacion_historial(p_tipo, p_archivo)`.
- Worker `workers/historial-importador` y flow
  `infra/kestra/flows/historial-importador.yml`.
- Pantalla `/historial/importar` en `apps/web`.

## Permisos y RLS

- Leer el historial exige `ventas` en lectura o edición y una empresa
  accesible (las cotizaciones son globales de la organización).
- Importar exige `private.puede_escribir()` (administrador de la organización,
  o superadmin con organización activa). Es el mismo permiso que exige el
  bucket para subir.
- `authenticated` no tiene insert/update/delete sobre las tablas: la única vía
  de escritura es `private.importar_historial_lote`, ejecutada por el worker.
- `anon` no tiene ningún privilegio.
- No hay FKs ni disparadores hacia tablas vivas: el historial no puede alterar
  comprobantes, cobros, stock ni saldos actuales (FR-008).

## Puesta en marcha de una organización

La ejecución cuelga de una conexión de plataforma, porque el ciclo de workers
necesita un servidor, una credencial y una capacidad auditables. El importador
no se conecta a ningún sistema externo real: la credencial es ficticia y solo
habilita la conexión.

1. Crear un servidor para la organización y su credencial SSH, como en
   cualquier worker del ciclo (`public.aprovisionar_servidor_organizacion`).
2. Crear la conexión del importador como administrador:

   ```sql
   select public.crear_conexion(
     '<organizacion_id>'::uuid,
     'historial-ventas',
     'credencial-ficticia-del-importador'
   );
   ```

   El catálogo `sistemas_externos` ya trae `historial-ventas` desde la
   migración. La capacidad `importar-historial-<tipo>` se crea sola al primer
   uso y vence a la hora (`tiempo_max_seg = 3600`).
3. En el host de despacho, `worker.env` debe definir, además de `PGHOST`,
   `PGPORT`, `PGDATABASE`, `PGUSER` y `PGPASSWORD`:
   - `SUPABASE_URL`;
   - `SUPABASE_SERVICE_ROLE_KEY` (solo en el servidor, nunca en el navegador);
   - `WORKER_NETWORK=worker-egress-historial-ventas`.
   La red debe permitir la salida hacia Supabase. El flow rechaza cualquier
   otra red con «Red de egress no autorizada».
4. Publicar la imagen del worker con el workflow de imágenes y fijar
   `HISTORIAL_IMPORTADOR_IMAGEN` (en local,
   `local/worker-historial-importador:latest`) en `infra/kestra/.env`.
5. Desplegar el flow `producto.ventas/historial-importador`. El `Schedule`
   reclama la outbox cada dos minutos; no hay webhook ni URL de despacho en la
   base.

## Flujo de una importación

1. La pantalla sube la planilla al bucket con la sesión del administrador, en
   la ruta `<organizacion_id>/<uuid>.<csv|xlsx>`.
2. `solicitar_importacion_historial` valida tipo, archivo y permiso, y crea en
   la misma transacción la ejecución `manual` y la orden de outbox.
3. El flow reclama solo las órdenes de capacidades `importar-historial-*`,
   resuelve el servidor de la organización y ejecuta el worker por SSH y
   Docker.
4. El worker descarga la planilla con la clave de servicio, valida **todas** las
   filas y, si hay un solo rechazo, no inserta nada. Si la planilla es válida,
   inserta por lotes de 1000 con `on conflict do nothing`.
5. Cierra la ejecución como `exitosa` (`IMPORTADAS:<n>`, detalle con `nuevas` y
   `existentes`) o `fallida` (detalle con total y hasta 100 rechazos: fila,
   columna y motivo). Los rechazos nunca incluyen el valor de la celda.
6. El flow confirma la orden; una falla no reintentable (código 78) la agota en
   el primer intento; una falla técnica la libera hasta 3 reclamos.

Reimportar la misma planilla es seguro: las claves naturales evitan duplicados
y las filas existentes se cuentan como `existentes`.

## Errores que muestra la pantalla

| Código | Significado |
| --- | --- |
| `NO_AUTORIZADO` | El rol no puede importar en la organización. |
| `TIPO_INVALIDO` | El tipo no es `comprobantes`, `cobros` o `cotizaciones`. |
| `ARCHIVO_INVALIDO` | La planilla no está en el bucket de la organización o no es CSV/Excel. |
| `SIN_CONEXION_HISTORIAL` | Falta la conexión `historial-ventas` de la organización. |
| `YA_EN_CURSO` | Ya hay una importación de ese tipo en curso. |

La pantalla traduce esos códigos a mensajes accionables y nunca muestra el
error crudo del worker. El detalle completo queda en `/ejecuciones/<id>`.

## Validación

- `supabase/tests/database/historial_importacion.test.sql`: tablas, RLS, RPC,
  bucket y funciones del worker.
- `supabase/tests/database/historial_reclamo_despachos.test.sql`: el reclamo
  filtrado por capacidad no roba órdenes de otros flows y recupera reclamos
  vencidos.
- `apps/web/src/pages/historial/importar.test.tsx` y
  `apps/web/src/lib/historial.test.ts`: subida, estados, rechazos y acceso.
- `pnpm infra:config` valida el Compose de Kestra, no la sintaxis del flow.

## Reversión

Las migraciones son aditivas. Para deshacer la funcionalidad, en una migración
posterior y después de exportar los datos:

```sql
revoke execute on function private.reclamar_despachos_capacidad(text, integer, integer)
  from kestra_orquestacion;
drop function private.reclamar_despachos_capacidad(text, integer, integer);
drop function public.solicitar_importacion_historial(text, text);
drop function private.capacidad_importacion_historial(text);
drop table dominio.historial_cotizaciones_dolar;
drop table dominio.historial_cobros;
drop table dominio.historial_comprobantes;
```

Después, vaciar y quitar el bucket `historial-importaciones` desde la API de
Storage. Nunca en el mismo PR que crea las tablas.
