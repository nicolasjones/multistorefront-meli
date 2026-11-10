---
owner: tecnico
sources:
  - specs
  - supabase/migrations
  - apps/web/src
---

# Precios masivos y promociones

**Épica:** MSF-363 · **Spec:** `specs/20261104-103000-precios-masivos-y-promociones/` (`spec.md`, `plan.md`, `tasks.md`, `contracts/`) · **Rama:** `epic/MSF-363-precios-y-dolar-precios-masivos-y-promoc` (PR #822, merge `d4675f21`; la épica está integrada en `dokploy`; en `main` llega con la próxima promoción — las citas de este documento salen de `dokploy`) · **Alcance de entrega:** `refine` y `supabase` (sin `kestra`, `superset` ni `workers`).

Historias: F-PRE-10 (MSF-436, actualización masiva de costos y precios) y F-PRE-11 (MSF-439, promociones de precio por empresa). Base: [Precios e IVA](precios-e-iva.md) (MSF-114) y [Configuración del dólar y precio propio](configuracion-dolar-y-precio-propio.md) (MSF-352). Resumen de producto: [Actualizar precios en bloque](../producto/precios-masivos.md) y [Promociones de precio por empresa](../producto/promociones.md).

## Qué cambia

- **F-PRE-10**: una pantalla **Actualizar precios** (`/productos/precios-masivos`) que sube o baja costo y precio de lista de muchos productos, con **vista previa** (solo lee) y **aplicación atómica**. Es de la **organización**, no de una empresa: el precio de lista y el costo son de la organización y no usan la empresa activa.
- **F-PRE-11**: una pantalla **Promociones** (`/productos/promociones`) que programa un precio promocional fijo (sin IVA, en pesos) para un producto en **una** empresa, con `desde`/`hasta`. La tienda muestra el precio vigente con el **anterior tachado** mientras la promoción rige. El estado se **deriva por fecha**: no hay Kestra ni worker.

Ambas historias son independientes entre sí: no comparten tabla, migración ni pantalla; solo comparten el contrato de precios de MSF-114.

## Datos (Principio VII: todo en `dominio`)

Dos tablas nuevas en `dominio` y **ninguna tabla alterada**: la aplicación masiva escribe `dominio.productos.precio_lista` y `dominio.producto_costos.costo`, que ya existían.

| Objeto | Esquema | Migración | Qué es |
|---|---|---|---|
| `actualizaciones_precio` | `dominio` | `20270221100006_actualizaciones_precio.sql` | Un registro por lote aplicado: `organizacion_id`, `actor_id`, `actor_nombre`, `modo` (`porcentaje` \| `planilla`), `parametros jsonb`, `cantidad`, `clave uuid` (única por organización), `creado_en`. RLS por organización; select con `productos` ≥ lectura; **sin escritura directa** (escribe la RPC); `anon` sin privilegios. `parametros` **no guarda importes de costo** (en modo planilla solo la cantidad de filas): la Actividad la ve quien no tiene `rentabilidad`. |
| `promociones_precio` | `dominio` | `20270221100001_promociones_precio.sql` | `id`, `organizacion_id`, `empresa_id`, `producto_id`, `precio_promocional numeric(14,2) > 0` (sin IVA, en pesos), `desde timestamptz`, `hasta timestamptz` (`hasta > desde`), `anulada_at`, `created_at`, `updated_at`. FK compuestas `(empresa_id, organizacion_id)` → `dominio.empresas` y `(producto_id, organizacion_id)` → `dominio.productos`. Índice `(empresa_id, producto_id, desde, hasta)`. RLS por organización; select con `productos` ≥ lectura; **sin política `DELETE`**; escritura solo por RPC; `anon` sin privilegios. |
| `previsualizar_actualizacion_precios`, `aplicar_actualizacion_precios` | `public` (RPC) | `20270221100007_precios_masivos_previsualizar.sql`, `20270221100008_precios_masivos_aplicar.sql` | Superficie de ejecución; no almacenan datos. |
| `calcular_actualizacion_precios` | `private` | `20270221100007_precios_masivos_previsualizar.sql` | **Núcleo único** compartido por la vista previa y la aplicación. |
| `guardar_promocion_precio`, `anular_promocion_precio` | `public` (RPC) | `20270221100002_promociones_precio_rpc.sql` | Superficie de ejecución; no almacenan datos. |
| `promocion_vigente`, `precio_con_iva_visible`, `precio_vigente_empresa`, `precios_promocion_sesion` | `private` | `20270221100003_promociones_precio_vigente.sql` | Cálculo del precio vigente con promoción. |
| `promociones_precio_estado` | `public` (vista `security_invoker`) | `20270221100003_promociones_precio_vigente.sql` | Cada promoción con su estado derivado, el precio normal y el vigente. |
| `catalogo_pagina_por_dominio`, `producto_por_dominio` | `publico` (funciones) | `20270221100004_tienda_precio_anterior.sql` | **Alteradas** (aditivo): suman la clave `precio_anterior` y `precio` pasa a salir del cálculo con promoción. |
| `destacados_por_dominio`, `sugerencias_busqueda_por_dominio`, `busqueda_pagina_por_dominio` | `publico` (funciones) | `20270221100005_tienda_precio_anterior_home_busqueda.sql` | **Alteradas** (aditivo), mismo motivo: un producto no puede salir con dos precios según por dónde entre el cliente. |
| Exportación total de la organización | `private` | `20270221100009_exportacion_total_precios_masivos_y_promociones.sql` | Las dos tablas nuevas se exportan (dato de negocio de la organización). |

Tablas y DER: [Datos y DER](datos.md#precios-masivos-y-promociones-msf-363).

Todas las migraciones son **aditivas** y llevan su reversión en el encabezado. `private` no expone nada a `anon`: cada RPC lleva `revoke … from public, anon` y `grant execute … to authenticated`; `anon` no puede ejecutar ni escribir.

## API

Contrato completo: `specs/20261104-103000-precios-masivos-y-promociones/contracts/precios-masivos-y-promociones.md`.

### Actualización masiva

| RPC | Qué hace | Errores |
|---|---|---|
| `public.previsualizar_actualizacion_precios(p_modo text, p_parametros jsonb)` | **Solo lee.** Devuelve `{ afectados, sin_cambio, con_error, filas[] }`; cada fila trae `sku`, `nombre`, `moneda`, `lista_antes`/`lista_despues`, `costo_antes`/`costo_despues` (solo con `rentabilidad`), `actualizado` (el `updated_at` que se usa para el conflicto) y `error`. Es **la misma fórmula** que aplica la confirmación. | `42501` sin `productos` = edición · `22023` datos inválidos · `54000` más de 5.000 productos |
| `public.aplicar_actualizacion_precios(p_modo text, p_parametros jsonb, p_clave uuid)` | **Aplica**: revalida todo en el servidor (no confía en la vista previa), escribe en **una sola transacción, todo o nada**, registra el lote en `actualizaciones_precio` y devuelve `{ lote_id, aplicados, repetido }`. `p_parametros.versiones` = `{ producto_id: updated_at }` de la vista previa. | `42501` sin permiso (o sin `rentabilidad` = edición si el pedido toca costos) · `40001` conflicto · `22023` filas con error (van en `DETAIL`) o sin cambios · `54000` tope |

Parámetros:

- Modo `porcentaje`: `{ cambia: 'costo'|'precio_lista'|'ambos', alcance: 'todos'|<categoría_id>, porcentaje }`. El alcance cubre **productos activos**; una categoría incluye sus subcategorías (2 niveles).
- Modo `planilla`: `{ filas: [{ fila, sku, costo?, precio_lista? }] }`. Admite productos inactivos; **sin IVA**.

### Promociones

| RPC | Qué hace | Errores |
|---|---|---|
| `public.guardar_promocion_precio(p_id, p_empresa, p_producto, p_precio, p_desde, p_hasta, p_actualizado)` | Crea (`p_id` nulo) o edita. Exige `productos` = edición; valida que empresa y producto sean de la organización; bloqueo optimista por `updated_at`; idempotente; **no edita** una promoción vencida ni anulada; no cambia empresa ni producto. Registra `promocion_precio.programada` / `.actualizada`. | `42501` · `P0002` · `22023` · `23P01` (solape) · `40001` · `22003` |
| `public.anular_promocion_precio(p_id, p_actualizado)` | Anula (programada o vigente). Idempotente; una vencida no se anula. Registra `promocion_precio.anulada`. | `42501` · `P0002` · `22023` · `40001` |
| `public.promociones_precio_estado` (vista, `security_invoker`) | Cada promoción con `estado` derivado (`programada`, `vigente`, `vencida`, `anulada`), `precio_normal` y `precio_vigente` de la empresa. | — |

## Reglas de cálculo

1. **No se guarda ningún precio en pesos.** El precio de lista y el costo son los únicos importes que se escriben; el neto por empresa y el final se calculan al leer (modelo de MSF-114). Por eso, al cambiar lista y costo, **todas las empresas pasan al valor nuevo en la misma transacción**, sin tabla derivada que quede desactualizada.
2. **La promoción se superpone al neto por empresa**, después de la regla de la empresa y antes del IVA: `precio_neto_empresa` → (si rige una promoción) precio promocional → alícuota → interruptor «Precios que ve el cliente» de la empresa. El precio promocional es un valor **fijo** en pesos sin IVA: no se mueve con el dólar ni con una actualización masiva posterior.
3. **El precio normal** (el que ve el cliente sin promoción) sale de `private.precio_final_publico` —el mismo que ya mostraba la tienda—, así que **sin promoción el resultado es idéntico al actual** y `precio_anterior` es lo que el cliente veía antes. Si el precio normal no es calculable (producto no asignado a la empresa, USD sin cotización), el resultado es `null`: no se inventa un precio.
4. **Los estados no se guardan**: `programada`, `vigente` y `vencida` se derivan de `desde`/`hasta` y la hora actual al consultar (Decisión 1 de la spec). Solo `anulada_at` es un dato. No hay Kestra ni worker: **no hay ventana en la que un precio quede vencido por una tarea caída**.
5. El porcentaje se aplica sobre el **precio de lista ya guardado** (en la moneda del producto) y se redondea a 2 decimales; el porcentaje tiene que ser mayor a −100 %. En modo planilla, el importe viene cargado y se acepta tal cual (con el redondeo de la base).
6. **El solape se impide en la base**, no en la pantalla: el disparador `promociones_precio_solape` (`private.validar_solape_promocion_precio`, `security definer`, con candado asesor por `(empresa_id, producto_id)`) rechaza con `23P01` dos promociones **no anuladas** del mismo producto y empresa que se superponen. Las contiguas (`hasta` de una = `desde` de la otra) se permiten: el intervalo es `[desde, hasta)`.

## Frontend

| Pieza | Archivo |
|---|---|
| Pantalla **Actualizar precios** (`/productos/precios-masivos`), protegida por `RequiereAccesoSeccion seccion="productos" nivelMinimo="edicion"` | `apps/web/src/pages/productos/precios-masivos.tsx` |
| Botón **Actualizar precios** en el listado de Productos | `apps/web/src/pages/productos/list.tsx` |
| Planilla, validaciones, clave de idempotencia y traducción de errores | `apps/web/src/lib/preciosMasivos.ts` (sobre `lib/migracionCsv.ts`) |
| Pantalla **Promociones** (`/productos/promociones`), protegida por `RequiereAccesoSeccion seccion="productos"` | `apps/web/src/pages/productos/promociones.tsx` |
| Formulario de alta/edición y diálogo de anulación | `apps/web/src/components/promociones/FormularioPromocion.tsx` |
| Lectura, orden, validaciones y traducción de errores | `apps/web/src/lib/promociones.ts` |
| Precio vigente con el anterior tachado (catálogo, ficha, inicio y búsqueda de la tienda) | `apps/web/src/pages/tienda-publica/catalogo/PrecioTachado.tsx` |
| Rutas y entrada de menú **Promociones** (ícono de etiqueta de oferta) | `apps/web/src/App.tsx`, `apps/web/src/components/navegacion/destinosPanel.ts` |
| Ayuda de la pantalla en el panel **?** | `apps/web/src/ayuda/contenidos/catalogo.ts` |

**Empresa activa:** en **Actualizar precios** no aplica (son datos de la organización). En **Promociones** sí: con una empresa concreta lista y crea para ella; con «Todas mis empresas» lista todas (aparece la columna **Empresa**) y **Nueva promoción** queda deshabilitada con «Elegí una empresa en la barra superior». Al cambiar de empresa se invalidan y recargan todas las consultas, se descartan las filas de la anterior y el diálogo abierto se cierra con aviso («Cambiaste de empresa: cerramos el formulario para no mezclar datos de la anterior.»).

## Guía de prueba

### Prerrequisitos

Una organización con **dos empresas** (para comprobar el aislamiento), un Administrador (`productos` = edición y `rentabilidad` = edición), un Operador (`productos` = edición, **sin** `rentabilidad`), un usuario de Consulta, y productos activos e inactivos con SKU, categorías con subcategorías y al menos un producto en USD. Local con `pnpm dev:supabase`.

### Pasos

1. Entrá a **Catálogo → Productos** y hacé clic en **Actualizar precios** (arriba a la derecha del listado). **Se ve** la pantalla con los dos modos: **Por porcentaje** y **Por planilla**, y el aviso de que los importes van sin IVA.
2. En **Por porcentaje**, elegí **Qué cambia** = Precio de lista, **Alcance** = una categoría y **Porcentaje** = 10. Hacé clic en **Ver vista previa**. **Se ve** la tabla con el precio de lista antes → después por producto y los tres contadores (se actualizan / sin cambio / con error); **no** cambia ningún producto todavía.
3. Cambiá el porcentaje a `-5` y generá la vista previa de nuevo. **Se ve** que los precios bajan un 5 % y que los importes redondeados a dos decimales.
4. En **Por planilla**, hacé clic en **Descargar plantilla CSV**, completá **SKU**, **costo** y **precio_lista** y subila. **Se ve** la vista previa fila por fila, con los errores numerados si el SKU no existe o está repetido.
5. Con filas con error, **Confirmar actualización** está deshabilitado y aparece el aviso «Hay filas con error: corregilas y generá la vista previa de nuevo. No se puede confirmar mientras tanto.». Corregí la planilla y volvé a subirla: **se ve** que el botón se habilita.
6. Hacé clic en **Confirmar actualización**. **Se ve** el cuadro «¿Aplicar la actualización?» con la cantidad de productos y el texto «Se aplica todo junto: si algo falla, no se cambia nada.». Hacé clic en **Cancelar**: **se ve** que no cambió ningún producto.
7. Hacé clic otra vez en **Confirmar actualización** y en **Aplicar**. **Se ve** «Listo: se actualizaron N productos.» y, en la ficha de un producto de cada empresa, el precio nuevo (las dos empresas quedan consistentes entre sí).
8. Volvé a **Actualizar precios** y poné un porcentaje que lleve algún precio a cero o negativo. **Se ve** que esa fila queda con el error «El precio de lista quedaría en cero o menos» y que **no** se puede confirmar.
9. Con el Operador (sin `rentabilidad`), entrá a la pantalla. **Se ve** que **Costo** no aparece en «Qué cambia» ni en la vista previa, y que una planilla con columna `costo` es rechazada.
9. En **Catálogo → Promociones**, con una empresa concreta elegida arriba, hacé clic en **Nueva promoción**. Elegí un producto, un precio y las fechas. **Se ve** el aviso «Promoción programada.» y la promoción con estado **Programada** si la fecha de inicio es futura.
10. Con la misma empresa, creá otra promoción del **mismo producto** con fechas que se superpongan. **Se ve** el mensaje de que ya hay otra promoción que se solapa y **no** se guarda.
11. Esperá (o simulá) el passage de la fecha de inicio: en la tienda de esa empresa, el producto aparece con el **precio promocional** y el **precio anterior tachado**; en la otra empresa, el precio es el de siempre.
12. Pasada la fecha de fin, **se ve** que la tienda vuelve al precio normal **sin ninguna acción**, y la promoción queda en estado **Vencida**.
13. Con una promoción **Vigente**, hacé clic en **Anular** y confirmá. **Se ve** el aviso «Promoción anulada.» y el estado **Anulada**; el producto vuelve al precio normal de inmediato.
14. Cambiá la empresa activa de arriba. **Se ve** que la lista se recarga con las promociones de la nueva empresa y que no queda ninguna fila de la anterior.
15. Con «Todas mis empresas» elegida, **se ve** la columna **Empresa** y el botón **Nueva promoción** deshabilitado con «Elegí una empresa en la barra superior».
16. Con un usuario de Consulta, entrá a **Catálogo → Promociones**. **Se ve** la lista en solo lectura, sin botón **Nueva promoción** ni botones **Editar**/**Anular**; en **Actualizar precios**, en cambio, la pantalla **no** se abre (acceso restringido, porque pide `productos` = edición).

### Resultado esperado

- **Given** productos con lista y costo, **When** se elige «Por porcentaje» y se genera la vista previa, **Then** la pantalla muestra antes → después por producto **sin escribir nada**; recién al confirmar se aplica, y se aplica **todo o nada**.
- **Given** una planilla con un SKU inexistente o repetido, **When** se sube, **Then** la vista previa señala esa fila y **no deja confirmar**; no cambia ningún producto.
- **Given** un producto editado por otra persona después de la vista previa, **When** se confirma, **Then** se informa el conflicto y **no se aplica nada**.
- **Given** el mismo lote enviado dos veces, **Then** se aplica **una sola vez**.
- **Given** un usuario sin `rentabilidad`, **Then** no ve ni puede cambiar costos; solo precios de lista.
- **Given** una promoción con `desde` futuro, **Then** figura «Programada» y la tienda sigue mostrando el precio normal.
- **Given** que llega `desde`, **Then** la tienda muestra el precio promocional con el anterior tachado, sin ninguna acción.
- **Given** que llega `hasta`, **Then** vuelve el precio normal, sin tarea programada ni acción.
- **Given** dos promociones del mismo producto y empresa que se solapan, **Then** no se guarda y se explica por qué.
- **Given** una empresa que muestra los precios con IVA, **Then** el precio promocional y el tachado se ven con IVA.
- **Given** una promoción de la empresa A, **Then** la empresa B no la ve ni la hereda.

### Cómo automatizarlo

Rótulos propuestos: el código de la épica no embebe rótulos de Jira, así que los `T0yy` siguen la numeración del `tasks.md` de la spec (T001…T024) y se ajustan al abrir el seguimiento.

| Recorrido | Rótulo | Prueba |
|---|---|---|
| Vista previa por porcentaje (sube/baja, alcance, redondeo) | `[MSF-363:T002]` | pgTAP `supabase/tests/database/precios_masivos.test.sql` + Vitest `apps/web/src/pages/productos/precios-masivos.test.tsx` |
| Planilla (BOM, CRLF, coma/punto y coma, SKU obligatoria) | `[MSF-363:T005]` | Vitest `apps/web/src/lib/preciosMasivos.test.ts` |
| Atomicidad, idempotencia, conflicto por `updated_at`, aislamiento | `[MSF-363:T004]` | pgTAP `precios_masivos.test.sql` |
| Evento de actividad sin importes de costo | `[MSF-363:T001]` | pgTAP `precios_masivos.test.sql` |
| Vista previa y confirmación en pantalla | `[MSF-363:T009]` | E2E `apps/web/e2e/precios-masivos.e2e.ts` (pendiente de correr con `pnpm dev:supabase`) |
| Solape, estados derivados, IVA con y sin interruptor | `[MSF-363:T015]` | pgTAP `supabase/tests/database/promociones_precio.test.sql` |
| Pantalla de promociones (cambio de empresa, «Todas mis empresas») | `[MSF-363:T019]` | Vitest `apps/web/src/pages/productos/promociones.test.tsx`, `apps/web/src/lib/promociones.test.ts` |
| Precio anterior tachado en la tienda | `[MSF-363:T018]` | Vitest `apps/web/src/pages/tienda-publica/catalogo/PrecioTachado.test.tsx` + E2E `apps/web/e2e/tienda-promocion.e2e.ts` (pendiente de correr) |

## Pruebas

| Tipo | Archivos |
|---|---|
| pgTAP | `supabase/tests/database/precios_masivos.test.sql`, `promociones_precio.test.sql` y `aislamiento_rls.test.sql` (recorre `public` + `dominio`; este último lo agrega la rama `feat/story-MSF-815`, commit `8ac2a403`, que **todavía no está integrada en `dokploy`**) |
| Vitest | `apps/web/src/lib/preciosMasivos.test.ts`, `apps/web/src/lib/promociones.test.ts`, `apps/web/src/pages/productos/precios-masivos.test.tsx`, `apps/web/src/pages/productos/promociones.test.tsx`, `apps/web/src/pages/tienda-publica/catalogo/PrecioTachado.test.tsx` |
| E2E | `apps/web/e2e/precios-masivos.e2e.ts`, `apps/web/e2e/tienda-promocion.e2e.ts` (escritos pero **no ejecutados** en la máquina de la épica: requieren `pnpm dev:supabase`; nota de desvío en `tasks.md`) |

## Eventos de actividad

| Tipo | Cuándo | Detalle |
|---|---|---|
| `precios.actualizacion_masiva` | Lote de actualización masiva aplicado | «Actualización masiva de precios por porcentaje (10 %): 24 producto(s)» o «Actualización masiva de precios por planilla: 24 producto(s)». **Sin importes de costo**: lo ve quien no tiene `rentabilidad`. `actualizaciones_precio.parametros` tampoco guarda costos (en modo planilla solo la cantidad de filas). La empresa es `null` (el lote es de la organización). |
| `producto.precio_actualizado` | Cambia el precio de lista o el costo de un producto | Disparadores preexistentes de MSF-114. Un producto **sin cambio real no genera evento**. |
| `promocion_precio.programada` / `.actualizada` / `.anulada` | Se crea, edita o anula una promoción | «Programó la promoción de <producto> en <empresa>: $ <precio> del <desde> al <hasta>». Lleva el precio promocional (dato público de la tienda), nunca costos. |

## Reversión

Todas las migraciones son **aditivas** y llevan su reversión en el encabezado. Orden inverso:

1. `20270221100009` (exportación total) → `20270221100008` (`aplicar_actualizacion_precios`) → `20270221100007` (`previsualizar_actualizacion_precios` y `private.calcular_actualizacion_precios`) → `20270221100006` (`drop table dominio.actualizaciones_precio`).
2. `20270221100005` (home y búsqueda) → `20270221100004` (catálogo y ficha) → `20270221100003` (`private.precio_vigente_empresa`, `private.promocion_vigente`, `private.precio_con_iva_visible`, `private.precios_promocion_sesion`, vista `public.promociones_precio_estado`) → `20270221100002` (`guardar_promocion_precio`, `anular_promocion_precio`) → `20270221100001` (`drop table dominio.promociones_precio`).

Las que borran tabla (`actualizaciones_precio`, `promociones_precio`) piden **exportar los datos antes** y van en una migración posterior, nunca en el PR que las creó. La clave `precio_anterior` extra de las funciones públicas es **aditiva**: los clientes la ignoran.

Los precios ya aplicados **no se deshacen solos**: se corrigen con otra actualización (la Actividad deja qué producto cambió). A nivel de épica, el cierre es un merge commit: `git revert -m 1 <hash>` deshace la épica completa.

## Fuera de alcance y pendientes

- **Carrito, comprobantes, POS y Mercado Libre no cobran el precio promocional** (Decisión 6 de la spec): solo se muestra en la tienda. Queda como pregunta para Nicolás (riesgo: cobrar distinto de lo mostrado).
- **El precio por escala y los precios de cliente por dominio no se adoptan** (Decisión 7): siguen usando el precio sin promoción. Seguimiento **MSF-816**.
- **Las escalas de precio (F-PRE-15) no se actualizan** con la masiva: subir el precio de lista puede dejar el precio de una escala (x5, x10, x50) por debajo del precio de lista nuevo (Decisión 5). Actualizarlas es otra historia.
- **Los precios propios por empresa (F-PRE-08, MSF-352) quedan excluidos** de la actualización masiva cuando existen (Decisión 2); la promoción sí se superpone al neto que ya incluye el precio propio.
- **Las promociones de Mercado Libre** se gestionan en Mercado Libre; el sistema solo las detecta (F-MLS-07, Etapa 2). Nada de eso está aquí.
- **El plan de F-PRE-10 no usa el Centro de importaciones** (F-IMP-01, Etapa 2): reutiliza `lib/migracionCsv.ts` en el navegador (Decisión 3). Si F-IMP-01 llega después, puede reemplazar solo la carga del archivo; la RPC no cambia.
- **E2E sin ejecutar**: `precios-masivos.e2e.ts` y `tienda-promocion.e2e.ts` quedaron escritos pero no corridos en la máquina de la épica (sin Supabase local). Los valida el CI.
- **TODO (dueño: Documentador, tras el merge de la épica):** generar las capturas del manual con `pnpm docs:capturas` para la pantalla **Actualizar precios** (los dos modos, la vista previa y el cuadro de confirmación), para la pantalla **Promociones** (lista, formulario y anulación) y para una ficha de la tienda con el precio anterior tachado. La herramienta de capturas del manual (`pnpm docs:capturas`, `apps/web/e2e/capturas/` y `pnpm demo:dataset`) **no existe en este repo**: lo más cercano es `pnpm --filter @platform/web pantallas:capturar`, que renderiza el prototipo y, con `PANTALLAS_APP_URL` y un `storageState` de Playwright, también las rutas de la app. Hasta entonces las páginas de producto describen el comportamiento **sin imágenes nuevas**: no se inventó ninguna.
- **TODO (dueño: Nicolás):** decidir si el carrito, los comprobantes y la venta de mostrador deben cobrar el precio promocional (Decisión 6).

## Decisiones de la spec

| # | Decisión |
|---|---|
| 1 | **Cómo vencen las promociones: consulta por fecha.** Sin Kestra ni worker: el precio vigente se calcula al leer comparando `desde`/`hasta` con la hora actual. Alternativa descartada: una tarea programada que cierre promociones (más piezas, y un fallo deja precios promocionales de más). |
| 2 | **Convivencia con los precios propios por empresa: la masiva no los toca.** La masiva cambia lista y costo central; un precio propio es un valor fijado a mano por empresa y queda excluido (el punto de extensión está en `private.precio_neto_empresa`). La promoción sí se superpone al neto, precio propio incluido. |
| 3 | **Planilla: lector CSV existente, no el Centro de importaciones** (F-IMP-01 está en Etapa 2). |
| 4 | **Alcance del porcentaje:** «todos los activos» o «una categoría» (con sus subcategorías). Otros filtros (proveedor, marca) quedan fuera. |
| 5 | **Escalas de precio:** la masiva no las cambia. |
| 6 | **Ventas y pedidos:** el precio promocional se muestra en la tienda; que el carrito, los comprobantes y el POS cobren el promocional queda como pregunta para Nicolás. |
| 7 | **Superficies de la tienda:** catálogo, ficha, inicio/destacados y búsqueda muestran el mismo precio vigente y `precio_anterior`. Quedan fuera el precio por escala y los precios de cliente por dominio (seguimiento MSF-816). |
| 8 | **Editar y anular una promoción** no figuran literalmente en la épica; se asumen como parte de «programar» (sin ellas una carga equivocada no tiene salida). |
