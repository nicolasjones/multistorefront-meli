# Exportar todos los datos (F-OPS-06, MSF-396)

Bloque **«Exportar todos los datos»** en `/importaciones`. Un administrador de la organización pide un ZIP con una planilla CSV por cada tipo de dato de **toda la organización** (todas las tiendas). Spec: `specs/20270215-100000-notificaciones-ayuda-y-exportacion-total/` (FR-030…FR-041, SC-004…SC-006).

## Cómo funciona

1. La pantalla llama a `public.solicitar_exportacion_total()` (solo administradores; `revoke … from public, anon`, `grant … to authenticated`). Crea un proceso masivo `exportacion_total` con su ejecución y su orden de despacho (`iniciar_proceso_masivo`). Si ya hay uno pendiente o en curso, devuelve ese (`reutilizado = true`): no hay dos a la vez.
2. El flow de Kestra `infra/kestra/flows/exportar-organizacion.yml` reclama `exportar-organizacion-*` y lanza el worker `workers/exportar-organizacion`.
3. El worker lee los conjuntos con `private.conjuntos_exportacion_total()` y sus filas con `private.filas_exportacion_total()` (solo de la organización de la ejecución, en curso), por lotes de 2000. Escribe un CSV por conjunto (escape de comillas y neutralización de fórmulas) y un `LEEME` dentro de un ZIP en streaming, lo sube a `exportaciones-organizacion/<organizacion>/<ejecucion>.zip` y borra el archivo anterior de la organización.
4. El avance (`total` = cantidad de conjuntos) se ve en el bloque y en la tabla del centro. Un conjunto que falla queda como error del proceso y la exportación cierra `con_errores`; si fallan todos o se agota el reintento, `fallido` con motivo sanitizado. Cancelar corta entre lotes sin dejar ZIP parcial.
5. «Descargar» pide una URL firmada de 60 s; la política de Storage solo deja leer a administradores de esa organización. Solo existe el último archivo.

El bloque no depende de la empresa activa (la exportación es de toda la organización) y no se muestra a quien no administra **ni a un superadmin con acceso de soporte**: la exportación completa la pide y la descarga solo el administrador de la propia organización (`private.es_administrador_propio_de`; la base rechaza al superadmin con 42501).

## Qué incluye y qué excluye

- **Incluye**: la lista permitida de `private.conjuntos_exportacion_total()` (tablas de `public` y `dominio` con datos de negocio de la organización). Las columnas salen del catálogo de la base y se omiten las que parecen secreto (secret, token, password, api key, vault, credencial).
- **Excluye** (documentado en `private.exclusiones_exportacion_total()`, con motivo): colas internas de avisos y correo, registros operativos y de monitoreo, procesos masivos, credenciales y conexiones, e índices o datos derivados.
- **Completitud**: el pgTAP `exportacion_total.test.sql` falla si una tabla con `organizacion_id` de `public` o `dominio` no está en la lista ni en las exclusiones.

## Conjuntos agregados después de la primera versión

- `20270217300007_exportacion_total_conjuntos_nuevos.sql`: `dominio.cotizacion_configuracion` y `dominio.precios_propios_empresa` (llegaron con la integración de `dokploy` en la épica; el pgTAP de completitud lo detectó).
- `20270218500700_exportacion_total_precios_propios_historial.sql`: suma `dominio.precios_propios_historial` (historial inalterable de precios propios, MSF-352) al conjunto exportado; incluye `actor_nombre` como la actividad.
- `20270219170000_exportacion_total_reparaciones_service.sql` (MSF-124): suma `dominio.reparacion_adjuntos` (el registro de fotos y adjuntos de cada reparación: ruta, nombre, tipo, tamaño, quién y cuándo; los archivos viven en el bucket privado `reparacion-adjuntos` y NO viajan en la exportación) y EXCLUYE `dominio.reparacion_enlaces_consulta` (guarda el token de acceso público a la consulta de estado: es una credencial, igual que las invitaciones y las conexiones).
- `20270220170000_exportacion_total_variantes_y_relacionados.sql` (MSF-229): suma `dominio.producto_variantes` (las variantes de cada producto), `dominio.existencias_variante` (el stock por variante y depósito) y `dominio.producto_relacionados` (los productos relacionados) al conjunto exportado; son datos de negocio de la organización y ninguna columna parece un secreto.
- `20270217300006_exportacion_total_solo_admin_propio.sql`: la solicitud y la descarga exigen la membresía propia de administrador (`private.es_administrador_propio_de`); un superadmin con acceso de soporte no exporta.

## Agregar un conjunto

Una tabla nueva con `organizacion_id` rompe el pgTAP hasta que se decida. Agregá una migración **nueva** (nunca editar la anterior) que redefina `private.conjuntos_exportacion_total()` con la tabla, o `private.exclusiones_exportacion_total()` con el motivo.

## Configuración

`EXPORTAR_ORGANIZACION_IMAGEN` (`.env.example`, pasa a Kestra como `ENV_EXPORTAR_ORGANIZACION_IMAGEN` en `infra/kestra/compose.yaml`). La organización necesita una conexión `historial-ventas` (la misma de otras exportaciones); sin ella el pedido falla con `SIN_CONEXION_EXPORTACION` y la pantalla lo explica. Tope del ZIP: 200 MB (`TOPE_EXCEDIDO`, falla no reintentable con código 78).

## Reversión

Las migraciones son aditivas (`…200003_exportacion_total_conjuntos.sql`, `…200004_exportacion_total_solicitud.sql`); su reversión está en el encabezado de cada una (drop de las funciones, la capacidad y el bucket `exportaciones-organizacion`). Sin tablas nuevas en `public`/`dominio`. Para volver atrás sin tocar la base: `git revert -m 1` del merge y quitar el flow de Kestra.
