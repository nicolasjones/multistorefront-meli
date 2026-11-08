# Centro de importaciones y exportaciones (F-IMP-01 / MSF-354)

Registro genérico de cargas y descargas masivas de la Plataforma, más la
pantalla `/importaciones` que las muestra. **No importa ni exporta nada por sí
mismo**: cada funcionalidad (Catálogo, Stock, Mercado Libre, exportación total)
registra sus procesos con el protocolo de abajo. Esta épica no migra cargas
existentes. Spec: `specs/20261102-220000-importaciones-y-monitoreo/`.

## Qué se ve

- Ítem **Importaciones** (icono de carga/descarga) en *Administración*, solo para
  administradores de la organización. Ruta `/importaciones`; no hay rutas anteriores.
- Tabla con **fecha, origen** (nombre de la funcionalidad, nunca su clave técnica),
  **estado, avance, resultado y duración**, con los estados compartidos de carga,
  vacío y error. El resultado dice «N correctas y M con error» (480 correctas y 20
  con error para 500 filas con 20 inválidas). La lista usa carga infinita (se
  suma una tanda de 20 al acercarse al final o con «Cargar más») y muestra
  «Mostrando X de Y procesos».
- Se actualiza sola cada 5 segundos mientras haya procesos `pendiente` o `en_curso`
  y deja de consultar cuando todos terminaron.
- **Ver detalle** abre «Detalle de la importación»: resumen y errores con carga
  infinita (fila, columna, referencia, motivo) y el total de errores visible.
  **«Descargar errores (CSV)»** baja el reporte completo del proceso (todos los
  errores guardados, no solo los de la pantalla) con fila, columna, referencia y
  motivo: UTF-8 con BOM, separador `;`, fórmulas neutralizadas (`= + - @`, tab, CR) y
  nombre `errores-<proceso>-AAAA-MM-DD.csv`.
- Con más errores que detalles guardados (tope de 1000 por proceso) el diálogo avisa
  «Mostrando los primeros 1000 errores de N» y el CSV termina con una fila que dice lo
  mismo; `con_errores` y «correctas y con error» siempre cuentan todos.
- **Cancelar** (con confirmación) solo en procesos abiertos. Un proceso `pendiente`
  pasa a `cancelado` de inmediato; uno `en_curso` queda «Cancelando» hasta que el
  worker lo confirme entre lotes. Si no hay un worker vivo (la orden de despacho se
  agotó, la ejecución ya terminó o superó su tiempo máximo) el administrador lo cierra
  `cancelado` de inmediato, sin esperar a nadie. Si ya terminó, avisa que no se puede cancelar.
- **Empresa activa** (Principio VIII): la tabla sigue la empresa de la barra
  superior (o «Todas»). Un proceso sin empresa aparece solo en «Todas». Al cambiar
  de empresa se recargan las consultas, la paginación vuelve a la página 1 y el
  diálogo abierto se cierra con aviso.

## Alcance de la épica (qué cargas ya reportan al centro)

Esta épica entrega **la infraestructura y la pantalla**: el registro genérico, el contrato para workers y el
centro. **No migra cargas existentes** (`historial-importador`, `importar-productos`, `exportar-comprobantes`,
Stock Excel, Mercado Libre): hoy ningún worker llama a `iniciar_proceso_masivo` ni a las funciones del protocolo,
y hasta que cada épica las conecte el centro puede estar vacío en producción. Es una decisión de la spec
`importaciones-y-monitoreo`: FR-017 («esta épica **no** migra cargas existentes») y D-5 («conectar Stock Excel,
Productos, Mercado Libre y el importador del historial (MSF-275) es trabajo de sus épicas, sin bloqueo»).

## Datos y permisos

- `public.procesos_masivos` y `public.procesos_masivos_errores` (esquema `public`:
  capacidad transversal de plataforma). Estados: `pendiente`, `en_curso`,
  `completado`, `con_errores`, `fallido`, `cancelado`; un estado terminal no vuelve atrás.
- RLS: `select` solo para administradores de la organización; `authenticated` no
  escribe (solo las funciones); `anon` no tiene privilegios.
- Cada proceso cuelga de una ejecución del ciclo de workers (`ejecuciones_worker`
  y la outbox `despachos_ejecucion`); no hay un ciclo paralelo.

## Cómo registra su proceso una funcionalidad

1. Tener una conexión y una capacidad habilitada (`capacidades_ejecucion`) para la carga. La clave de la
   capacidad debe ser `importar-<algo>` para una importación o `exportar-<algo>` para una exportación
   (`CAPACIDAD_INVALIDA` si no, o si no coincide con el tipo).
2. Llamar a `iniciar_proceso_masivo(p_conexion_id, p_capacidad, p_tipo, p_funcionalidad,
   p_nombre, p_empresa_id, p_parametros)`. Devuelve el id del proceso. Errores:
   `NO_AUTORIZADO`, `TIPO_INVALIDO`, `ARGUMENTO_INVALIDO`, `SECRETO_DETECTADO`,
   `EMPRESA_INVALIDA`, `CAPACIDAD_INVALIDA` y los del ciclo (`YA_EN_CURSO`, `CAPACIDAD_NO_HABILITADA`).
3. El worker (rol `worker_<org>`) toma `proceso_id` del `detalle` de su ejecución y usa
   `actualizar_progreso_proceso_masivo`, `registrar_error_proceso_masivo`,
   `proceso_masivo_cancelado` y `cerrar_proceso_masivo` (ver `workers/CONTRATO.md`).
   `registrar_error_proceso_masivo` es idempotente por (proceso, fila): reintentar un lote no
   duplica el error ni suma a `con_errores`. La detección y redacción de secretos cubre también la
   forma JSON (`"password": "x"`). El detalle de la pantalla se refresca mientras el proceso avanza.
   **Contadores**: `procesados` cuenta TODAS las filas leídas (correctas y con error) y
   `con_errores` las rechazadas; las correctas son `procesados - con_errores`.
   `registrar_error_proceso_masivo(proceso, fila, referencia, motivo, columna)` recibe
   la columna donde falló la fila (opcional, sin valores del usuario). Es idempotente por
   fila o, sin fila, por (referencia, motivo), incluso pasadas las 1000 filas de detalle
   (guarda solo claves en `procesos_masivos_errores_claves`). **Topes**: se guardan hasta 1000
   detalles por proceso y hasta 10.000 claves de idempotencia; pasado el tope de claves los
   errores solo se cuentan (un reintento del lote ya no es idempotente) y el proceso queda con
   `detalle_truncado = true`, igual que al superar los 1000 detalles. `cerrar_proceso_masivo`
   exige `procesados = total` para `completado` y `con_errores` (si se informó total; un archivo
   vacío es 0 de 0) y una cancelación solicitada para `cancelado`.
   **Procesos huérfanos**: si la orden de despacho se agota, la ejecución se cierra `fallida` y el
   proceso `fallido` («No se pudo iniciar el proceso…»); si la ejecución supera el tiempo máximo de
   su capacidad, `evaluar_monitoreo` (cada 2 minutos) la cierra `timeout` y el proceso pasa a
   `fallido`.
   **Retención**: el flow `depuracion-monitoreo` (diario) borra los procesos terminados con más de
   180 días junto con sus errores (ver `docs/monitoreo.md`).
   **Actividad** (RF-IMP-01-5): la base registra `importacion.iniciada` (al iniciar),
   `importacion.cancelada` (al pedir la cancelación) e `importacion.finalizada` (al cerrar
   o al reconciliar una ejecución caída, con las cifras correctas/con error). El detalle
   no lleva referencias, motivos ni parámetros.
4. Para que la pantalla muestre un nombre legible, sumá la clave de `p_funcionalidad`
   a `ETIQUETA_FUNCIONALIDAD` en `apps/web/src/lib/procesosMasivos.ts`.

## Reversión

Las migraciones `20270211100001`…`20270211100005`, `20270214100001`…`02` (columna del
reporte, claves de idempotencia y eventos de actividad) y `20270217400001` (tope de claves,
`detalle_truncado`, validaciones de cierre y de capacidad, huérfanos) son aditivas. Para la
última: `drop trigger reconciliar_despacho_agotado on public.despachos_ejecucion`,
`private.reconciliar_despacho_agotado()`, `private.cerrar_procesos_masivos_vencidos()`, la
columna `detalle_truncado` y volver a aplicar las funciones de las migraciones anteriores. Para deshacer:
`drop trigger reconciliar_proceso_masivo on public.ejecuciones_worker`, las seis
funciones `*_proceso_masivo`, `private.autorizar_worker_proceso`,
`private.reconciliar_proceso_masivo`, `private.proteger_proceso_masivo`,
`private.sanitizar_motivo_proceso(text, boolean)` y luego las dos tablas (solo
mientras no haya datos productivos).
