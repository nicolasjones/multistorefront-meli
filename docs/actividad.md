---
owner: producto
sources:
  - specs
---

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
- Sin botón «Exportar» (fuera de alcance de esta historia).

## Permisos

Los fija únicamente la matriz (`private.nivel_seccion('actividad')`), tanto en la pantalla como en la RLS:

| Rol | Nivel hoy | Ve |
|-----|-----------|----|
| Administrador | `edicion` | todos los eventos de su organización |
| Operador | `lectura` | todos, incluidos los de usuarios y permisos |
| Administración | `lectura` | todos |
| Consulta, Mostrador, Depósito, Miembro | `ninguno` | nada (sin menú, la ruta redirige, la consulta directa devuelve 0 filas) |

Si la matriz cambia, la pantalla y la RLS siguen a la matriz sin tocar código. Nadie —tampoco el
administrador— edita ni borra eventos desde la app: el registro es solo de agregado.

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
- `ingreso.registrado` e `ingreso.anulado` (MSF-219): los registran `public.registrar_ingreso_mercaderia` y
  `public.anular_ingreso_mercaderia` en la misma transacción que el movimiento de stock, solo con sesión.
  El detalle lleva proveedor, empresa, comprobante, unidades y cantidad de productos (y el motivo al anular),
  **sin costos ni importes**; al registrar con actualización de costo no se crea un evento aparte.
- `reparacion.item_agregado` y `reparacion.item_quitado` (F-SVC-06, MSF-199): los registran los disparadores de
  `20261022100600_reparacion_items_actividad.sql` en la misma transacción que la RPC de ítems, solo con sesión;
  el detalle lleva el código visible (`R-0001`) y la descripción del ítem, nunca ids.
- `producto.empresas_actualizadas` (F-CAT-07): los triggers por sentencia de `dominio.producto_empresa` lo registran en la
  misma transacción, solo con sesión y **solo ante cambios reales**; un evento por guardado con el detalle «Cambió las
  empresas del producto <nombre> (SKU …): agregó …; quitó …», sin precios ni costo. Lo cubre el pgTAP
  `catalogo_producto_empresa`. Ver `docs/catalogo.md`.
- `proveedor.creado|editado|desactivado|reactivado` (F-PRV-01): los triggers `registrar_actividad_proveedor_alta` y
  `registrar_actividad_proveedor` los registran en la misma transacción, solo con sesión y ante cambios reales
  (`updated_at` avanzó; repetir un estado o guardar sin cambios no duplica); detalle «Creó|Editó|Desactivó|Reactivó
  el proveedor <razón social>», sin CUIT ni identificadores. Lo cubre el pgTAP `proveedores`. Ver `docs/proveedores.md`.
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

## Reversión

En una migración posterior (no en el mismo PR): quitar el trigger `registrar_actividad_membresia` y su
función, restaurar `guardar_matriz_permisos` / `restablecer_matriz_permisos` de
`20261013140000_editar_matriz_permisos.sql`, y luego `opciones_actividad`, `listar_actividad`,
`registrar_actividad` (public y private), `insertar_actividad`, `etiqueta_rol` y la tabla
(exportar el historial antes: la tabla se pierde).

> **Revisión de fuentes:** 2026-10-25 23:00 — se revisaron las fuentes de esta página (specs, prototipos, migraciones y código) y su contenido no cambia.
