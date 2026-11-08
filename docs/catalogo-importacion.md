# Catálogo · Importación de productos desde CSV (F-CAT-10)

Spec: `specs/20270125-100000-catalogo-compatibilidad-y-planillas/` (US2, FR-101…FR-113). Pantalla
«Carga masiva de productos» en `/productos/carga`; se llega desde «Importar CSV» del listado de
Productos y solo la ve el Administrador. No tiene ítem de menú.

## Flujo

1. **Archivos.** El navegador lee el CSV (UTF-8, `,` o `;`, con o sin BOM; hasta 2.000 filas) y las
   imágenes (ZIP o sueltas, JPG/PNG/WebP de hasta 2 MB, máximo 500). De los ZIP de una misma carga no se expande más de 500
   entradas ni más de 100 MB descomprimidos en total, y si dos carpetas traen el mismo nombre se usa la primera y se
   avisa. Las imágenes se suben al bucket temporal `productos-importaciones` bajo
   `<organización>/<clave>/<archivo>`.
2. **Vista previa.** `validar_importacion_productos` evalúa cada fila (FR-105) sin persistir nada. La
   acción Nuevo/Actualiza sale de que el SKU exista en la organización. Si quien importa no tiene
   Rentabilidad, `costo` se ignora con un aviso por fila (FR-106).
3. **Importar.** `solicitar_importacion_productos` revalida, persiste la importación y sus filas y encola
   la orden en la outbox. La clave de idempotencia evita duplicar la importación ante un reintento.
   «Cancelar» descarta la vista previa y las imágenes temporales sin escribir en la base.
4. **Aplicación.** El flow `producto.catalogo.importar-productos` (Kestra) reclama la capacidad
   `importar-productos` y lanza `workers/importar-productos`, que aplica fila por fila (mismas reglas
   que el alta/edición, SKU único, actividad registrada) y adjunta las imágenes.
5. **Resultado.** La pantalla sondea `obtener_importacion_productos` hasta `terminada` o `fallida` y
   ofrece «Descargar reporte de errores» (CSV: fila, SKU, motivo).

## Requisito: conexión por organización

`solicitar_importacion_productos` exige una fila en `conexiones` con `sistema_externo = 'importar-productos'`
para la organización (la capacidad cuelga de esa conexión, igual que el historial de ventas). Ninguna
migración ni pantalla la aprovisiona: hoy la da de alta soporte a mano. Sin ella la vista previa funciona,
pero «Importar» falla con `SIN_CONEXION_IMPORTACION` y la pantalla lo informa. Idempotencia: reenviar la misma
`clave` con otras filas devuelve la importación anterior sin avisar.

## Seguimiento pendiente (revisión independiente de la épica)

Quedan sin arreglar porque piden migración y no se pueden probar con pgTAP sin Supabase local: imágenes que
se pierden si el Storage falla después de marcar la fila como aplicada (el reintento solo mira filas
`pendiente`), errores transitorios (deadlock) que se vuelven «omitida» definitiva, tope de largo por celda,
limpieza de imágenes temporales huérfanas y el seguimiento que no sobrevive a salir de la pantalla.

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

Migraciones aditivas (`20270121121303`…`20270121121307`). Para volver atrás: revertir el merge del PR
(`git revert -m 1`) y, en una migración posterior, eliminar las tablas `dominio.importaciones_productos*`
y las funciones asociadas (ver encabezado de `20270121121303_catalogo_importaciones.sql`), exportando
antes los datos. Nunca en el mismo PR que las crea.

> Nota: en `validar_importacion_productos` los textos que se agregan a `v_errores`/`v_avisos` (`text[]`) van con cast `::text`; sin él Postgres lee el literal como arreglo («malformed array literal»).

## Precios propios por empresa (límite conocido)

La importación escribe solo `precio_lista`; no crea, cambia ni borra precios propios por empresa (F-PRE-08). Ver `catalogo-exportacion.md` («Precios propios por empresa»).
