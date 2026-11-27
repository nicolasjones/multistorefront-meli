---
owner: tecnico
sources:
  - specs/20270215-100000-notificaciones-ayuda-y-exportacion-total
  - infra/kestra/compose.yaml
  - infra/kestra/flows/exportar-organizacion.yml
  - workers/exportar-organizacion
  - supabase/migrations/20270217300006_exportacion_total_solo_admin_propio.sql
  - supabase/migrations/20270217300007_exportacion_total_conjuntos_nuevos.sql
  - supabase/migrations/20270218500700_exportacion_total_precios_propios_historial.sql
  - supabase/migrations/20270219170000_exportacion_total_reparaciones_service.sql
  - supabase/migrations/20270507180700_exportacion_total_identificadores_externos.sql
  - supabase/migrations/20270516000100_exportacion_total_lista_blanca_y_keyset.sql
  - supabase/migrations/20270516000400_resumen_semanal_a_dominio.sql
---

# Exportar todos los datos (F-OPS-06, MSF-396)

Bloque **«Exportar todos los datos»** en `/importaciones`. Un administrador de la organización pide un ZIP con una planilla CSV por cada tipo de dato de **toda la organización** (todas las tiendas). Spec: `specs/20270215-100000-notificaciones-ayuda-y-exportacion-total/` (FR-030…FR-041, SC-004…SC-006).

## Cómo funciona

1. La pantalla llama a `public.solicitar_exportacion_total()` (solo administradores; `revoke … from public, anon`, `grant … to authenticated`). Crea un proceso masivo `exportacion_total` con su ejecución y su orden de despacho (`iniciar_proceso_masivo`). Si ya hay uno pendiente o en curso, devuelve ese (`reutilizado = true`): no hay dos a la vez.
2. El flow de Kestra `infra/kestra/flows/exportar-organizacion.yml` reclama `exportar-organizacion-*` y lanza el worker `workers/exportar-organizacion`.
3. El worker lee los conjuntos con `private.conjuntos_exportacion_total()` y sus filas con `private.filas_exportacion_total()` (solo de la organización de la ejecución, en curso), por lotes de 2000 paginados por *keyset* sobre la clave primaria (sin duplicar ni perder filas si la organización está en uso). Escribe un CSV por conjunto (escape de comillas y neutralización de fórmulas) y un `LEEME` dentro de un ZIP en streaming, lo sube a `exportaciones-organizacion/<organizacion>/<ejecucion>.zip` y borra el archivo anterior de la organización.
4. El avance (`total` = cantidad de conjuntos) se ve en el bloque y en la tabla del centro. Un conjunto que falla queda como error del proceso y la exportación cierra `con_errores`; si fallan todos o se agota el reintento, `fallido` con motivo sanitizado. Cancelar corta entre lotes sin dejar ZIP parcial.
5. «Descargar» pide una URL firmada de 60 s; la política de Storage solo deja leer a administradores de esa organización. Solo existe el último archivo.

El bloque no depende de la empresa activa (la exportación es de toda la organización) y no se muestra a quien no administra **ni a un superadmin con acceso de soporte**: la exportación completa la pide y la descarga solo el administrador de la propia organización (`private.es_administrador_propio_de`; la base rechaza al superadmin con 42501).

## Qué incluye y qué excluye

- **Incluye**: la lista permitida de `private.conjuntos_exportacion_total()` (tablas de `public` y `dominio` con datos de negocio de la organización). Las columnas salen de una **lista blanca por columna** (`private.exportacion_total_columnas`): una columna sale solo si tiene `exportar = true`; una columna nueva sin decisión no sale (falla cerrada) y el pgTAP obliga a decidirla. Hoy las tres no exportables son `dominio.tiendas.token_verificacion`, `dominio.newsletter_suscriptores.confirmacion_hash` y `dominio.campana_correo_destinatarios.token_hashes`.
- **Excluye** (documentado en `private.exclusiones_exportacion_total()`, con motivo): colas internas de avisos y correo, registros operativos y de monitoreo, procesos masivos, credenciales y conexiones, e índices o datos derivados.
- **Completitud**: el pgTAP `exportacion_total.test.sql` falla si una tabla con `organizacion_id` de `public` o `dominio` no está en la lista ni en las exclusiones.

## Conjuntos agregados después de la primera versión

- `20270217300007_exportacion_total_conjuntos_nuevos.sql`: `dominio.cotizacion_configuracion` y `dominio.precios_propios_empresa` (llegaron con la integración de `dokploy` en la épica; el pgTAP de completitud lo detectó).
- `20270218500700_exportacion_total_precios_propios_historial.sql`: suma `dominio.precios_propios_historial` (historial inalterable de precios propios, MSF-352) al conjunto exportado; incluye `actor_nombre` como la actividad.
- `20270219170000_exportacion_total_reparaciones_service.sql` (MSF-124): suma `dominio.reparacion_adjuntos` (el registro de fotos y adjuntos de cada reparación: ruta, nombre, tipo, tamaño, quién y cuándo; los archivos viven en el bucket privado `reparacion-adjuntos` y NO viajan en la exportación) y EXCLUYE `dominio.reparacion_enlaces_consulta` (guarda el token de acceso público a la consulta de estado: es una credencial, igual que las invitaciones y las conexiones).
- `20270220170000_exportacion_total_variantes_y_relacionados.sql` (MSF-229): suma `dominio.producto_variantes` (las variantes de cada producto), `dominio.existencias_variante` (el stock por variante y depósito) y `dominio.producto_relacionados` (los productos relacionados) al conjunto exportado; son datos de negocio de la organización y ninguna columna parece un secreto.
- `20270221100009_exportacion_total_precios_masivos_y_promociones.sql`: suma `dominio.actualizaciones_precio` (lotes de actualización masiva de costos y precios, MSF-436) y `dominio.promociones_precio` (MSF-439) al conjunto exportado; es la definición vigente sobre la que se apoya la siguiente.
- `20270222300200_exportacion_total_envios_moto.sql` (MSF-145): suma `dominio.envios_moto` (mensajero, guía, costo, abono y rendición de los envíos en moto) al conjunto exportado, sobre la definición de `20270221100009`.
- Incorporadas después, cada una con su migración aditiva que redefine `private.conjuntos_exportacion_total()` (todas dato de negocio de la organización): `20270321100500_exportacion_total_consulta_items.sql` (`dominio.consulta_items`, líneas de las consultas de pedido), `20270322100200_exportacion_total_presupuestos_tienda.sql` (`dominio.presupuestos_tienda`), `20270334000002_exportacion_total_ordenes_compra.sql` (`dominio.ordenes_compra` y `dominio.ordenes_compra_items`), `20270340000100_exportacion_total_listas_precios.sql` (`dominio.listas_precios`), `20270341000500_exportacion_total_opiniones.sql` (`dominio.opiniones_producto`), `20270342000300_exportacion_total_newsletter.sql` (`dominio.newsletter_configuracion` y `dominio.newsletter_suscriptores`, sin la columna `confirmacion_hash`), `20270349000200_gastos_exportacion_total.sql` (`dominio.gastos`) y `20270420000200_exportacion_total_newsletters.sql` (`dominio.newsletters`).
- Excluidas por motivo, en `private.exclusiones_exportacion_total()`: las tablas de la API pública (claves, llamadas, suscripciones y entregas de webhooks; `20270224110206_exportacion_total_excluye_api.sql`), `dominio.favoritos_cliente` (preferencias privadas de la cuenta web del cliente; `20270320100500_exportacion_total_excluye_favoritos.sql`) y `dominio.resumen_semanal_config` y `dominio.resumen_semanal_envios` (interruptor y cola de envío, no datos de negocio; `20270324100300_exportacion_total_excluye_resumen_semanal.sql`; pasaron de `public` a `dominio` en `20270516000400`, MSF-921).
- `20270217300006_exportacion_total_solo_admin_propio.sql`: la solicitud y la descarga exigen la membresía propia de administrador (`private.es_administrador_propio_de`); un superadmin con acceso de soporte no exporta.

## Agregar un conjunto

Una tabla nueva con `organizacion_id` rompe el pgTAP hasta que se decida. Agregá una migración **nueva** (nunca editar la anterior) que inserte **una fila por columna** en `private.exportacion_total_columnas` (`exportar = true`, o `false` con motivo) —así la tabla entra a `private.conjuntos_exportacion_total()`, que ya no lleva una lista propia de tablas—, o que redefina `private.exclusiones_exportacion_total()` con el motivo. No redefinas `conjuntos_exportacion_total()` con la lista negra anterior: el pgTAP detecta que dejó de leer la tabla de decisiones.

Las tablas `dominio.actualizaciones_precio` (lotes de actualización masiva de precios, sin importes de costo) y `dominio.promociones_precio` (promociones por empresa) se exportan desde la migración `20270221100009_exportacion_total_precios_masivos_y_promociones.sql` (MSF-363).

## Configuración

`EXPORTAR_ORGANIZACION_IMAGEN` (`.env.example`, pasa a Kestra como `ENV_EXPORTAR_ORGANIZACION_IMAGEN` en `infra/kestra/compose.yaml`). La organización necesita una conexión `historial-ventas` (la misma de otras exportaciones); sin ella el pedido falla con `SIN_CONEXION_EXPORTACION` y la pantalla lo explica. Tope del ZIP: 200 MB (`TOPE_EXCEDIDO`, falla no reintentable con código 78).

## Reversión

Las migraciones son aditivas (`…200003_exportacion_total_conjuntos.sql`, `…200004_exportacion_total_solicitud.sql`); su reversión está en el encabezado de cada una (drop de las funciones, la capacidad y el bucket `exportaciones-organizacion`). Sin tablas nuevas en `public`/`dominio`. Para volver atrás sin tocar la base: `git revert -m 1` del merge y quitar el flow de Kestra.

## Identificadores externos de clientes (lote 32 · MSF-596)

`public.clientes_identificadores_externos` ganó `organizacion_id` y entra en la exportación total (`20270507180700`): es el mapeo propio de cada cliente con su identificador en un sistema externo, dato de la organización (no derivado ni de otra organización).

## Endurecimiento (MSF-817, lote 101)

- **Lista blanca por columna** y **paginación por keyset**: arriba. Las columnas `numeric` y `bigint` salen como texto exacto.
- **CSV**: un texto que es solo un número con signo (`-5.25`, `+5491155551234`) ya no lleva el apóstrofo de la neutralización de
  fórmulas (no es una fórmula y se corrompía al reimportar); `+54 9 11…` con espacios, `-2+3`, `=…` y `@…` siguen neutralizados.
- **Flow de Kestra**: 2 intentos de 25 minutos (peor caso ~52 min) frente al lease de 3600 s de la orden (antes 3 × 30 min = 90 min
  podían superar el lease y lanzar un segundo worker). El contenedor remoto se llama `exportar-org-<ejecucion>`; si ya hay uno
  vivo el flow responde `YA_EN_CURSO` (no reintentable) en vez de lanzar otro, y un vigilante (`docker stop`) detiene el contenedor si el worker se pasa
  de 24 minutos (el corte de SSH no lo mataba).
- **ZIP**: los ZIP con más de 7 días se borran al terminar cualquier exportación (limitación en la guía técnica: no hay tarea programada).
- **Cancelación tras subir el ZIP**: ya estaba cubierta (`cancelado()` después de `subir`, con borrado del archivo).
- **Pendiente**: aislamiento con un worker real de otra organización (el CI no puede iniciar sesión como `worker_<org>`).
