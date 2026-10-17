# Feature Specification: Catálogo · Catálogo alta y edición

**Feature Branch**: `epic/MSF-456-catalogo-catalogo-alta-y-edicion`

**Jira Epic**: MSF-456 — Catálogo · Catálogo alta y edición (spec `catalogo-alta-y-edicion`)

**Created**: 2026-10-17

**Status**: Ready for implementation — la especificación viene completa desde Jira y las 5 decisiones abiertas fueron resueltas por Nicolás (2026-10-16, ver «Decisiones resueltas»).

**Delivery scope**: `refine` (apps/web) y `supabase` (migraciones, RPC, Storage, pgTAP). Sin `kestra`, `superset` ni `workers`.

**Prioridad / Hito**: P0 · Hito 1 (6 al 30 de octubre de 2026) · 26 h (valor del documento del componente; la suma por talla da ~40 h, se mantiene 26 h) · alcance diciembre.

**Dependencias**:
- Bloqueada por: MSF-455 (Actividad y ambientes: `registro_actividad`; `private.nivel_seccion` llega por MSF-125 → MSF-455) y MSF-138 (Empresas: `empresas` y `producto_empresa`). `registro_actividad`, `nivel_seccion` y `puede_accion` ya están en `main`.
- Bloquea a: MSF-160 (Catálogo · listado y categorías, lee `productos`) y MSF-205 (Proveedores y productos, asigna proveedor al producto).
- Relacionada, sin bloqueo: MSF-114 (Precios e IVA: calcula el precio en pesos y el IVA) y MSF-117 (Sistema de diseño).

**Input**: Epic MSF-456. Objetivo: «Al terminar, el equipo puede cargar un producto nuevo con sus fotos, corregirlo, desactivarlo sin perderlo, y el sistema impide repetir SKU; todo queda en Actividad.»

**Regla de fuentes** (literal de la épica):
- Comportamiento y datos: mandan los requisitos y escenarios de esta spec.
- Qué se ve (disposición, textos, estados, popups, flujos): el prototipo validado es referencia visual, no hace falta que quede idéntico.
- Cómo se construye: mandan el template y el sistema de diseño (MSF-117, `docs/sistema-de-diseno.md`). No se copia HTML ni CSS: se reproduce con los componentes del template y los tokens.
- El prototipo muestra más que estas historias: se implementa solo lo que piden F-CAT-02…06.
- Si algo no se puede igualar: lo más cercano, sin inventar, anotando la diferencia en el PR. Si prototipo y requisitos se contradicen: requisitos para el comportamiento, prototipo para lo visual, y la contradicción queda anotada en el PR.
- Prototipos (solo lectura, ya presentes en el árbol de trabajo; la rama `design/prototipo` no existe en `origin` hoy): `design/pantallas/ProductoAlta.dc.html`, `design/pantallas/ProductoEditar.dc.html`, `design/pantallas/Productos.dc.html`. Popups: aviso «Faltan datos obligatorios» y diálogo «Descartar cambios» (alta y edición); «Desvincular publicación» es de la Etapa 2 (fuera).

## Modelo y supuestos

- **Producto compartido en la organización**: pertenece a la organización (no a una empresa/tienda). La relación con empresas (`producto_empresa`) no se usa en esta épica.
- **El producto se desactiva, no se borra.** No hay «Eliminar» ni política DELETE.
- **Precio de lista**: se carga sin IVA y en la moneda elegida. «Precio en pesos» se muestra como *no disponible* hasta que Precios entregue F-PRE-01; el IVA y los cálculos en pesos no se hacen acá.
- **Costo**: lo ve y edita solo quien tiene acceso a la sección Rentabilidad (hoy Administrador edita; Administración solo lee); el Operador no ve el campo, ni en pantalla ni por la API.
- **«Compatible con»**: lista de valores libres cargada en el alta; sugerencias y filtro son F-CAT-09 (P1, fuera).
- **Publicaciones de Mercado Libre vinculadas**: no existen; la sección queda oculta hasta la Etapa 2.
- **Permisos** (contrato vigente, `docs/permisos-por-rol.md`): sección `productos` — Administrador y Operador editan; el resto lee (según matriz sembrada). Se resuelve con `private.nivel_seccion('productos')` en pantalla y en RLS, nunca con `private.puede_escribir()`.
- **Template**: no trae productos ni imágenes; sí el kit de panel, el patrón de formularios, Storage por organización (bucket de logos) y el aislamiento por organización.

### Esquema de datos (Constitución, Principio VII)

| Tabla | Esquema | Justificación | RLS |
|-------|---------|---------------|-----|
| `productos` (nueva) | **`dominio`** | Entidad central del negocio del producto. | `organizacion_id = private.organizacion_id()`; select con `lectura`/`edicion` en `productos`; insert/update con `edicion`; **sin DELETE**. |
| `producto_costos` (nueva) | **`dominio`** | Dato de negocio sensible, separado para poder restringirlo por fila. | Select con `lectura`/`edicion` en `rentabilidad`; insert/update con `edicion` en `rentabilidad`; sin DELETE. Operador: 0 filas. |
| `producto_imagenes` (nueva) | **`dominio`** | Imágenes del producto (metadatos; el archivo vive en Storage). | Select con `lectura`/`edicion` en `productos`; insert/update/delete con `edicion` en `productos`. |

Objeto de Storage: bucket privado `productos-imagenes` (prefijo `<organizacion_id>/`), con sus políticas sobre `storage.objects` — es mecanismo de plataforma, mismo patrón que `logos-organizacion`. Ninguna tabla va a `public`. Migraciones aditivas, con reversión en el encabezado y en `plan.md`. Los permisos del Operador sobre `producto_costos` y `producto_imagenes` se prueban con pgTAP.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Alta de producto (F-CAT-02, P0, talla M)

Como persona con permiso de edición en Productos, quiero cargar un producto nuevo, para tenerlo en el catálogo.

**Independent Test**: un Operador crea «Joystick Pro» con nombre, descripción, «Compatible con» y precio de lista en USD; queda activo y aparece un evento en Actividad. Un Administrador además carga el costo; el Operador no ve ese campo.

**Acceptance Scenarios**:
1. **Given** el formulario de alta, **When** se guarda con nombre y precio de lista válidos, **Then** el producto queda creado y **activo**, y se vuelve a su ficha con aviso de éxito.
2. **Given** faltan datos obligatorios, **When** se intenta guardar, **Then** aparece el aviso «Faltan datos obligatorios», los campos faltantes se marcan y no se guarda nada.
3. **Given** hay datos cargados, **When** se pulsa Cancelar o se sale, **Then** se pide confirmar con el diálogo «Descartar cambios».
4. **Given** un Operador, **When** abre el alta, **Then** no ve el campo Costo; **Given** un Administrador, **Then** lo ve y se guarda aparte.
5. **Given** el alta, **Then** no existe el campo «Stock inicial» (el requisito RF-CAT-02-3 manda sobre el prototipo).
6. **Given** el precio de lista, **Then** «Precio en pesos» se muestra como «No disponible».
7. **Given** un usuario con solo lectura en Productos, **When** intenta crear (UI o llamada directa), **Then** se rechaza.

### User Story 2 - SKU único (F-CAT-03, P0, talla S)

Como equipo, quiero que el sistema impida repetir un SKU —y que genere uno si lo dejo vacío—, para que cada producto sea identificable sin ambigüedad.

**Independent Test**: crear dos productos con el SKU «ABC-1» y «abc-1 » (mayúsculas/espacios): el segundo se rechaza con mensaje claro; en otra organización el mismo SKU sí se permite.

**Acceptance Scenarios**:
1. **Given** un producto con SKU «ABC-1», **When** se guarda otro con «abc-1» (sin distinguir mayúsculas ni espacios en los extremos), **Then** se rechaza y el mensaje dice que ese SKU ya existe, sin perder lo cargado.
2. **Given** dos altas simultáneas con el mismo SKU, **Then** solo una se crea (la regla vive en la base, no solo en la pantalla).
3. **Given** otra organización, **Then** puede usar el mismo SKU.
4. **Given** un alta o edición con el SKU vacío, **Then** el sistema genera uno solo (formato `PRD-XXXXXXXX`), único en la organización, y lo muestra en la ficha (Decisión 1).
6. **Given** dos altas simultáneas con el SKU vacío, **Then** cada producto recibe un SKU generado distinto.
5. **Given** una edición que cambia el SKU a uno ocupado, **Then** se rechaza igual.

### User Story 3 - Edición de producto (F-CAT-04, P0, talla M)

Como persona con permiso de edición, quiero corregir los datos de un producto.

**Independent Test**: se abre un producto, se cambia nombre y precio, se guarda; Actividad muestra «editó» y quién; un usuario de Consulta ve la ficha pero no puede guardar.

**Acceptance Scenarios**:
1. **Given** un producto, **When** se editan nombre, descripción, SKU, «Compatible con» y precio/moneda y se guarda, **Then** los cambios persisten y se registra `producto.editado` solo si hubo cambios reales.
2. **Given** cambios sin guardar, **When** se cancela o se sale, **Then** aparece «Descartar cambios».
3. **Given** que otra persona editó el producto mientras tanto, **When** se guarda, **Then** se avisa del conflicto y no se pisan sus cambios en silencio (Decisión 4).
4. **Given** un Operador, **Then** no ve ni puede modificar el costo (UI y API); un Administrador sí.
5. **Given** un usuario sin acceso a Productos, **Then** la ruta redirige y la consulta directa devuelve 0 filas.

### User Story 4 - Imágenes del producto (F-CAT-05, P0, talla M)

Como persona con permiso de edición, quiero subir las fotos de un producto, en el alta y en la edición.

**Independent Test**: subir 4 imágenes válidas, intentar una quinta, una de 3 MB y un PDF; ver que solo las válidas quedan y la primera es la principal.

**Acceptance Scenarios**:
1. **Given** un producto, **When** se suben imágenes JPG, PNG o WebP de hasta 2 MB, **Then** quedan asociadas, con hasta **4** por producto; la primera es la principal.
2. **Given** una quinta imagen, un archivo de otro tipo o de más de 2 MB, **Then** se rechaza con mensaje claro (en pantalla y en el servidor).
3. **Given** una imagen, **When** se elimina, **Then** desaparece y, si era la principal, la siguiente pasa a serlo.
4. **Given** el alta aún sin guardar, **When** se eligen imágenes, **Then** se suben al guardar el producto (si falla alguna, el producto queda creado y se avisa cuál reintentar).
5. **Given** otra organización o un usuario de solo lectura, **Then** no puede ver, subir ni borrar imágenes ajenas (RLS de la tabla y de Storage).

### User Story 5 - Estado activo / inactivo (F-CAT-06, P0, talla S)

Como persona con permiso de edición, quiero desactivar un producto sin perderlo, y reactivarlo.

**Independent Test**: desactivar un producto desde su ficha y desde la grilla; sigue existiendo con todos sus datos e imágenes, figura «Inactivo» y se reactiva; Actividad registra ambos movimientos.

**Acceptance Scenarios**:
1. **Given** un producto activo, **When** se desactiva, **Then** queda **Inactivo**, conserva todos sus datos e imágenes y se registra `producto.desactivado`.
2. **Given** un producto inactivo, **When** se reactiva, **Then** vuelve a activo y se registra `producto.activado`.
3. **Given** un usuario de solo lectura, **Then** no puede cambiar el estado (UI ni llamada directa).
4. **Given** la grilla mínima de `/productos` (Decisión 3), **Then** permite activar/desactivar desde la fila.

### Edge Cases
- Nombre solo con espacios → inválido; el nombre se recorta.
- Precio de lista cero, negativo, no numérico o con más de 2 decimales → inválido (se exige > 0).
- Costo enviado por un Operador por la API → rechazado por RLS.
- Fallo de red al subir una imagen → mensaje y reintento; el producto no se corrompe.
- Dos pestañas editando el mismo producto → conflicto avisado.

## Requirements *(mandatory)*

### Functional Requirements
- **FR-001** (F-CAT-02): Alta de producto con nombre (obligatorio, recortado), descripción, SKU, «Compatible con» (lista de valores libres), moneda y precio de lista sin IVA (obligatorio); el producto nace **activo**.
- **FR-002** (F-CAT-02): El alta NO pide ni guarda stock inicial.
- **FR-003** (F-CAT-02): El costo se guarda en `producto_costos`; solo lo ven y editan quienes tienen acceso a Rentabilidad; el Operador no ve el campo (pantalla y RLS).
- **FR-004** (F-CAT-02): Validación con el aviso «Faltan datos obligatorios» y el diálogo «Descartar cambios»; «Precio en pesos» se muestra «No disponible».
- **FR-005** (F-CAT-02): `dominio.productos` y `dominio.producto_costos` con RLS por organización y sección (sin DELETE), grants por columna que impiden fijar `organizacion_id`.
- **FR-006** (F-CAT-02): El alta registra `producto.creado` en Actividad, en la misma transacción; el detalle no incluye costo.
- **FR-007** (F-CAT-03): El SKU es único por organización sin distinguir mayúsculas ni espacios extremos, garantizado por la base (índice único), en alta y edición.
- **FR-008** (F-CAT-03): Un SKU repetido se informa con un mensaje claro y sin perder lo cargado.
- **FR-019** (F-CAT-03): Si el SKU llega vacío (alta o edición), la base lo autogenera (`PRD-` + 8 caracteres hexadecimales en mayúsculas), único por organización; un SKU cargado a mano se respeta.
- **FR-009** (F-CAT-04): Edición de nombre, descripción, SKU, «Compatible con», moneda, precio y (con acceso) costo, con «Descartar cambios» y aviso de conflicto de edición concurrente.
- **FR-010** (F-CAT-04): La edición registra `producto.editado` solo ante cambios reales, sin datos de costo, en la misma transacción.
- **FR-011** (F-CAT-04): Ruta `/productos/:id/edit` con guard de sección; el usuario de solo lectura ve la ficha sin poder guardar.
- **FR-012** (F-CAT-05): Hasta 4 imágenes por producto, JPG/PNG/WebP, 2 MB como máximo, la primera es la principal; se valida en pantalla y en servidor (bucket y tabla).
- **FR-013** (F-CAT-05): `dominio.producto_imagenes` y bucket privado `productos-imagenes` con RLS/políticas por organización y sección.
- **FR-014** (F-CAT-05): Subir y eliminar imágenes registra `producto.imagen_agregada` / `producto.imagen_eliminada` en Actividad.
- **FR-015** (F-CAT-06): Activar/desactivar un producto sin perder datos ni imágenes, desde la ficha y desde la grilla mínima, solo con permiso de edición.
- **FR-016** (F-CAT-06): El cambio de estado registra `producto.activado` / `producto.desactivado` en Actividad.
- **FR-017** (Cierre): Documentación (`docs/catalogo.md`, permisos, aislamiento, Actividad), revisión de seguridad y actualización del roadmap.
- **FR-018** (F-CAT-02): Destino de menú «Productos» (Catálogo, sección `productos`, carga diferida) y ruta `/productos/create` con guard de sección (Principio VI: audiencia, anchos 320/768/1440, teclado, estados de carga/vacío/error/éxito).

### Success Criteria
- **SC-001** (Cierre): E2E de punta a punta (crear, editar, subir fotos, desactivar) con Administrador y Operador.
- **SC-002** (F-CAT-02): pgTAP: aislamiento entre dos organizaciones y permisos por rol sobre `productos` y `producto_costos` (Operador: 0 filas); los de `producto_imagenes` son de SC-004.
- **SC-003** (F-CAT-03): dos altas simultáneas con el mismo SKU producen un solo producto; dos altas simultáneas con SKU vacío reciben SKU distintos.
- **SC-004** (F-CAT-05): pgTAP de aislamiento y permisos sobre `producto_imagenes` y Storage; ninguna imagen fuera de formato/tamaño/cantidad queda guardada, ni por la pantalla ni por llamada directa.
- **SC-005** (F-CAT-06): un producto desactivado y reactivado conserva el 100 % de sus datos e imágenes.
- **SC-006** (Cierre, verificado en el E2E): cada alta, edición, imagen y cambio de estado deja un evento en Actividad sin exponer el costo.

## Decisiones resueltas (Nicolás, 2026-10-16)
1. **SKU autogenerado si viene vacío** (reemplaza el default «sin autogeneración»): lo asigna la base (FR-019, F-CAT-03), así vale para la pantalla y para llamadas directas.
2. **Categoría: queda para el futuro.** Obligatorios: nombre y precio (> 0). Esta épica no crea el campo; MSF-160 (que depende de esta) lo agrega de forma aditiva (columna + campo en el formulario + obligatoriedad que pide el prototipo). El aviso a MSF-160 queda como tarea de cierre (T027).
3. **Grilla mínima de solo lectura en `/productos`** (nombre, SKU, estado, acciones editar y activar/desactivar) hasta que MSF-160 traiga el listado real (confirmado: «perfecto»).
4. **Conflicto de edición concurrente**: se avisa en vez de pisar cambios (bloqueo optimista con `updated_at`; confirmado: «perfecto»).
5. **Monedas: USD y ARS**, otras no (confirmado).

## Fuera de alcance
Variantes, productos relacionados, escalas de precio, stock inicial, proveedor y código de barras (MSF-205), video, categorías y listado completo (MSF-160), IVA y precio en pesos (MSF-114), sugerencias de «Compatible con» (F-CAT-09), publicaciones de Mercado Libre y «Desvincular publicación» (Etapa 2), eliminación física.

== GUÍA PARA NICOLÁS ==
- 🎯 Qué se va a construir: la ficha de producto del catálogo: cargar uno nuevo con hasta 4 fotos, corregirlo, desactivarlo sin perderlo y reactivarlo. El SKU no se puede repetir y, si lo dejás vacío, el sistema te pone uno solo. Todo queda anotado en Actividad.
- 👀 Mirá con atención: el costo lo ve solo quien tiene Rentabilidad (el Operador ni lo ve). El precio de lista va sin IVA en USD o ARS; «Precio en pesos» dice «No disponible» hasta que Precios lo entregue. Si dos personas editan a la vez, se avisa del conflicto. Riesgo: las 26 h del documento son justas (por talla serían ~40 h).
- 🖐️ Decidí vos: nada pendiente; tus 5 decisiones están aplicadas (SKU autogenerado, categoría para después, grilla mínima, aviso de conflicto, USD y ARS).
- 🚫 Qué queda afuera: categoría y listado completo (MSF-160, se le deja el aviso), proveedor y código de barras (MSF-205), IVA y precio en pesos (MSF-114), variantes, relacionados, escalas de precio, stock inicial, video, publicaciones de Mercado Libre y borrado físico.
- ⚡ ¿100% de tu atención?: NO. Todo sigue lo que ya definiste en la épica y en tus 5 respuestas.
