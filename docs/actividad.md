# Actividad e historial (F-AUD-01)

Registro transversal de «qué pasó, quién lo hizo y cuándo» de una organización.
Spec: `specs/20261016-120000-actividad-y-ambientes/` (épica MSF-455, historia MSF-463).

## Qué se ve

- Destino de menú **Actividad** (`/actividad`, sección `actividad` de la matriz de permisos), en *Operación*.
  Carga diferida: la pantalla se descarga al entrar.
- Listado del más reciente al más antiguo: **Cuándo** (hora de `America/Argentina/Buenos_Aires`),
  **Tipo**, **Tienda** («Compartido» si el evento no es de una empresa), **Detalle** y **Quién**
  («Sistema» si no hay actor). Nunca se muestran identificadores técnicos.
- Filtros combinables: período (hoy / 7 / 30 días / todo), tienda, usuario y tipo; búsqueda
  «Buscar en la actividad» (sin distinguir mayúsculas ni tildes; `%` y `_` son literales); paginación
  en servidor («1–10 de N»).
- El filtro **Tienda** lista las empresas accesibles y **sigue la empresa activa** de la barra superior
  (F-ROL-06): al cambiarla arriba, la Actividad se filtra por esa tienda. El filtro de píldoras
  (`FiltroEmpresa`) puede fijar otra tienda o «Todas» sin cambiar la activa persistida
  (`hooks/useFiltroPorEmpresaActiva.ts`).
- Cada fila tiene **Ver detalle**: abre el detalle del evento (cuándo, tipo, tienda, quién, detalle) y, campo por
  campo, el valor **Antes → Después** (F-AUD-02). Es solo consulta: no hay «deshacer». Un evento sin valores
  (anterior a F-AUD-02 o de un tipo no sensible) dice «Este evento no tiene valores registrados.». Si cambiás de
  empresa en la barra superior con el detalle abierto, se cierra con un aviso.
- Botón **Exportar** en el encabezado, solo para quien puede exportar (ver «Exportar a CSV (F-AUD-03)» más abajo).

## Permisos

Los fija únicamente la matriz (`private.nivel_seccion('actividad')`), tanto en la pantalla como en la RLS:

| Rol | Nivel hoy | Ve |
|-----|-----------|----|
| Administrador | `edicion` | todos los eventos de su organización |
| Operador | `lectura` | todos, incluidos los de usuarios y permisos |
| Administración | `lectura` | todos |
| Consulta, Mostrador, Depósito, Miembro | `ninguno` | nada (sin menú, la ruta redirige, la consulta directa devuelve 0 filas) |

**Exportar** (F-AUD-03) pide además la acción `exportar` y el nivel `edicion` en Actividad: por defecto solo el Administrador.

Si la matriz cambia, la pantalla y la RLS siguen a la matriz sin tocar código. Nadie —tampoco el
administrador— edita ni borra eventos desde la app: el registro es solo de agregado e **inalterable** (ver abajo).

## Esquema de datos

`public.registro_actividad` (esquema **`public`**: tabla transversal de plataforma, como
`eventos_membresia`; no es una entidad de negocio, así que no va en `dominio`). Migración aditiva
`20261016120000_registro_actividad.sql`.

| Columna | Detalle |
|---------|---------|
| `id` | uuid |
| `organizacion_id` | FK a `organizaciones`; la fija el servidor |
| `empresa_id` | opcional, sin FK (la empresa vive en `dominio`) |
| `actor_id` / `actor_nombre` | quién lo hizo; el nombre es una foto al registrar (el perfil es self-only por RLS) |
| `tipo` | formato `entidad.accion` (`producto.creado`, `empresa.pausada`), máx. 60 |
| `detalle` | texto legible, máx. 500 (se trunca con «…») |
| `creado_en` | fecha del servidor |

RLS: solo `select` para `authenticated`, con `organizacion_id = private.organizacion_id()` y nivel
`lectura`/`edicion` en `actividad`. Sin policies ni grants de escritura; sin privilegios para `anon`.

## Contrato de registro para otros componentes (SC-005)

Desde una RPC de otro componente (`security definer`, en la **misma transacción** que la operación):

```sql
perform private.registrar_actividad('producto.creado', 'Creó el producto Lámpara', p_empresa_id);
```

- `p_tipo`: `entidad.accion` en minúsculas y `_` (`^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$`).
- `p_detalle`: no vacío, texto para personas.
- `p_empresa_id`: opcional; si se pasa, debe ser de la organización (si no, `22023`).
- La **organización** y el **actor** salen de la sesión (`private.organizacion_id()`, `auth.uid()`): no se
  eligen. Sin sesión u organización, `42501`.
- Si la RPC de origen revierte, el evento también (un reintento no pierde ni duplica el evento).

Desde el frontend se usa `public.registrar_actividad(p_tipo, p_detalle, p_empresa_id)`, que exige
`private.puede_escribir()` y acepta solo `empresa.pausada`, `empresa.reactivada` y `empresa.actualizada`
(`42501` para cualquier otro tipo; los `usuario.*`, `invitacion.*` y `permisos.*` los registra solo el
servidor; `22023` sin empresa). `private.registrar_actividad` no es ejecutable por `authenticated`. Límite
conocido: `p_detalle` es texto libre del cliente (no está atado al tipo: un Administrador puede registrar un `empresa.*` sin haber editado nada, solo en su organización; el actor lo fija el servidor) y se arma en servidor recién cuando la edición pase a RPC; no hay tope de frecuencia, y mover el registro de `empresa.*` a la misma transacción que la edición
queda como mejora cuando esa edición pase a una RPC. `actor_nombre` guarda una foto del nombre o correo del
actor sin política de retención definida (decisión de producto pendiente). `lib/eventosActividad.ts`
sigue siendo el punto de emisión: `lib/destinoActividad.ts` (instalado en `main.tsx`) lleva los
`empresa.*` a esa RPC; un fallo del registro **no** revierte la edición.

Los eventos de membresía los escribe un trigger `after insert` en la misma transacción que la RPC de origen: acoplamiento intencional, para que el evento y el cambio nunca diverjan (si el registro falla, el cambio se revierte).

Para mostrar un tipo nuevo con nombre propio, sumarlo a `ETIQUETA_TIPO_ACTIVIDAD` en `lib/actividad.ts`;
sin eso se muestra igual, legible (`stock.ajuste_manual` → «Stock ajuste manual»).

## Eventos de Acceso

- `usuario.agregado`, `usuario.rol_cambiado`, `usuario.removido`, `usuario.suspendido`,
  `usuario.reactivado`, `invitacion.enviada|reenviada|cancelada`: los refleja el trigger
  `registrar_actividad_membresia` desde `eventos_membresia`, sin modificar las RPC de Acceso.
- `permisos.matriz_guardada` y `permisos.matriz_restablecida`: `guardar_matriz_permisos` y
  `restablecer_matriz_permisos` pasan de un `raise log` a registrar el evento.
- `usuario.empresa_activa_cambiada` (etiqueta «Cambio de empresa activa», F-ROL-06): lo registra
  `cambiar_empresa_activa` en la misma transacción, con la empresa elegida; ver `docs/empresa-activa.md`.
- `usuario.empresas_asignadas` (etiqueta «Empresas asignadas», F-ROL-07): lo registra
  `asignar_empresas_usuario` en la misma transacción que el reemplazo de asignaciones; ver
  `docs/usuarios-y-empresas.md`.
- `cliente.creado|editado|archivado|restaurado` (F-CLI-01): el trigger `registrar_actividad_cliente` los
  registra en la misma transacción, solo con sesión y ante cambios reales; el detalle lleva «Nº <número> ·
  <nombre>», sin datos de contacto.
- `cliente.fusionado` (F-CLI-18, MSF-447): `fusionar_clientes` lo registra en la misma transacción; el detalle nombra a
  los dos clientes («Nº <n> · <nombre>»), sin DNI/CUIT.
- `producto.creado` (F-CAT-02): el trigger `registrar_actividad_producto` lo registra en la misma transacción,
  solo con sesión; el detalle lleva «<nombre> (SKU …)», sin costo ni precio. Ver `docs/catalogo.md`.
- `producto.editado` (F-CAT-04): el trigger `registrar_actividad_producto_editado` lo registra en la misma
  transacción, solo con sesión y **solo ante cambios reales** (`updated_at` avanzó; un cambio de estado `activo`
  no cuenta; lo cubre el pgTAP `catalogo_actualizar_producto`); mismo detalle, sin costo ni precio.
- `producto.activado|desactivado` (F-CAT-06): el trigger `registrar_actividad_producto_estado` los registra en la
  misma transacción, solo con sesión y ante un cambio real de `activo`; detalle «Activó|Desactivó el producto
  <nombre> (SKU …)», sin costo ni precio; lo cubre el pgTAP `catalogo_estado_producto`.
- `producto.imagen_agregada` y `producto.imagen_eliminada` (F-CAT-05): el trigger `producto_imagenes_registrar_actividad`
  los registra en la misma transacción y solo con sesión; el detalle nombra el producto («Agregó una imagen de <nombre>
  (SKU …)»), sin ruta de archivo ni costo. Lo cubre el pgTAP `catalogo_producto_imagenes`.
- `producto.empresas_actualizadas` (F-CAT-07): los triggers por sentencia de `dominio.producto_empresa` lo registran en la
  misma transacción, solo con sesión y **solo ante cambios reales**; un evento por guardado con el detalle «Cambió las
  empresas del producto <nombre> (SKU …): agregó …; quitó …», sin precios ni costo. Lo cubre el pgTAP
  `catalogo_producto_empresa`. Ver `docs/catalogo.md`.
- `proveedor.creado|editado|desactivado|reactivado` (F-PRV-01): los triggers `registrar_actividad_proveedor_alta` y
  `registrar_actividad_proveedor` los registran en la misma transacción, solo con sesión y ante cambios reales
  (`updated_at` avanzó; repetir un estado o guardar sin cambios no duplica); detalle «Creó|Editó|Desactivó|Reactivó
  el proveedor <razón social>», sin CUIT ni identificadores. Lo cubre el pgTAP `proveedores`. Ver `docs/proveedores.md`.
- `proveedor.contacto_agregado|contacto_principal_cambiado` (F-PRV-08): las RPC `agregar_contacto_proveedor` y
  `marcar_contacto_principal` los registran en la misma transacción por `private.registrar_actividad_contacto_proveedor`;
  detalle con la razón social y el nombre del contacto, **sin correo ni teléfono**. Lo cubre el pgTAP
  `proveedores_contactos`.
- `cuenta_cobro.creada|editada|desactivada|reactivada` (F-VTA-03): los triggers
  `registrar_actividad_cuenta_cobro_alta` y `registrar_actividad_cuenta_cobro` los registran en la misma transacción,
  solo con sesión y ante cambios reales (`updated_at` avanzó; repetir «No usar» no duplica; un cambio solo de
  «Disponible en» cuenta como edición); detalle «Creó|Editó|Marcó «No usar» en|Reactivó la cuenta de cobro <nombre>»,
  **sin CBU ni CUIT**. Lo cubre el pgTAP `cuentas_cobro`. Ver `docs/cuentas-cobro.md`.
- `categoria.creada|editada|reordenada|eliminada` (F-CAT-08): los triggers por sentencia de `dominio.categorias` los registran en la
  misma transacción, solo con sesión y **solo ante cambios reales**; la visibilidad por empresa cuenta como edición. Las RPC marcan la
  transacción para que un reordenado emita **un** evento («Reordenó las categorías (N cambios)») y la eliminación no deje un «editada»
  por cada subcategoría que sube. Detalles: «Creó la categoría|subcategoría <ruta>», «Editó la categoría <ruta>», «Eliminó la categoría
  <ruta>: N productos quedaron sin categoría; M subcategorías subieron a raíz». Lo cubre el pgTAP `catalogo_categorias`. Ver `docs/catalogo.md`.
- `producto.categoria_asignada` (F-CAT-08): el trigger `productos_actividad_categoria` lo registra en la misma transacción, solo con
  sesión y ante un cambio real de `categoria_id`; detalle «Asignó la categoría <ruta> al producto <nombre> (SKU …)» o «Quitó la categoría
  del producto <nombre> (SKU …)», sin costo ni precio. La baja de una categoría la cubre `categoria.eliminada` (no genera un evento por
  producto). Lo cubre el pgTAP `catalogo_categorias`. Ver `docs/catalogo.md`.
- `modelo.creado|editado|desactivado|reactivado` y `estado.creado|editado|desactivado|reactivado|reordenado`
  (F-SVC-01, Service técnico): los triggers `registrar_actividad_modelo[_alta]` y `registrar_actividad_estado[_alta]` los
  registran en la misma transacción, solo con sesión (el sembrado no registra) y ante cambios reales; detalle «Creó|Editó|
  Desactivó|Reactivó el modelo <equipo> <modelo>» / «el estado de reparación <nombre>», sin ids. Lo cubre el pgTAP
  `service_catalogos`. Ver `docs/service-tecnico.md`.
- `reparacion.creada|editada` (F-SVC-02, Service técnico): los triggers `registrar_actividad_reparacion_alta` y
  `registrar_actividad_reparacion` los registran en la misma transacción, solo con sesión y ante cambios reales;
  detalle «Creó|Editó la reparación R-000N», con el código visible y nunca ids. Un cambio que solo toca estado,
  entrega o anulación no genera `reparacion.editada` (esos eventos son de F-SVC-03). Lo cubre el pgTAP
  `service_reparaciones`. Ver `docs/service-tecnico.md`.
- `reparacion.estado_cambiado|entregada|anulada` (F-SVC-03, Service técnico): el trigger
  `registrar_actividad_reparacion_estado` los registra en la misma transacción que las RPC
  `cambiar_estado_reparacion`, `registrar_entrega_reparacion` y `anular_reparacion`, solo con sesión. Un único evento
  por operación (la entrega cambia el estado pero solo registra `reparacion.entregada`); elegir el estado actual no
  registra nada. Detalle «Cambió la reparación R-000N de <estado> a <estado>», «Entregó la reparación R-000N
  (<estado>) a <quién>» y «Anuló la reparación R-000N: <motivo>», con nombres y código visible, nunca ids. Lo cubre el
  pgTAP `service_estado_entrega`. Ver `docs/service-tecnico.md`.
- `reparacion.item_agregado` y `reparacion.item_quitado` (F-SVC-06, Service técnico): los triggers
  `reparacion_items_registrar_actividad_alta` y `_baja` los registran en la misma transacción que las RPC
  `agregar_item_reparacion` / `quitar_item_reparacion`, solo con sesión (migraciones y sembrados no registran) y
  ante cada alta/baja real. El detalle nombra el tipo, la descripción y la cantidad del ítem y el código visible de la
  reparación (`R-000N`), nunca ids; el evento lleva la tienda de la reparación. Lo cubre el pgTAP
  `service_items`. Ver `docs/service-items.md`.
- `reparacion.comprobante_generado` (F-SVC-13, Service técnico): lo registra `private.registrar_actividad` en la
  misma transacción que la RPC `generar_comprobante_reparacion` (solo cuando el comprobante se crea; una repetición
  idempotente no vuelve a registrar). Detalle «Generó la factura <número> de la reparación R-000N», con el código
  visible y nunca ids; lleva la tienda de la reparación. Lo cubre el pgTAP `service_cobro`. Ver
  `docs/service-cobro.md`.
- `reparacion.aviso_solicitado`, `reparacion.aviso_enviado` y `reparacion.aviso_fallido` (F-SVC-14, Service técnico):
  `private.registrar_actividad` registra `aviso_solicitado` en la misma transacción que la RPC
  `avisar_cliente_reparacion` (solo cuando se crea el aviso; una repetición idempotente no vuelve a registrar), y
  `private.cerrar_aviso_reparacion` registra `aviso_enviado` o `aviso_fallido` una sola vez por aviso (el cierre es
  idempotente), con quien pidió el aviso como actor y la tienda de la reparación. El detalle usa el código visible
  (`R-000N`) y el nombre del estado, nunca ids ni el correo del cliente. Lo cubre el pgTAP `service_avisos`. Ver
  `docs/service-avisos.md`.
- `comprobante.impreso` y `comprobante.reimpreso` (F-VTA-21, Ventas): los registra la RPC `registrar_impresion` en
  la misma transacción que la fila de `dominio.comprobante_impresiones`. `impreso` es la primera impresión de un
  tipo de documento de un comprobante («Imprimió la factura 00000001», «Imprimió el remito …») y `reimpreso` cada
  una de las siguientes («Reimprimió la factura …»). Llevan la tienda del comprobante y el actor de la sesión; el
  detalle nombra el documento y el número, nunca ids. Lo cubre el pgTAP `ventas_impresion_marcas`. Ver
  `docs/ventas-impresion.md`.
- `presupuesto.enviado_por_correo` y `presupuesto.envio_fallido` (F-VTA-20, Ventas): los registra
  `private.cerrar_envio_correo` cuando el flow `comprobantes-correo` de Kestra cierra el envío de un presupuesto, con la
  tienda del presupuesto y como actor quien pidió el envío («Envió por correo el presupuesto P-0001 a
  cliente@…», «No se pudo enviar por correo el presupuesto P-0001 a …»). Se registra una vez por envío (el cierre es
  idempotente) y nunca lleva el mensaje del SMTP. Lo cubre el pgTAP `ventas_impresion_presupuesto`. Ver
  `docs/ventas-impresion.md`.
- No se reconstruye el historial anterior a la migración.

## Lectura

- `public.listar_actividad(p_desde, p_hasta, p_empresa, p_actor, p_tipo, p_texto, p_pagina, p_tamano)`:
  `security invoker` (rige la RLS), fechas inclusivas en hora de Buenos Aires, tamaño de página acotado a 1–100,
  texto acotado a 100 caracteres. Devuelve la página y el `total` del filtro.
- `public.opciones_actividad()`: tipos y usuarios presentes, para los filtros (hasta 200 de cada uno).

## Datos de ejemplo

`supabase/seed.sql` siembra unos eventos por organización sin historial (solo local, tras `supabase db reset`).
Para sembrar una organización puntual en local/staging, insertar filas en `public.registro_actividad` como
`postgres`; nunca en producción.

## Exportar a CSV (F-AUD-03)

Spec: `specs/20261102-100000-auditoria-avanzada-y-soporte/` (US2, FR-010…FR-013). El botón **Exportar** del
encabezado baja el historial **con los filtros de la pantalla** (período, tienda, usuario, tipo y búsqueda) y la
**empresa activa** de la barra superior, no solo la página que se ve.

- **Quién**: nivel `edicion` en Actividad **y** la acción `exportar` de la matriz (`private.puede_accion('actividad','exportar')`).
  Por defecto es solo el Administrador; el Operador y Administración, que leen la pantalla, no ven el botón y la
  llamada directa devuelve `42501` (CA-AUD-03-2). El spec y el contrato de MSF-170 ya dicen esto (el nivel `edicion` se
  sumó a la acción porque la historia pide que el Operador de solo lectura no exporte).
- **RPC** `public.exportar_actividad(p_desde, p_hasta, p_empresa, p_actor, p_tipo, p_texto, p_corte, p_cursor_creado_en,
  p_cursor_id, p_limite, p_entregadas, p_exportacion, p_con_total)` (migración `20270210110000`, reemplazada por
  `20270214300001`, que elimina la firma de 9 parámetros): mismos filtros, zona horaria (America/Argentina/Buenos_Aires)
  y orden que `listar_actividad`, así que `total` coincide con el «N» del listado (SC-004). Devuelve
  `{ filas, total, tope, recortado, corte, hay_mas, siguiente, exportacion }`. `security definer` (necesita registrar la exportación;
  el spec decía `invoker`) con chequeo explícito de permiso (`coalesce`: un NULL de `nivel_seccion`/`puede_accion` nunca
  deja pasar) y toda lectura acotada a la organización de la sesión. El superadmin en modo soporte resuelve edición y
  `exportar` por esas funciones. `anon` no ejecuta.
- **Lotes por cursor y corte estable**: se pide de a 1.000 filas con un cursor `(creado_en, id)` (`siguiente` de la
  respuesta anterior) y `LIMIT`, sin recalcular el filtro entero en cada lote. El `total` real se calcula solo en la
  primera llamada (`p_con_total`). La primera respuesta trae `corte` (el instante), que el cliente reenvía: el
  historial sigue creciendo mientras se exporta y sin corte las páginas se correrían.
- **Tope de 50.000 filas** por archivo (RF-AUD-03-3, CA-AUD-03-3). Si el filtro da más, **no se descarga nada**: queda un
  aviso persistente (hasta cerrarlo) «El filtro tiene N filas y el máximo por archivo es 50.000… acotá el período o los
  filtros y exportá de nuevo». Si la base no entrega todas las filas (corte antes de tiempo o conteo distinto del total)
  es un **error** con Reintentar y tampoco se descarga: nunca un archivo parcial.
- **CSV** (`lib/exportarActividad.ts` sobre `lib/exportarCsv.ts`): UTF-8 con BOM, separador `;`, fin de línea CRLF,
  columnas **Cuándo, Tipo, Tienda, Detalle, Quién** (las de la tabla), hora de Buenos Aires, celdas que empiezan con
  `= + - @` neutralizadas con apóstrofo, comillas, `;` y saltos de línea escapados (CA-AUD-03-4), y nombre
  `actividad-AAAA-MM-DD.csv`. No lleva los valores antes/después (fuera de alcance del spec).
- **Estados**: «Exportando…» mientras corre; si falla no se descarga nada y se ofrece **Reintentar**; sin filas dice
  «No hay actividad para exportar.» y no baja archivo. Si se cambia la empresa activa a mitad de la exportación, se
  descarta lo traído (nunca se baja un archivo de otra empresa).
- **Constancia y conteo del lado servidor** (migración `20270217900001`, hallazgo de la revisión independiente de MSF-170):
  la constancia `actividad.exportada` se registra en la **primera llamada** de cada exportación («Inició la exportación
  de N registros de la actividad a CSV (filtros: …)», con los filtros en palabras y sin ids y N = el total real; si
  supera el tope se agrega «(supera el tope de 50000)»). Así quedan cubiertos quien pagina y abandona, y el filtro que excede el tope (la primera
  llamada ya entrega hasta 1.000 filas). El cliente genera un id por corrida (`p_exportacion`);
  `private.exportaciones_actividad` (clave `organizacion_id + usuario_id + id`) guarda `entregadas` y `cerrada`. El tope
  de 50.000 se aplica con ese conteo: `p_entregadas` lo manda el cliente y **se ignora** (queda en la firma por
  compatibilidad). El id se cierra al entregar la última fila o llegar al tope; **reutilizar un id cerrado, incluido el
  reintento de la última página, se rechaza** (`22023`, «Esa exportación ya está registrada: iniciá una nueva»). Esto corrige
  el comentario de `20270214300001`, que decía que un reintento «no vuelve a registrar»: lanza `22023`. Un reintento tras
  un fallo del navegador usa un id nuevo y deja otra constancia (preferible a una exportación sin rastro). La constancia
  se escribe al pedir los datos, no al completarse la descarga en el navegador (la base no ve eso). **El tope de 50.000 es de UX; el control real es la constancia.** Quien use un id nuevo en cada
  página deja una constancia por página, así que el rastro queda; además el servidor rechaza (`22023`, «Superaste el
  límite de 60 exportaciones por hora…») la exportación nueva número 61 de una persona en una hora (uso normal: unas pocas).
  Lo que hace el código (migración `20270218300000`): el alta y el conteo del límite por hora se serializan por
  organización y persona con un candado asesor (`pg_advisory_xact_lock`), así que sesiones en paralelo con ids nuevos
  no esquivan el límite de 60. El tope de 50.000 es **por id**: con ids nuevos cada exportación tiene su propia
  constancia y el volumen máximo por persona es 60 exportaciones por hora. Repetir la misma página (mismo id, mismo
  cursor y un límite que no baja) es idempotente: no suma `entregadas`; con un límite menor se cuenta como entrega
  nueva (criterio conservador, no se puede reciclar el crédito). La primera llamada del id **fija los filtros**
  (hash en `private.exportaciones_actividad`) y el **corte**: otro filtro con el mismo id se rechaza (`22023`, «Los
  filtros no coinciden…») y el `p_corte` de las llamadas siguientes se ignora. Cuando el filtro excede el
  tope, la primera llamada ya entregó hasta 1.000 filas que el navegador descarta; por eso la constancia se escribe ahí,
  con el total real. El hook muestra el mensaje propio de cualquier `22023`. Tipo no
  sensible, dado de alta en `tipos_evento_actividad`.
- **Purga**: `private.depurar_registro_actividad` borra además las filas de `private.exportaciones_actividad` con más de
  **30 días** (decisión conservadora: un id viejo ya no se reutiliza; la constancia vive en el historial de 24 meses).
- **Reversión** (migración posterior): `drop function public.exportar_actividad(date, date, uuid, uuid, text, text, timestamptz, timestamptz, uuid, integer, integer, uuid, boolean);`,
  `alter table private.exportaciones_actividad drop column cerrada, drop column entregadas;` (o `drop table` si se retira todo) y `delete from public.tipos_evento_actividad where tipo = 'actividad.exportada';`.
- **E2E del detalle**: `apps/web/e2e/actividad-detalle.e2e.ts` (cambio de rol con Antes/Después y baja real con «—» del lado nuevo). Con sesión: se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` y el job `application` del CI solo corre `acceso-publico.e2e.ts` (sin kong/postgrest), así que **no está verificado en el CI**: se corre con `pnpm dev:supabase` y `pnpm --filter @platform/web test:e2e actividad-detalle`. El job `e2e-sesion` (`docs/e2e-app.md`) aún no está activo.
- **Pruebas**: pgTAP `exportar_actividad.test.sql` (incluye abandono, `p_entregadas` falso, filtro de exactamente 50.000 filas e id reutilizado); Vitest `exportarActividadCsv.test.ts`,
  `exportarActividad.test.tsx` (hook), `BotonExportarActividad.test.tsx` y E2E `e2e/actividad-exportar.e2e.ts`
  (CA-AUD-03-1/3/4).

## Reversión

En una migración posterior (no en el mismo PR): quitar el trigger `registrar_actividad_membresia` y su
función, restaurar `guardar_matriz_permisos` / `restablecer_matriz_permisos` de
`20261013140000_editar_matriz_permisos.sql`, y luego `opciones_actividad`, `listar_actividad`,
`registrar_actividad` (public y private), `insertar_actividad`, `etiqueta_rol` y la tabla
(exportar el historial antes: la tabla se pierde).

## Repuestos de Service (épica MSF-217)

Agregar o quitar un repuesto sigue registrando `reparacion.item_agregado` / `reparacion.item_quitado` (ver
`docs/service-items.md`); el movimiento de stock asociado queda en el historial de movimientos con origen `service`.
Detalle en `docs/service-repuestos-stock.md` y `docs/service-repuestos-devolucion.md`.


## Registro inalterable con antes y después (F-AUD-02)

Spec: `specs/20261102-100000-auditoria-avanzada-y-soporte/` (épica MSF-170, historia MSF-259). Todo en el
esquema **`public`** (plataforma, Principio VII); migraciones aditivas `20270207100001_registro_inalterable_antes_despues.sql`
y `20270207100002_depurar_registro_actividad.sql`.

- **Catálogo de tipos** `public.tipos_evento_actividad` (`tipo`, `sensible`, `descripcion`; RLS: `select` para
  `authenticated`, nada para `anon`, sin escritura desde la app). Son **sensibles**: `usuario.rol_cambiado`,
  `usuario.removido`, `usuario.suspendido`, `usuario.reactivado`, `permisos.matriz_guardada` y
  `permisos.matriz_restablecida`. Un tipo ausente del catálogo es no sensible. Para marcar uno nuevo, agregar la fila
  en una migración.
- **Valores**: `registro_actividad.valor_anterior` / `valor_nuevo` (`jsonb`, objeto `{campo: valor}`, hasta 8 KB cada uno;
  nullable: los eventos viejos y los no sensibles no los tienen).
- **Inalterable**: triggers `before update`, `before delete` y `before truncate` rechazan con `42501` para cualquier rol
  (también el dueño de la tabla) y se revocó `update, delete, truncate`. Únicas excepciones: el borrado en cascada al
  eliminar la organización (solo si la organización ya no existe) y la depuración por retención.
- **Detalle**: `public.obtener_detalle_actividad(p_id)` (security invoker, rige la RLS; 0 filas si no es de la
  organización o sin permiso; sin acceso para `anon`).
- **Matriz de permisos**: `guardar_matriz_permisos` y `restablecer_matriz_permisos` guardan solo lo que cambió, antes y
  después (`{"Operador · stock": "edicion"}` → `{"Operador · stock": "lectura"}`); si hay tantos cambios que no entran
  en 8 KB, el resto se resume en «… otros cambios». El trigger de membresía guarda rol/estado anterior y nuevo.

### Contrato de `registrar_cambio_actividad`

```sql
perform private.registrar_cambio_actividad(
  'usuario.rol_cambiado', 'Cambió el rol de Carla: Consulta → Mostrador',
  jsonb_build_object('rol', 'Consulta'), jsonb_build_object('rol', 'Mostrador'), p_empresa_id);
```

- Misma regla que `registrar_actividad` (organización y actor de la sesión, misma transacción). Con `insertar_cambio_actividad`
  la organización y el actor llegan por parámetro (triggers).
- Si el tipo es **sensible**, ambos valores son obligatorios: alta → anterior `{}`; baja → nuevo `{}`. Sin ellos, o con más
  de 8 KB, `22023` y la operación de origen se revierte.
- `registrar_actividad` / `insertar_actividad` conservan su firma pero **rechazan** (`22023`) los tipos sensibles.
- Los triggers están en **ENABLE ALWAYS** (`20270217900000`): ni `session_replication_role = replica` ni un `disable trigger` desde otro rol (salvo `alter table ... disable trigger` explícito, como hace el fixture de fechas) los saltean. Casos de borde cubiertos en `registro_actividad_bordes.test.sql` (8192/8193 bytes, `TRUNCATE ... CASCADE`, `service_role`).
- Un test que necesite reordenar fechas de eventos debe apagar el trigger `registro_actividad_inalterable_fila` solo
  mientras lo hace (ver `comprobante_estados.test.sql`).

### Depuración por retención

`private.depurar_registro_actividad(p_hasta default now())` borra los eventos con más de **24 meses** (`p_hasta` nunca pasa de `now()`), deja un evento
`sistema.depurada` («Sistema», sin actor) por organización con la cantidad y es idempotente. Solo la ejecutan
`workers_orquestacion` y `kestra_orquestacion` (el rol con el que corre Kestra). La dispara el flow
`infra/kestra/flows/depuracion-actividad.yml` (todos los días a las 04:00; si la función falla, la ejecución queda en
rojo). El plazo no se edita desde la app. La misma corrida purga las filas de `private.exportaciones_actividad` con más de 30 días.

Reversión: ver el encabezado de cada migración (los eventos escritos se conservan).

## Eventos del centro de importaciones (F-IMP-01)

`importacion.iniciada`, `importacion.finalizada` e `importacion.cancelada` (no sensibles) los escriben las funciones del proceso masivo en la misma transacción: iniciar, cancelar (una vez por pedido) y cerrar o reconciliar. El detalle trae el nombre del proceso y, al finalizar, las cifras «N correctas y M con error»; nunca referencias, motivos de error ni parámetros. Reversión: `delete from public.tipos_evento_actividad where tipo like 'importacion.%';`.
