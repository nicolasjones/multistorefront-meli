# Catálogo · Importación de productos desde CSV (F-CAT-10)

Spec: `specs/20270125-100000-catalogo-compatibilidad-y-planillas/` (US2, FR-101…FR-113). Pantalla
«Carga masiva de productos» en `/productos/carga`; se llega desde «Importar CSV» del listado de
Productos y solo la ve el Administrador. No tiene ítem de menú.

## Flujo

1. **Archivos.** El navegador lee el CSV (UTF-8, `,` o `;`, con o sin BOM; hasta 2.000 filas) y las
   imágenes (ZIP o sueltas, JPG/PNG/WebP de hasta 2 MB, máximo 500). De los ZIP de una misma carga no se expande más de 500
   entradas ni más de 100 MB descomprimidos en total: el tope se comprueba en streaming (fflate `Unzip`, rebanadas de 16 KB) con el tamaño **real** descomprimido de cada entrada y del total (la
   cabecera del ZIP, `originalSize`, puede mentir) y lo que lo pasa se descarta con aviso. Nombres repetidos: **gana la
   primera**, siempre (entre carpetas de un ZIP, entre archivos de una misma selección y entre selecciones
   sucesivas de la pantalla; la repetida se descarta y se avisa; para reemplazar una imagen hay que cancelar y volver a
   cargarla). Las imágenes se suben al bucket temporal `productos-importaciones` bajo
   `<organización>/<clave>/<archivo>`. `leerImagenes(archivos, limites?)` acepta los topes como último argumento
   (por defecto 500 / 50 MB por ZIP / 100 MB) para poder probarlos sin crear 100 MB.
2. **Vista previa.** `validar_importacion_productos` evalúa cada fila (FR-105) sin persistir nada. La
   acción Nuevo/Actualiza sale de que el SKU exista en la organización. Si quien importa no tiene
   Rentabilidad, `costo` se ignora con un aviso por fila (FR-106).
3. **Importar.** `solicitar_importacion_productos` revalida, persiste la importación y sus filas y encola
   la orden en la outbox. La clave de idempotencia evita duplicar la importación ante un reintento o un doble clic
   (las llamadas con la misma clave se serializan por un candado de asesoría de la organización). Si la clave ya tenía
   importación, el resultado trae `reutilizada: true` y la pantalla avisa que las filas enviadas ahora no se tomaron.
   «Cancelar» descarta la vista previa y las imágenes temporales sin escribir en la base.
   **Seguimiento en la URL.** La importación en curso se guarda en `?importacion=<id>`: al salir de la pantalla y
   volver, o al recargar, se rehidrata con `obtener_importacion_productos` y se ve su estado. Un id inválido se
   ignora; uno inexistente (P0002) limpia la URL y avisa.
4. **Aplicación.** El flow `producto.catalogo.importar-productos` (Kestra) reclama la capacidad
   `importar-productos` y lanza `workers/importar-productos`, que aplica fila por fila (mismas reglas
   que el alta/edición, SKU único, actividad registrada) y adjunta las imágenes. Una fila aplicada con imágenes
   queda con `imagenes_pendientes = true` hasta que el worker las adjunta y lo confirma
   (`confirmar_imagenes_fila_importacion_productos`): si Storage falla, el proceso sale con error, el flow reintenta y
   la fila **se vuelve a ofrecer** (adjuntar es idempotente: ruta final determinista y registro `existente`), así que no
   se pierden imágenes ni se duplican. Errores transitorios de la base (SQLSTATE clase 40, 53, 55 y 57: deadlock, lock
   no disponible, recursos, cancelación) **se propagan** para que el flow reintente; solo los errores de datos
   dejan la fila `omitida` con su motivo.
5. **Resultado.** La pantalla sondea `obtener_importacion_productos` hasta `terminada` o `fallida` y
   ofrece «Descargar reporte de errores» (CSV: fila, SKU, motivo).

## Requisito: conexión por organización

`solicitar_importacion_productos` exige una fila en `conexiones` con `sistema_externo = 'importar-productos'`
para la organización (la capacidad cuelga de esa conexión, igual que el historial de ventas, MSF-293).

**Decisión (hallazgo 7): no se aprovisiona sola.** El historial de ventas (`docs/historial-ventas.md`) tampoco lo
hace: la conexión la crea un Administrador con `crear_conexion` y exige servidor de la organización y credencial en
Vault, es decir una decisión de operación/credenciales que no se inventa en una migración. En su lugar, la pantalla
llama a `importacion_productos_habilitada()` (solo Administrador, solo lectura) al abrirse y, si la organización no
tiene la conexión, muestra el aviso «Tu organización todavía no tiene habilitada la importación de productos. Un
Administrador tiene que crear la conexión «importar-productos» (servidor y credencial)» y deshabilita la elección de archivos, **antes** de pedir el CSV. Si la consulta falla no se bloquea: el servidor igual
rechaza con `SIN_CONEXION_IMPORTACION`.

## Imágenes temporales

Al **empezar** cada corrida el worker borra los huérfanos de la organización (más de 7 días, que no pertenezcan a una
importación en curso) y al cerrar (`terminada`) también las imágenes de su clave en `productos-importaciones`, por la
API de Storage (`private.imagenes_temporales_a_borrar`, hasta 1000 por llamada; el worker repite hasta 5 tandas por
fase para vaciar el backlog). Es de mejor esfuerzo: si el borrado falla la
importación igual termina y lo que quede se borra en la corrida siguiente. Una importación que cierra como `fallida`
(la cierra la base, no el worker) deja sus imágenes hasta que una corrida posterior las barre como huérfanas pasados
los 7 días; lo mismo vale para subidas que nunca llegaron a solicitarse. El tope por celda (hallazgo 3) es de 1000
caracteres en `categoria`, `proveedor`, `tiendas` e `imagenes` (error de la fila con mensaje) y la `carga` guardada
solo conserva las columnas conocidas, acotadas.

## Fila que siempre falla e imágenes sin adjuntar

- Solo un error de la base con SQLSTATE clase 40, 53, 55 o 57 (`err.code`: deadlock, lock no disponible, recursos,
  cancelación) cuenta como intento: revierte esa fila y el worker lo registra (`registrar_fallo_fila_importacion_productos`,
  columna `intentos`) y **sigue con las demás**; si quedan filas con intentos disponibles la corrida sale con error y el
  flow reintenta. Cualquier otro error (autorización, conexión caída, errores de programación, fallas contractuales) se
  propaga como siempre y no suma intentos. El tope es 3, igual a los reintentos del flow (3 intentos, 30 s a 2 min): un
  lock que dure más que eso agota los intentos. Entonces la fila queda `omitida` con «Error temporal repetido; volvé a
  importar esta fila» y la pantalla la cuenta aparte (`omitidas_temporales`): «N omitidos por error y M omitidos por un
  error temporal (volvé a importar esas filas)». Así una fila mala no traba al resto y el motivo no se confunde con un
  dato inválido.
- Si una importación cierra (`terminada`, o `fallida` por la reconciliación) con productos cuyas imágenes no se
  adjuntaron, `cerrar_importacion_productos` y `obtener_importacion_productos` devuelven `sin_imagenes` y la pantalla
  avisa «N productos quedaron sin imágenes». El worker lo incluye en el detalle de la ejecución (`sin_imagenes`) y en un evento de cierre.

## Seguimiento pendiente (revisión independiente de la épica)

Los hallazgos de código de la revisión están resueltos. Lo que sigue siendo así a propósito o depende de operación:

- Un `.zip` ilegible (basura, truncado) se informa «No pudimos abrir…»: el lector en streaming no lanza, así que se detecta por no haber emitido entradas o haber dejado alguna sin terminar. «Gana la primera» se decide por el nombre visto en la selección, aunque la primera homónima se haya rechazado.

- La conexión `importar-productos` de cada organización la crea un Administrador con `crear_conexion` (servidor y
  credencial, ver `docs/historial-ventas.md`); la pantalla avisa mientras falte.
- El borrado de imágenes temporales es de mejor esfuerzo (si Storage falla se reintenta en la corrida siguiente; los
  huérfanos esperan 7 días).
- La descompresión de ZIP en el navegador se corta al superar los topes, pero deflate puede inflar hasta ~1000× lo que
  se empuja de una vez: el lector recibe rebanadas de 16 KB, así que lo transitorio queda acotado (~16 MB) y lo
  retenido nunca supera 100 MB totales ni 2 MB por imagen. No hay garantía de cortar a mitad de una rebanada.

## Estados y serialización

`en_cola` → `aplicando` → `terminada` | `fallida`. Dos importaciones de la misma organización se
serializan: la segunda queda `en_cola` hasta que termine la primera (FR-109). Una falla técnica queda
reintentable desde la pantalla de ejecuciones.

**Falla (FR-111).** Si el worker agota los reintentos del flow o sale con 78, nadie llama a
`cerrar_importacion_productos`. `private.reconciliar_importaciones_fallidas` (migración
`20270121121307`) pasa a `fallida`, con `mensaje_fallo`, toda importación cuya orden de la outbox quedó
`agotada`, cuya ejecución se cerró sin terminarla o que superó el tiempo máximo de la capacidad, y cierra
su ejecución para liberar el candado. La llaman `despachar_importacion_siguiente` y el sondeo
`obtener_importacion_productos`, así la cola se libera sin un proceso extra.

## Worker

Paquete `@workers/importar-productos` (`build`, `lint`, `test`, `start`), contrato `workers/CONTRATO.md`:
registra su ejecución, comprueba `ejecucion_worker_en_curso` (si no está en curso sale con 78) y es
idempotente (reintentar no duplica productos). Variable de imagen: `IMPORTAR_PRODUCTOS_IMAGEN`.

## Seguridad

Las RPC son `security definer`, toman organización y actor de la sesión y exigen Administrador;
`anon` no tiene privilegios. Las tablas viven en el esquema `dominio` con RLS (lectura solo Administrador,
sin escritura para `authenticated`). La pantalla no depende de la empresa activa (FR-113): las tiendas
salen de la columna `tiendas`.

## Reversión

Migraciones aditivas (`20270206100001`…`20270206100005` y `20270215500000_importacion_productos_robustez`). Para volver
atrás: revertir el merge del PR (`git revert -m 1`) y, en una migración posterior, eliminar las tablas
`dominio.importaciones_productos*` y las funciones asociadas (ver el encabezado de cada migración), exportando antes
los datos. Nunca en el mismo PR que las crea.

**Reversión correcta del bucket.** El comentario de reversión de `20270206100001_catalogo_importaciones.sql` propone
`delete from storage.objects where bucket_id = 'productos-importaciones'`, que **no funciona en self-hosted** (Storage
bloquea el borrado directo de objetos por SQL; la migración es inmutable y no se edita). El orden correcto es:

1. Vaciar el bucket por la API de Storage (con la service-role del servidor, nunca en el navegador):
   `DELETE {SUPABASE_URL}/storage/v1/bucket/productos-importaciones/empty`.
2. Borrar el bucket por la API: `DELETE {SUPABASE_URL}/storage/v1/bucket/productos-importaciones` (o
   `supabase.storage.emptyBucket(...)` + `deleteBucket(...)` del cliente de servidor).
3. En una migración posterior: `drop table dominio.importaciones_productos_filas; drop table dominio.importaciones_productos;`
   y las funciones `private.capacidad_importacion_productos()` y `private.codigo_tienda(text)`, más las de
   `20270206100002…5` y `20270215500000` (cada encabezado lista las suyas). Las políticas de `storage.objects` del
   bucket (`productos_importaciones_*`) se eliminan con `drop policy`.


> Nota: en `validar_importacion_productos` los textos que se agregan a `v_errores`/`v_avisos` (`text[]`) van con cast `::text`; sin él Postgres lee el literal como arreglo («malformed array literal»).
