# Feature Specification: Clientes y proveedores · Proveedores y productos

**Feature Branch**: `epic/MSF-205-clientes-y-proveedores-proveedores-y-pro`

**Jira Epic**: MSF-205 — Clientes y proveedores · Proveedores y productos (spec `proveedores-y-productos`)

**Created**: 2026-10-18

**Status**: Ready for implementation — la especificación viene completa desde Jira. Los puntos de «A revisar» no bloquean: cada uno lleva una decisión provisoria en *Decisiones abiertas*.

**Delivery scope**: `refine` (apps/web) y `supabase` (migraciones + RPC + vista + pgTAP). Sin `kestra`, `superset` ni `workers`.

**Prioridad / Hito**: P0 · Hito 2 (2 al 20 de noviembre de 2026) · 22 h (tallas 20 h + 2 h de integración; antes 24) · alcance diciembre.

**Dependencias**:
- Bloqueada por: MSF-456 (Catálogo · Catálogo alta y edición): la tabla `dominio.productos` que F-PRV-03 vincula con el proveedor. `registro_actividad` (MSF-455), las empresas (MSF-138) y la sección `proveedores` con los roles (MSF-125) llegan a través de MSF-456. **Ya en `main`** (`dominio.productos`, `public.crear_producto`/`actualizar_producto`, `public.registro_actividad`, sección `proveedores` en la matriz de roles).
- Bloquea a: MSF-219 (Ingreso de mercadería por proveedor) y MSF-179 (Catálogo · Catálogo costo y disponibilidad).
- Relacionada, sin bloqueo: MSF-142 (Migración inicial de datos) y MSF-445 (Mejoras de clientes y proveedores) la alcanzan a través de MSF-219; los reportes de reposición usan el proveedor principal de cada producto.
- Dentro de la épica: F-PRV-01 bloquea a F-PRV-02 y a F-PRV-03 (la tabla de proveedores).

**Input**: Epic MSF-205. Objetivo: «Al terminar, la organización tiene su lista de proveedores con CUIT y contacto, y cada producto sabe qué proveedor lo abastece, listos para el ingreso de mercadería y para los reportes de reposición.»

**Regla de fuentes** (literal de la épica):
- Comportamiento y datos: mandan los requisitos y escenarios de esta historia.
- Qué se ve (disposición, textos, estados, popups, flujos): el prototipo validado es la referencia visual y hay que ser lo más fiel posible (no se exige idéntico al pixel; lo que aún no se construye o queda fuera de alcance se anota, no se omite); los flujos (si hay) aclaran estados y acciones.
- Cómo se construye (componentes, estilos y patrones): mandan el template y el sistema de diseño (MSF-117, `docs/sistema-de-diseno.md`). No se copia HTML ni CSS: se reproduce con los componentes del template y los tokens.
- El prototipo muestra más que esta historia: se implementa solo lo que piden los requisitos de F-PRV-01…03.
- Si algo no se puede igualar: lo más cercano, sin inventar, anotando la diferencia en el PR. Si prototipo y requisitos se contradicen: requisitos para el comportamiento, prototipo para lo visual, y la contradicción queda anotada en el PR.
- Prototipos (solo lectura, presentes en el árbol de trabajo; la rama `design/prototipo` no existe en `origin` hoy): `design/pantallas/Proveedores.dc.html`, `design/pantallas/ProveedorFicha.dc.html` y `design/pantallas/ProductoAlta.dc.html` (campos Proveedor y Código del proveedor).

## Modelo y supuestos

- Hay unos **135 proveedores** en el panel actual. La carga de esos datos es de MSF-142; aquí solo se deja la estructura lista.
- **Proveedores es una sección propia** (`proveedores` en la matriz de roles) que editan el **Administrador** y **Administración** (a confirmar con el cliente). Los demás roles tienen `ninguno`: no ven CUIT ni contacto. La sección es **compartida entre empresas** de la organización (`private.secciones_compartidas()` ya la incluye): el proveedor pertenece a la organización, no a una tienda.
- **Quien registra ingresos** (Depósito, Operador) elige proveedor por la vista `proveedores_basico` (solo razón social), **sin ver CUIT ni contacto**. Esa vista se crea aquí; el ingreso de mercadería es MSF-219.
- **El costo del producto vive en Catálogo y Precios**, no en esta épica.
- **Proveedor principal**: cada producto guarda **a lo sumo un proveedor** (el que lo abastece) y el **código con que ese proveedor lo conoce**. Ese es el «proveedor principal» que usan los reportes de reposición. Varios proveedores por producto no los pide la épica (ver *Decisiones abiertas* 5).
- **Se desactiva, no se borra** (el documento manda sobre el «Eliminar proveedor» del prototipo; ver *Decisiones abiertas* 1). Un proveedor desactivado se conserva con sus productos asociados y se puede reactivar.
- El template trae formularios, permisos por organización y el patrón CRUD de `pages/clientes`, reutilizado como base; la tabla, el CUIT y la vista `proveedores_basico` son nuevos.

### Esquema de datos (Constitución, Principio VII)

| Objeto | Esquema | Justificación | RLS / acceso |
|--------|---------|---------------|--------------|
| `proveedores` (**nueva**, F-PRV-01) | **`dominio`** | Entidad de negocio del producto (a quién se le compra), no plataforma. Vive en `dominio`, nunca en `public`. | **Sí**: `organizacion_id = (select private.organizacion_id())`; `select` con `private.nivel_seccion('proveedores')` en `lectura`/`edicion`; `insert`/`update` con `edicion`; **sin `delete`**. `anon` sin acceso. |
| `productos` (existente, MSF-456; **se altera** en F-PRV-03) | `dominio` (sin cambio) | Se le agregan dos columnas aditivas (`proveedor_id`, `codigo_proveedor`). No cambia de esquema. | RLS vigente de MSF-456; la FK compuesta `(proveedor_id, organizacion_id)` impide apuntar a un proveedor de otra organización. |
| `proveedores_basico` (**vista nueva**, F-PRV-03) | `public` (superficie de lectura expuesta, como las RPC; **no es una tabla**, no almacena datos) | Expone solo `id`, razón social y `activo` a quien registra ingresos o edita productos, sin la sección `proveedores`. | Filtrada por `private.organizacion_id()` y por nivel en `productos`, `stock` o `proveedores`; `revoke … from public, anon`, `grant select … to authenticated`. |

No se crean otras tablas. La prueba pgTAP `rls_en_toda_tabla` recorre `public` + `dominio` y debe seguir verde.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Alta y edición de proveedor con CUIT (F-PRV-01, P0, talla M)

Como administrador, quiero dar de alta y editar proveedores con su CUIT y contacto, para tenerlos registrados y poder asignárselos a los productos.

**Why this priority**: sin la tabla y el CUIT no hay listado ni relación con productos; es la base de la épica.

**Independent Test**: con el rol Administrador, crear un proveedor con CUIT válido lo guarda y aparece su ficha; repetir el CUIT es rechazado; editarlo conserva el historial; desactivarlo y reactivarlo no pierde datos; con el rol Depósito la sección no existe.

**Acceptance Scenarios**:

1. **Given** la persona con `edicion` en Proveedores, **When** abre «Nuevo proveedor», **Then** ve el diálogo con **Razón social** (obligatoria), **CUIT** (obligatorio), **Persona de contacto**, **Correo**, **Teléfono**, **Dirección** y **Observaciones**, con los botones **Cancelar** y **Guardar proveedor**.
2. **Given** un CUIT, **Then** se acepta con o sin guiones y espacios, debe tener 11 dígitos con **dígito verificador válido**, se guarda solo con dígitos y se muestra como `XX-XXXXXXXX-X`; un CUIT inválido muestra el error junto al campo y no guarda.
3. **Given** un CUIT que ya existe en la organización (también en un proveedor desactivado), **Then** se rechaza con un mensaje claro; la restricción la hace cumplir la base, no solo el formulario (también dos altas simultáneas).
4. **Given** el correo, **Then** si se completa debe tener formato válido; teléfono, dirección y observaciones son libres con largo acotado; la razón social se guarda recortada y no puede quedar en blanco.
5. **Given** un proveedor existente, **When** se abre «Editar» (desde la ficha), **Then** el diálogo carga sus datos y al guardar se actualizan; si otra persona lo cambió entre medio, se avisa del conflicto y no se pisa su cambio (bloqueo optimista por `updated_at`).
6. **Given** la ficha de un proveedor (`/proveedores/show/:id`), **Then** muestra razón social, CUIT, persona de contacto, correo, teléfono, dirección y observaciones, un acceso para volver a **Proveedores**, y las acciones **Editar** y **Desactivar**/**Reactivar**.
7. **Given** «Desactivar», **Then** pide confirmación («Queda archivado: no se elige en nuevos ingresos ni productos, pero conserva sus datos y se puede reactivar»); no existe acción de borrar. Un proveedor desactivado se ve marcado como inactivo en su ficha y «Reactivar» lo devuelve a activo. Repetir la acción sobre un proveedor ya en ese estado no falla ni duplica el evento.
8. **Given** cada alta, edición, desactivación y reactivación, **Then** queda registrada en el historial de actividad con quién, cuándo y qué proveedor (por razón social), sin mostrar identificadores internos.
9. **Given** una persona con sección Proveedores en `ninguno` (p. ej. Depósito, Operador), **Then** no ve la sección ni lee, crea o edita proveedores llamando directo a la base; con `lectura` puede ver la ficha pero no ve «Nuevo proveedor», «Editar» ni «Desactivar». Un usuario de otra organización no ve filas ajenas.
10. **Given** pantallas de 320, 768 y 1440 px, **Then** el diálogo y la ficha son utilizables, con teclado y lector de pantalla (errores asociados al campo, foco al abrir y al cerrar el diálogo), sin identificadores técnicos visibles.

---

### User Story 2 - Listado y búsqueda de proveedores (F-PRV-02, P0, talla S)

Como administrador, quiero ver y buscar mis proveedores, para encontrar rápido el que necesito entre unos 135.

**Why this priority**: es la entrada a la sección; hace usable la tabla de F-PRV-01.

**Independent Test**: con más de 25 proveedores, escribir parte de la razón social o del CUIT (con o sin guiones) acota la lista; sin coincidencias aparece «Sin resultados»; los desactivados no aparecen salvo que se pida verlos.

**Acceptance Scenarios**:

1. **Given** la sección Proveedores (`/proveedores`), **Then** muestra la tabla con columnas **Razón social**, **CUIT**, **Correo** y **Teléfono**, ordenada por razón social, con un campo de búsqueda («Buscar por razón social o CUIT»), el botón **Nuevo proveedor** (para quien tiene `edicion`) y, por fila, **Ver ficha**.
2. **Given** texto en el buscador, **Then** filtra por coincidencia parcial en la razón social (sin distinguir mayúsculas ni tildes) o en el CUIT (con o sin guiones), en el servidor; vaciar el campo restablece la lista.
3. **Given** más proveedores que una página, **Then** se pagina en el servidor (25 por página por defecto), con el total, conservando la búsqueda y el filtro al cambiar de página.
4. **Given** el listado por defecto, **Then** muestra solo proveedores **activos**; un filtro **Estado** (Activos / Inactivos / Todos) permite llegar a los desactivados para reactivarlos, y los inactivos se distinguen visualmente.
5. **Given** una búsqueda o filtro sin coincidencias, **Then** se muestra el estado vacío «Sin resultados»; si la organización aún no tiene proveedores, el vacío invita a crear el primero (a quien puede); un error de consulta muestra el estado de error compartido con «Reintentar»; mientras consulta, el estado de carga compartido.
6. **Given** «Nuevo proveedor», **Then** abre el diálogo de alta de F-PRV-01 y, al guardar, el nuevo proveedor aparece en el listado; «Ver ficha» abre `/proveedores/show/:id`.
7. **Given** la navegación del panel, **Then** hay una entrada **Proveedores** (con icono) en el grupo de Clientes y proveedores, visible solo para quien tiene `lectura` o `edicion` en la sección; la ruta directa sin permiso lleva a «Acceso restringido».
8. **Given** pantallas de 320, 768 y 1440 px, **Then** el listado es utilizable (vista adaptable de tarjetas en angosto), con teclado y lector de pantalla (campo de búsqueda con etiqueta, resultados anunciados), sin identificadores técnicos visibles.

---

### User Story 3 - Relación del proveedor con los productos (F-PRV-03, P0, talla M)

Como administrador, quiero indicar qué proveedor abastece cada producto y ver qué productos tiene cada proveedor, para ingresar mercadería y reponer por proveedor.

**Why this priority**: es lo que MSF-219 (ingreso de mercadería) y los reportes de reposición consumen.

**Independent Test**: crear un producto eligiendo proveedor y «Código del proveedor»; ese producto aparece en la ficha del proveedor con su código; un Operador puede elegir proveedor en el producto pero no ve CUIT ni contacto; un proveedor de otra organización no se puede asignar.

**Acceptance Scenarios**:

1. **Given** el alta y la edición de producto, **Then** el formulario muestra el campo **Proveedor** (opcional; selector con búsqueda por razón social, solo proveedores activos) y **Código del proveedor** (texto libre opcional, hasta 80 caracteres); se guardan junto con el producto.
2. **Given** un producto con proveedor, **When** se edita y se quita el proveedor, **Then** el producto queda sin proveedor y se borra su código del proveedor; un código sin proveedor es rechazado.
3. **Given** un producto ya asignado a un proveedor que luego se desactiva, **Then** la asignación se conserva y se sigue mostrando; el proveedor desactivado no se ofrece para nuevas asignaciones.
4. **Given** el rol Operador (con `edicion` en Productos y `ninguno` en Proveedores), **Then** el selector de proveedor funciona a través de la vista `proveedores_basico` (solo `id`, razón social y estado), y la base no le entrega CUIT, correo, teléfono ni observaciones de ningún proveedor.
5. **Given** un `proveedor_id` de otra organización o inexistente (manipulado), **Then** la base rechaza el alta o la edición del producto.
6. **Given** la ficha del proveedor, **Then** muestra la sección **Productos** con los productos que abastece: **Producto** (nombre) y **Código del proveedor**, con **Ver producto** por fila, ordenados por nombre y paginados en el servidor (10 por página por defecto); los productos inactivos se distinguen visualmente.
7. **Given** un proveedor sin productos, **Then** la sección muestra «Este proveedor todavía no tiene productos.»; un error al consultar muestra el estado de error compartido con «Reintentar» sin afectar al resto de la ficha; mientras consulta, el estado de carga.
8. **Given** quien tiene `lectura` en Proveedores pero `ninguno` en Productos, **Then** la sección Productos de la ficha no devuelve filas (la base lo hace cumplir).
9. **Given** el contrato para otras épicas, **Then** el proveedor principal de cada producto queda legible por `productos.proveedor_id` y el código por `productos.codigo_proveedor`, y el selector del ingreso de mercadería (MSF-219) puede usar `proveedores_basico`; no se construye aquí ninguna pantalla de ingreso ni de reposición.
10. **Given** pantallas de 320, 768 y 1440 px, **Then** el selector y la sección de la ficha son utilizables, con teclado y lector de pantalla, sin identificadores técnicos visibles.

---

### Edge Cases

- CUIT con espacios, guiones o puntos al pegarlo: se normaliza; letras u otros caracteres se rechazan con mensaje.
- Dos altas simultáneas con el mismo CUIT: gana una; la otra recibe el error de duplicado (índice único), nunca dos filas.
- Edición simultánea del mismo proveedor: la segunda persona recibe el aviso de conflicto con opción de recargar.
- Desactivar un proveedor con productos asociados: permitido; los productos conservan la asignación (escenario 3 de F-PRV-03).
- Producto desactivado asignado a un proveedor: aparece en la ficha marcado como inactivo.
- Doble clic en «Guardar proveedor» o «Desactivar»: el botón se deshabilita mientras guarda; las operaciones son idempotentes.
- Proveedor con razón social repetida pero CUIT distinto: permitido (la identidad fiscal es el CUIT).
- Organización sin proveedores o `proveedores_basico` vacío: el selector del producto muestra «No hay proveedores activos» y el campo sigue siendo opcional.

## Requirements *(mandatory)*

### Functional Requirements

**F-PRV-01 — Alta y edición de proveedor con CUIT**

- **FR-001**: DEBE existir `dominio.proveedores` (`id`, `organizacion_id` FK a `public.organizaciones` `on delete cascade`, `razon_social`, `cuit`, `persona_contacto`, `correo`, `telefono`, `direccion`, `observaciones`, `activo` por defecto `true`, `creado_en`, `updated_at`, `unique (id, organizacion_id)`), con RLS por organización y sección `proveedores`, **sin política `delete`**, grants por columna (el llamador no fija `organizacion_id`, `creado_en` ni `updated_at`) y `anon` sin privilegios. Migración aditiva con reversión documentada.
- **FR-002**: El CUIT DEBE normalizarse y validarse **en la base** (disparador): solo dígitos, 11 dígitos, dígito verificador válido (módulo 11), único por organización (`unique (organizacion_id, cuit)` incluye inactivos). La razón social se recorta y no puede quedar vacía (hasta 200 caracteres); el correo, si existe, tiene formato válido.
- **FR-003**: DEBE existir `public.crear_proveedor(...)` (`security invoker`, rige RLS) que exige `edicion` en `proveedores`, toma la organización de la sesión (nunca del llamador), valida y devuelve el proveedor creado. `revoke … from public, anon`; `grant execute … to authenticated`.
- **FR-004**: DEBE existir `public.actualizar_proveedor(p_id, p_actualizado_en, …)` con **bloqueo optimista** (`updated_at` leído al abrir): si cambió, falla con un error de conflicto reconocible; exige `edicion`.
- **FR-005**: DEBE existir `public.cambiar_estado_proveedor(p_id, p_activo)` idempotente (desactivar/reactivar), exige `edicion`; no hay forma de borrar un proveedor desde la app.
- **FR-006**: Cada alta, edición, desactivación y reactivación DEBE registrarse en `public.registro_actividad` con los tipos `proveedor.creado`, `proveedor.editado`, `proveedor.desactivado` y `proveedor.reactivado`, y un detalle legible con la razón social (disparador `security definer`, sin duplicar eventos si no cambió nada).
- **FR-007**: DEBE existir el diálogo «Nuevo proveedor»/«Editar proveedor» (campos y validaciones de US1-1…5), con CUIT mostrado con guiones, errores asociados al campo, mensajes claros para duplicado (`23505`) y conflicto de edición, y estados de carga/éxito/error compartidos.
- **FR-008**: DEBE existir la ficha `/proveedores/show/:id` (US1-6/7/9): datos del proveedor, volver a Proveedores, **Editar**, **Desactivar**/**Reactivar** con confirmación, y las acciones ocultas según el nivel de sección.
- **FR-009**: DEBE registrarse el recurso `proveedores` en Refine con la ruta canónica `/proveedores/show/:id` y la apertura del alta y edición, protegidas por nivel de sección (sin permiso → «Acceso restringido»).

**F-PRV-02 — Listado y búsqueda de proveedores**

- **FR-010**: DEBE existir `public.listar_proveedores(p_busqueda text default null, p_estado text default 'activos', p_pagina integer default 1, p_tamano integer default 25)` (`security invoker`, rige RLS; exige `lectura`/`edicion`) que busca por razón social (parcial, sin mayúsculas ni tildes) o CUIT (con o sin guiones), ordena por razón social y `id`, pagina con tope de tamaño (200) y devuelve `total_filas`. Índice para la búsqueda (`pg_trgm` ya habilitado). Migración propia aditiva.
- **FR-011**: DEBE existir la pantalla `/proveedores` (US2-1…6, 8): tabla, buscador, filtro de estado, paginación, **Nuevo proveedor**, **Ver ficha**, estados vacío («Sin resultados»)/carga/error, vista adaptable.
- **FR-012**: DEBE existir la entrada de navegación **Proveedores** con icono, ubicación en el grupo Clientes y proveedores, visibilidad por nivel de sección y la ruta canónica del listado (US2-7).

**F-PRV-03 — Relación del proveedor con los productos**

- **FR-013**: `dominio.productos` DEBE ganar, en migración aditiva, `proveedor_id uuid` y `codigo_proveedor text` (hasta 80 caracteres), con FK compuesta `(proveedor_id, organizacion_id)` → `dominio.proveedores (id, organizacion_id)` (`on delete restrict`), índice `(organizacion_id, proveedor_id)`, restricción «no hay código sin proveedor» y validación de que un proveedor **nuevo** asignado esté activo. Grants por columna para `authenticated`. Reversión documentada (no se destruye en el mismo PR).
- **FR-014**: DEBE existir la vista `public.proveedores_basico` (`id`, `razon_social`, `activo`) filtrada por `private.organizacion_id()`, legible para quien tiene `edicion` en `productos`, o nivel `lectura`/`edicion` en `stock` o `proveedores`; **no expone** CUIT, contacto ni observaciones. `revoke … from public, anon`; `grant select … to authenticated`.
- **FR-015**: `public.crear_producto` y `public.actualizar_producto` DEBEN aceptar `p_proveedor_id` y `p_codigo_proveedor` opcionales, sin cambiar el resto de su comportamiento (permisos, bloqueo optimista, costo, eventos), reemplazando las firmas anteriores en la misma migración (cambio de contrato señalado en el PR, con camino de reversión) y manteniendo `revoke`/`grant`. El evento existente `producto.editado` cubre el cambio de proveedor.
- **FR-016**: Los formularios de alta y edición de producto DEBEN mostrar **Proveedor** (selector con búsqueda sobre `proveedores_basico`, opcional, solo activos para nuevas asignaciones) y **Código del proveedor** (US3-1…4, 10), y mapear los errores de la base a mensajes claros.
- **FR-017**: DEBE existir `public.productos_de_proveedor(p_proveedor_id uuid, p_pagina integer default 1, p_tamano integer default 10)` (`security invoker`): exige `lectura`/`edicion` en `proveedores` y en `productos`, devuelve nombre, código del proveedor, estado y `total_filas`, ordenado por nombre; paginado con tope (100).
- **FR-018**: La ficha del proveedor DEBE mostrar la sección **Productos** (US3-6/7/8): tabla, **Ver producto**, paginación, vacío/carga/error, vista adaptable.

**Cierre**

- **FR-019**: DEBE documentarse la funcionalidad en `docs/proveedores.md` (modelo, CUIT, roles, vista `proveedores_basico`, contrato para MSF-219 y reposición, reversión), `docs/permisos-por-rol.md`, `docs/actividad.md` (nuevos tipos de evento) y la corrección de `docs/catalogo.md` (proveedor entregado; el código de barras no es de esta épica); `pnpm docs:check` verde (Principio VIII).
- **FR-020**: Los seguimientos trazados (Tarea `seguimiento` en Jira) de lo que el prototipo muestra y la épica no pide DEBEN abrirse antes del cierre (condiciones de compra, «Compra para», «Enviar correo», importar/exportar, N.º, Último ingreso y Costo en la ficha, código de barras, varios proveedores por producto), con su link anotado.

### Success Criteria

- **SC-001**: pgTAP de `dominio.proveedores` y sus RPC: RLS por organización y por nivel de sección (Administrador y Administración escriben; Depósito, Operador, Mostrador y Consulta no leen ni escriben), CUIT (válido, inválido, con guiones, duplicado por organización incluyendo inactivos), conflicto de edición, idempotencia de estado, eventos de actividad, sin `delete`, `anon` sin ejecución. *(F-PRV-01)*
- **SC-002**: Vitest del diálogo y la ficha: validación y formato de CUIT, errores por campo, duplicado y conflicto, confirmación de desactivar, acciones ocultas por nivel, teclado y lector. *(F-PRV-01)*
- **SC-003**: pgTAP de `listar_proveedores`: búsqueda por razón social y CUIT, estado, orden estable, paginación y tope, aislamiento por organización y sección. *(F-PRV-02)*
- **SC-004**: Vitest del listado y la navegación: búsqueda, filtro de estado, paginación, «Sin resultados», error con reintento, vista adaptable, entrada de menú por rol y acceso restringido. *(F-PRV-02)*
- **SC-005**: pgTAP de la relación: columnas y FK compuesta, rechazo de proveedor ajeno o inactivo nuevo, código sin proveedor, `proveedores_basico` sin CUIT ni contacto para un Operador, `productos_de_proveedor` por niveles, `crear/actualizar_producto` con y sin proveedor. *(F-PRV-03)*
- **SC-006**: Vitest de producto y ficha: selector de proveedor y código en alta/edición, quitar proveedor, «Productos» de la ficha con vacío/error/paginación. *(F-PRV-03)*
- **SC-007**: Validación final `pnpm lint && pnpm build && pnpm test && pnpm docs:check && pnpm matriz:check` verde y revisión de seguridad sin hallazgos abiertos. *(Cierre)*

## Decisiones abiertas

1. **«Eliminar proveedor» vs. desactivar** (conflicto detectado). Provisorio: manda el documento. Se implementa **Desactivar/Reactivar** sin borrado; el diálogo «Eliminar proveedor» del prototipo se reutiliza visualmente como «Desactivar proveedor» (texto adaptado). Se anota en el PR.
2. **Qué roles ven CUIT y contacto.** Provisorio: **Administrador y Administración** (los que tienen la sección `proveedores`); el resto solo el nombre al ingresar mercadería, vía `proveedores_basico`. Se configura con la matriz de roles existente, sin lógica nueva. A confirmar con el cliente.
3. **Condiciones de compra, «Compra para» y «Enviar correo a proveedor»** (prototipo; ningún requisito del documento los pide). Provisorio: **fuera de alcance**, sin columnas ni botones; seguimiento trazado (FR-020).
4. **Dirección y Observaciones.** El documento pide «CUIT y contacto». Provisorio: se incluyen **Dirección** y **Observaciones** como datos de contacto/nota libre (el prototipo los muestra y no figuran entre los agregados señalados en «A revisar»); si el cliente los descarta, se quitan sin migración destructiva.
5. **Un proveedor por producto.** Provisorio: un solo proveedor (principal) por producto, como dibuja `ProductoAlta`. Si hace falta más de uno, se agrega una tabla de relación en una épica posterior (aditivo); no se anticipa aquí.
6. **Código de barras.** `docs/catalogo.md` lo asignaba a MSF-205, pero la épica no lo incluye. Provisorio: **fuera de alcance**; se corrige la doc y se traza seguimiento.

## Matriz pantalla↔criterios

Inventario determinista con `pnpm prototipo:inventario` sobre `Proveedores.dc.html`, `ProveedorFicha.dc.html` y `ProductoAlta.dc.html` (`design/pantallas/*.inventory.json`; `pnpm prototipo:check` confirma que están al día). Cada ítem visible tiene dueño o está fuera de alcance con motivo.

### Proveedores · Listado (`Proveedores.dc.html`)

| Ítem del inventario | Destino | Criterio |
|---------------------|---------|----------|
| Columna `Razón social` | En alcance | F-PRV-02 US2-1, FR-011 |
| Columna `CUIT` | En alcance | US2-1, FR-011 |
| Columna `Correo` | En alcance | US2-1, FR-011 |
| Columna `Teléfono` | En alcance | US2-1, FR-011 |
| Columna de acciones (vacía) con `Ver ficha` | En alcance | US2-1/6, FR-011 |
| Columna `N.º` | Fuera de alcance: ningún requisito pide numeración correlativa de proveedores; seguimiento (FR-020) | — |
| Columna `Compra para` y campo `Compra para` | Entregado como seguimiento MSF-524 (T029/FR-020): dato informativo por tienda, chips en el diálogo y el listado, dato en la ficha (docs/proveedores.md § «Compra para»); antes: fuera de alcance (Decisiones 3) | MSF-524 |
| Filtro `Tienda` del listado | Entregado en MSF-524 (filtra por «Compra para» en el servidor) | MSF-524 |
| Columna `Último ingreso` | Fuera de alcance: depende del ingreso de mercadería (MSF-219); seguimiento | — |
| Campo de búsqueda `Buscar por razón social o CUIT` | En alcance | US2-2, FR-010, FR-011 |
| Botón `Nuevo proveedor` | En alcance | US2-6, FR-011 |
| Botones `Importar`, `Descargar plantilla CSV`, `Importar 14 proveedores` y diálogo «Importar proveedores» | Fuera de alcance: importación de datos es MSF-142 / MSF-445 | — |
| Botón `Exportar` | Fuera de alcance: no lo pide el documento (MSF-445); seguimiento | — |
| Botón `Ingresar mercadería` | Fuera de alcance: es de MSF-219 | — |
| Diálogo Nuevo/Editar proveedor: campos `Razón social`, `CUIT`, `Persona de contacto`, `Correo`, `Teléfono`, `Dirección`, `Observaciones` y botones `Cancelar`, `Guardar proveedor` | En alcance | F-PRV-01 US1-1…5, FR-007 |
| Diálogo: campos `Condición de pago`, `Moneda`, `Plazo de entrega`, `Compra mínima` | Fuera de alcance: condiciones de compra, ningún requisito las pide (Decisiones 3) | — |
| Diálogo «Eliminar proveedor» y botón `Eliminar proveedor` | En alcance **adaptado** a Desactivar/Reactivar (el documento manda; Decisiones 1) | US1-7, FR-005, FR-008 |
| Diálogo «Enviar correo a proveedor», campos `Para`, `Asunto`, `Mensaje` y botón `Enviar correo` | Fuera de alcance: ningún requisito lo pide (Decisiones 3) | — |
| Estado vacío «Sin resultados» | En alcance | US2-5, FR-011 |

### Proveedores · Ficha (`ProveedorFicha.dc.html`)

| Ítem del inventario | Destino | Criterio |
|---------------------|---------|----------|
| Campos `Razón social`, `CUIT`, `Persona de contacto`, `Teléfono`, `Correo`, `Dirección`, `Observaciones` | En alcance | F-PRV-01 US1-6, FR-008 |
| Campos `Condición de pago`, `Moneda`, `Plazo de entrega`, `Compra mínima` | Fuera de alcance: condiciones de compra (Decisiones 3) | — |
| Botón `Proveedores` (volver) | En alcance | US1-6, FR-008 |
| Botón `Editar` y diálogo «Editar proveedor» (con `Cancelar`, `Guardar proveedor`) | En alcance | US1-5, FR-007, FR-008 |
| Botón `Eliminar`, diálogo «Eliminar proveedor» y botón `Eliminar proveedor` | En alcance **adaptado** a Desactivar/Reactivar (Decisiones 1) | US1-7, FR-005, FR-008 |
| Tabla: columna `Producto` | En alcance | F-PRV-03 US3-6, FR-017, FR-018 |
| Tabla: columna `Código del proveedor` | En alcance | US3-6, FR-018 |
| Tabla: columna `Costo` | En alcance (seguimiento MSF-528): solo con Rentabilidad; `—` si no hay costo | `docs/proveedores.md`, migración `20261021162400` |
| Tabla: columna `Último ingreso` | Fuera de alcance: depende de MSF-219 | — |
| Tabla: columna de acciones con `Ver producto` | En alcance | US3-6, FR-018 |
| Botón `Enviar correo`, diálogo «Enviar correo a proveedor» y campos `Para`, `Asunto`, `Mensaje` | Fuera de alcance (Decisiones 3) | — |
| Botón `Ingresar mercadería` | Fuera de alcance: es de MSF-219 | — |

### Producto · alta (`ProductoAlta.dc.html`)

| Ítem del inventario | Destino | Criterio |
|---------------------|---------|----------|
| Campo `Proveedor` | En alcance | F-PRV-03 US3-1…5, FR-016 |
| Campo `Código del proveedor` | En alcance | US3-1/2, FR-016 |
| Campos `Nombre`, `SKU`, `Descripción`, `Compatible con`, `Moneda`, `Precio de lista`, `Costo`, botones `Productos`, `Cancelar`, `Guardar producto` | Fuera de alcance: ya entregados por MSF-456 (Catálogo alta y edición) | — |
| Campo `Categoría (hasta 3.er nivel)` | Fuera de alcance: categorías y listado real son de MSF-160 | — |
| Campos `IVA`, `Local`, `Depósito principal`, `Stock mínimo (alerta)` | Fuera de alcance: Precios y Stock | — |
| Campo `Código de barras (EAN-13)` | Fuera de alcance: la épica no lo incluye (Decisiones 6); seguimiento | — |
| Campo `Video del producto (opcional)`, botones de imagen (`Principal`, `Imagen 2`…`Imagen 4` / `Subir imagen`) | Fuera de alcance: imágenes entregadas por MSF-456; video no pedido | — |
| Tabla de variantes (`Variante`, `Código`, `Código de barras`, `Stock`, `Activa`) y botones `Agregar variante`, `Agregar`, `Cotización →` | Fuera de alcance: variantes y cotización son de otras épicas de Catálogo | — |
| Campo `Lugar en Productos destacados`, botones `Ver productos destacados →`, `Desvincular`, diálogo «Desvincular publicación» | Fuera de alcance: publicación en la tienda | — |
| Diálogo «Descartar cambios» con `Seguir editando` y `Descartar y salir` | Fuera de alcance: comportamiento del formulario de producto de MSF-456 | — |
| Campo de búsqueda `Buscar por nombre, SKU o categoría` | Fuera de alcance: buscador del selector de categorías / productos, no del proveedor | — |

## Matriz de trazabilidad Jira ↔ US ↔ FR ↔ tareas

| Jira | Historia | FR / SC | Tareas |
|------|----------|---------|--------|
| F-PRV-01 | US1 Alta y edición de proveedor con CUIT | FR-001…009, SC-001, SC-002 | T001–T010 |
| F-PRV-02 | US2 Listado y búsqueda de proveedores | FR-010…012, SC-003, SC-004 | T011–T016 |
| F-PRV-03 | US3 Relación del proveedor con los productos | FR-013…018, SC-005, SC-006 | T017–T026 |
| Tarea de cierre (label `cierre`) | Docs, seguridad, seguimientos y roadmap | FR-019, FR-020, SC-007, Principio VIII | T027–T030 |
