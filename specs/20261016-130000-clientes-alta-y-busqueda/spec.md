# Feature Specification: Clientes y proveedores · Clientes alta y búsqueda

**Feature Branch**: `epic/MSF-180-clientes-y-proveedores-clientes-alta-y-b`

**Jira Epic**: MSF-180 — Clientes y proveedores · Clientes alta y búsqueda (spec `clientes-alta-y-busqueda`)

**Created**: 2026-10-16

**Status**: Ready for implementation — la especificación viene completa desde Jira. Los puntos de "A revisar" no bloquean. Nicolás respondió las 5 preguntas el 2026-10-16 (ver *Decisiones*).

**Delivery scope**: `refine` (apps/web) y `supabase` (migraciones + RPC + pgTAP). Sin `kestra`, `superset` ni `workers`.

**Prioridad / Hito**: P0 · Hito 2 (2 al 20 de noviembre de 2026) · 26 h (24 h de tallas + 2 h de integración y datos de prueba) · alcance diciembre.

**Dependencias**:
- Bloqueada por: MSF-138 (Acceso, organización y permisos · Empresas), que aporta `registro_actividad`; los roles y las secciones (MSF-125) llegan a través de MSF-138. Ambos ya están en `main` (`public.registro_actividad`, `private.nivel_seccion`, `private.puede_accion`).
- Bloquea a: MSF-237 (Cuenta web del cliente), MSF-126 (Ranking de clientes), MSF-155 (Correo masivo a clientes), MSF-142 (Migración inicial de datos), MSF-445 (Mejoras de clientes y proveedores); y, por links cargados desde esas épicas, MSF-159 y MSF-275 (Ventas y despacho) y MSF-182 y MSF-232 (Service técnico).
- Relacionada, sin bloqueo: Ventas y Service técnico usan la misma ficha de cliente y la función `escala_de_cliente` de F-CLI-03.

**Input**: Epic MSF-180. Objetivo: «Al terminar, el equipo puede dar de alta, editar, buscar y exportar clientes de la organización, cada uno con su tipo minorista o mayorista, y existe el Consumidor final para el mostrador, listos para que Ventas los use.»

**Regla de fuentes** (literal de la épica):
- Comportamiento y datos: mandan los requisitos y escenarios de esta spec.
- Qué se ve (disposición, textos, estados, popups, flujos): el prototipo validado es la referencia visual y hay que ser lo más fiel posible (no se exige idéntico al pixel; lo que aún no se construye o queda fuera de alcance se anota, no se omite).
- Qué se ve (disposición, textos, estados, popups, flujos): el prototipo validado es referencia visual, no hace falta que quede idéntico.
- Cómo se construye: mandan el template y el sistema de diseño (MSF-117, `docs/sistema-de-diseno.md`). No se copia HTML ni CSS: se reproduce con los componentes del template y los tokens.
- El prototipo muestra más que esta historia: se implementa solo lo que piden los requisitos de F-CLI-01…04.
- Si algo no se puede igualar: lo más cercano, sin inventar, anotando la diferencia en el PR. Si prototipo y requisitos se contradicen: requisitos para el comportamiento, prototipo para lo visual, y la contradicción queda anotada en el PR.
- Prototipos (solo lectura, ya presentes en el árbol de trabajo; la rama `design/prototipo` no existe en `origin` hoy): `design/pantallas/Clientes.dc.html`, `design/pantallas/ClienteFicha.dc.html`, `design/pantallas/TiposCliente.dc.html`.

## Modelo y supuestos

- **Clientes compartidos en la organización** (decisión a confirmar con el cliente): un cliente pertenece a la organización, no a una empresa/tienda. No hay filtro por empresa en esta épica.
- **El cliente se archiva y no se borra.** Se puede restaurar. No hay «Eliminar» en la interfaz.
- **Permisos** (matriz a confirmar): Administrador, Administración, Mostrador y Operador editan Clientes; Depósito y Consulta solo leen. Se resuelve con el contrato vigente `private.nivel_seccion('clientes')` (ver *Decisiones abiertas* 1). Exportar se rige por la acción `exportar` de la sección (`private.puede_accion('clientes','exportar')`).
- **Service técnico** usa la misma ficha, sin tabla propia. Con qué rol entra a Clientes es pregunta abierta (la matriz le da `service_tecnico` aparte; esta épica no la toca).
- **Tipo de cliente**: dos tipos fijos, **minorista** y **mayorista**, que no se crean ni se borran. No se construye la pantalla «Tipos de cliente».
- **Consumidor final**: un cliente por organización, reservado al mostrador, de tipo minorista, que no se edita ni se archiva.
- **`escala_de_cliente`** (F-CLI-03): función de lectura que Ventas y Service técnico usan para saber qué escala de precios aplica a un cliente. Si el tipo fija la escala o si depende de la cantidad es pregunta abierta con Precios (ver *Decisiones abiertas* 3).
- El template trae el esqueleto `clientes` (id, organizacion_id, nombre, created_at) y el patrón de lista, alta y edición de `pages/clientes`. Esta épica lo **extiende con migraciones aditivas**; no hay búsqueda, filtros, paginación ni exportación previas.

### Esquema de datos (Constitución, Principio VII)

| Tabla | Esquema | Justificación | RLS |
|-------|---------|---------------|-----|
| `clientes` (existente, template) | **`public`** (excepción documentada) | `clientes` es dominio del producto y, por Principio VII, correspondería a `dominio`. Se **mantiene en `public`** porque ya existe expuesta (esqueleto del template), y moverla o renombrarla no es aditivo y rompe `clientes_identificadores_externos`, `rls_en_toda_tabla` y el mapeo de identificadores. El traslado a `dominio` queda como seguimiento trazado (T021), no se hace en esta épica. | Ya activa. Se **reemplazan las políticas** de `puede_escribir()` por `private.nivel_seccion('clientes')`: select con `lectura`/`edicion`; insert/update con `edicion`; sin DELETE. |

No se crean tablas nuevas. Columnas nuevas en `clientes` (todas aditivas, nullable o con default): `numero`, `documento`, `correo`, `telefono`, `celular`, `direccion`, `codigo_postal`, `localidad`, `provincia`, `tipo`, `es_consumidor_final`, `archivado_en`, `updated_at` (detalle en `plan.md`). Reversión en `plan.md`. Cualquier tabla futura declara su propio esquema.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Alta y edición de cliente (F-CLI-01, P0, talla M)

Como persona con permiso de edición en Clientes, quiero dar de alta y editar clientes de la organización, y archivarlos y restaurarlos, para tenerlos listos para Ventas.

**Why this priority**: sin clientes cargados no hay nada que buscar, exportar ni usar en Ventas.

**Independent Test**: un Operador crea «Distribuidora Norte SRL», la edita, la archiva y la restaura; un usuario de Consulta la ve pero no puede cambiarla, ni por la interfaz ni llamando directo a la base.

**Acceptance Scenarios**:

1. **Given** el listado de Clientes, **When** quien edita pulsa «Nuevo cliente», **Then** se abre el formulario «Nuevo cliente» con: nombre o razón social (obligatorio), DNI/CUIT, correo, teléfono, celular, dirección, código postal, localidad, provincia y tipo de cliente (Minorista por defecto), y los botones Cancelar y guardar.
2. **Given** un nombre válido, **When** guarda, **Then** el cliente se crea en la organización, recibe un número correlativo de la organización, aparece en el listado y se confirma con «Cliente creado».
3. **Given** un cliente existente, **When** quien edita abre «Editar cliente» y guarda, **Then** los cambios se reflejan en el listado y en la ficha y se confirma con «Cliente guardado».
4. **Given** un nombre vacío o solo espacios, **When** intenta guardar, **Then** se indica el error en el campo y no se guarda. El nombre se guarda recortado.
5. **Given** un cliente activo, **When** quien edita elige «Archivar» y confirma, **Then** deja de verse en el listado por defecto, no se pierde ningún dato, y queda visible con el filtro «Archivados».
6. **Given** un cliente archivado, **When** quien edita lo restaura, **Then** vuelve al listado activo con sus datos y su número.
7. **Given** un usuario sin permiso de edición (Depósito/Consulta, o sin acceso a Clientes), **Then** no ve «Nuevo cliente», «Editar» ni «Archivar/Restaurar» y la base rechaza la escritura aunque llame directo; con sección en `ninguno` no ve el menú ni lee filas.
8b. **Given** un DNI/CUIT ya usado por otro cliente de la organización (activo o archivado), **When** se intenta guardar un cliente nuevo o editado con ese mismo documento (sin importar puntos, guiones ni espacios), **Then** se rechaza con el error en el campo «Ya existe un cliente con ese DNI/CUIT», y no se guarda; dos clientes con el mismo nombre o apellido sí pueden coexistir. Un documento vacío no cuenta como repetido.
8. **Given** que dos personas crean clientes a la vez en la misma organización, **Then** cada cliente recibe un número distinto (sin saltos duplicados).
9. **Given** que el guardado falla (red, servidor), **Then** el formulario muestra el error con posibilidad de reintentar y conserva lo escrito.
10. **Given** una alta, edición, archivado o restauración, **Then** queda un evento en el registro de actividad de la organización (`cliente.creado`, `cliente.editado`, `cliente.archivado`, `cliente.restaurado`) con quién y cuándo, sin datos de contacto en el detalle.
11. **Given** un cliente de otra organización (id manipulado), **Then** no se lee ni se modifica (aislamiento).

---

### User Story 2 - Listado y búsqueda de clientes (F-CLI-02, P0, talla M)

Como persona con acceso a Clientes, quiero listar y buscar clientes con filtros y paginación, para encontrar uno rápido aunque haya miles.

**Independent Test**: con más de una página de clientes, buscar por parte del nombre, por documento, por correo y por localidad devuelve los esperados; filtrar por tipo y por archivados; paginar sin cargar todo.

**Acceptance Scenarios**:

1. **Given** la pantalla Clientes, **Then** muestra una tabla paginada en el servidor con columnas Cliente (nombre y documento), Tipo, Contacto (correo y teléfono) y Localidad, con el título «Clientes», la acción «Nuevo cliente» (solo quien edita) y «Exportar» (solo quien puede exportar).
2. **Given** un texto en el buscador, **When** se escribe (con espera breve para no consultar en cada tecla), **Then** el listado se filtra en el servidor por coincidencia parcial, sin distinguir mayúsculas, en nombre, DNI/CUIT, correo, teléfono, localidad y número, y vuelve a la primera página.
3. **Given** los filtros «Todos / Minorista / Mayorista», **When** se elige uno, **Then** se aplica junto con la búsqueda. Un filtro «Activos / Archivados» (por defecto Activos) permite ver los archivados.
4. **Given** más resultados que una página, **Then** se pagina en el servidor, se muestra el total, y cambiar de página conserva búsqueda y filtros.
5. **Given** una búsqueda sin resultados, **Then** se muestra el estado vacío «Sin resultados — Probá con otra búsqueda o cambiá el filtro.»; sin ningún cliente cargado, el vacío del patrón compartido invita a crear el primero (si tiene permiso).
6. **Given** un error al consultar, **Then** se muestra el estado de error compartido con «Reintentar».
7. **Given** un resultado, **When** se abre una fila, **Then** se llega a la ficha del cliente (datos, tipo) con «Editar» para quien puede editar.
8. **Given** pantallas de 320, 768 y 1440 px, **Then** el listado es utilizable (vista adaptable de tarjetas en angosto), con teclado y lector de pantalla, sin identificadores técnicos visibles.
9. **Given** un usuario de otra organización o sin acceso, **Then** no ve estas filas (RLS por organización y por sección).

---

### User Story 3 - Tipo de cliente y Consumidor final (F-CLI-03, P0, talla S)

Como equipo de Ventas y Mostrador, quiero que cada cliente tenga tipo minorista o mayorista y que exista el Consumidor final, para vender en el mostrador sin cargar un cliente cada vez.

**Independent Test**: toda organización (nueva o existente) tiene exactamente un Consumidor final minorista que no se puede editar ni archivar; `escala_de_cliente` devuelve la escala esperada para un minorista, un mayorista y el Consumidor final.

**Acceptance Scenarios**:

1. **Given** una organización (existente al migrar o creada después), **Then** tiene un único cliente «Consumidor final», de tipo minorista, creado automáticamente, visible en el listado y marcado como cliente de mostrador.
2. **Given** el Consumidor final, **When** alguien intenta editarlo, archivarlo o cambiarle el tipo (por la interfaz o directo a la base), **Then** se rechaza; en la interfaz no ofrece «Editar» ni «Archivar».
3. **Given** el alta o edición de un cliente, **Then** el tipo se elige entre Minorista y Mayorista, con la explicación breve de cada uno; el tipo no se puede dejar vacío.
4. **Given** un cambio de tipo, **Then** se avisa que «se aplica a todos los comprobantes de este cliente; los ya cargados no se recalculan» (texto del prototipo) y se registra en la actividad.
5. **Given** un cliente cualquiera de la organización, **When** Ventas o Service técnico llaman a `escala_de_cliente(cliente)`, **Then** devuelve la escala asociada a su tipo: Minorista → `x1` (siempre precio de lista); Mayorista → `por_cantidad` (escala según cantidad, que resuelve Precios). Para un cliente de otra organización o inexistente devuelve nulo. Ver *Decisiones abiertas* 3.
6. **Given** que no se pueden crear ni borrar tipos, **Then** no existe la pantalla «Tipos de cliente» ni sus acciones (Nuevo/Editar tipo, descuento, condición de pago).

---

### User Story 4 - Exportar clientes (F-CLI-04, P0, talla S)

Como persona con permiso de exportar, quiero descargar los clientes en un archivo, para trabajarlos fuera del panel.

**Independent Test**: con búsqueda y filtros aplicados, «Exportar» descarga un archivo con todas las filas que coinciden (no solo la página) y con las columnas del listado más los datos de contacto; un rol sin permiso de exportar no ve el botón.

**Acceptance Scenarios**:

1. **Given** el listado con búsqueda y filtros, **When** quien tiene la acción `exportar` pulsa «Exportar», **Then** se descarga un archivo con **todos** los clientes que coinciden (de todas las páginas), con número, nombre o razón social, DNI/CUIT, tipo, correo, teléfono, celular, dirección, código postal, localidad, provincia y estado (activo/archivado).
2. **Given** un rol sin la acción `exportar` (por defecto Mostrador, Depósito y Consulta), **Then** no ve «Exportar», y la RPC de exportación rechaza la llamada directa.
3. **Given** la exportación en curso, **Then** el botón queda deshabilitado con indicación de progreso y, al terminar, se confirma («Exportación lista»); si falla, error con reintento.
4. **Given** nombres con tildes o caracteres especiales, **Then** el archivo `.xlsx` se abre bien en Excel (tildes y caracteres especiales intactos, una columna por campo, encabezados en la primera fila) y los valores que empiezan con `=`, `+`, `-` o `@` se guardan como texto y se neutralizan para evitar inyección de fórmulas.
5. **Given** un volumen grande, **Then** la exportación se arma por lotes sin bloquear la interfaz, con un tope máximo documentado (ver plan).

---

### Edge Cases

- Búsqueda con caracteres especiales de patrón (`%`, `_`, `\`): se escapan; no actúan como comodines.
- Doble clic en guardar o en archivar: el botón se deshabilita mientras envía; la operación es idempotente (archivar un cliente ya archivado no duplica el evento).
- Cliente archivado: no se ofrece para Ventas como activo (Ventas filtra por `archivado_en is null`); sigue siendo legible por sus comprobantes históricos.
- Dos clientes con el mismo DNI/CUIT: se impide (único por organización, comparando solo los dígitos; incluye archivados, para que restaurar nunca choque). Nombres o apellidos repetidos: se permiten (decisión de Nicolás, ver *Decisiones* 5). Dos altas simultáneas con el mismo documento: gana una y la otra recibe el error de duplicado.
- Cliente creado por importación (MSF-142) o API sin sesión: no genera evento de actividad (no hay actor) pero sí recibe número.
- Organización nueva creada por la Edge Function de alta: recibe su Consumidor final automáticamente.
- Usuario suspendido: `nivel_seccion` ya lo trata sin acceso; no ve ni escribe.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** (F-CLI-01): El sistema DEBE permitir crear y editar clientes de la organización con nombre o razón social (obligatorio, recortado), DNI/CUIT, correo, teléfono, celular, dirección, código postal, localidad, provincia y tipo. La organización la resuelve el servidor, nunca el llamador.
- **FR-016** (F-CLI-01): El DNI/CUIT, cuando se informa, DEBE ser único por organización, comparado por sus dígitos (ignora puntos, guiones y espacios) y contando también los clientes archivados; el control lo hace la base (índice único parcial), no solo la interfaz, y la interfaz muestra el error en el campo. El nombre o razón social NO DEBE ser único. Un documento vacío se guarda como nulo.
- **FR-002** (F-CLI-01): Cada cliente DEBE tener un `numero` correlativo por organización, asignado por la base y sin duplicados bajo concurrencia, único por `(organizacion_id, numero)`.
- **FR-003** (F-CLI-01): El cliente DEBE archivarse (`archivado_en`) y restaurarse; NO DEBE existir borrado desde la aplicación (sin política ni grant DELETE para `authenticated`; el borrado en cascada de la organización sigue siendo la única baja física).
- **FR-004** (F-CLI-01): La RLS de `clientes` DEBE usar `private.nivel_seccion('clientes')`: `select` con `lectura` o `edicion`; `insert`/`update` con `edicion`; filtradas por `private.organizacion_id()`. `anon` sin acceso. La UI DEBE reflejar el mismo contrato (`SECCION_POR_RECURSO`), quitando `clientes` de `RECURSOS_ESCRITURA_SOLO_ADMINISTRADOR`.
- **FR-005** (F-CLI-01): Las altas, ediciones, archivados, restauraciones y cambios de tipo DEBEN registrarse en `registro_actividad` (tipos `cliente.creado`, `cliente.editado`, `cliente.archivado`, `cliente.restaurado`) en la misma transacción, vía `private.registrar_actividad`, sin volcar datos personales en el detalle.
- **FR-006** (F-CLI-02): El listado DEBE paginar, buscar y filtrar en el servidor (tipo, activo/archivado), con total, estados de carga/vacío/error compartidos, y búsqueda parcial insensible a mayúsculas en nombre, DNI/CUIT, correo, teléfono, localidad y número, con escape de comodines.
- **FR-007** (F-CLI-02): Las consultas de búsqueda DEBEN estar respaldadas por índices acordes (organización + orden, y búsqueda parcial) y NO DEBEN cargar el total de filas en el navegador.
- **FR-008** (F-CLI-03): `clientes.tipo` DEBE ser `minorista` o `mayorista` (restricción en base, no nulo, default `minorista`); no se crean ni borran tipos.
- **FR-009** (F-CLI-03): Cada organización DEBE tener exactamente un Consumidor final (`es_consumidor_final`, índice único parcial por organización), minorista, creado al migrar para las existentes y por disparador al crear organizaciones nuevas; DEBE ser inmutable (no se edita, no se archiva, no cambia de tipo) por la base.
- **FR-010** (F-CLI-03): DEBE existir `public.escala_de_cliente(p_cliente_id uuid)` (lectura, `security invoker`, respeta RLS) que devuelve `x1` para minorista y `por_cantidad` para mayorista, y nulo si el cliente no es visible; con `revoke … from public, anon` y `grant execute … to authenticated`.
- **FR-011** (F-CLI-04): «Exportar» DEBE generar un archivo (planilla Excel `.xlsx`) con todas las filas que coinciden con la búsqueda y los filtros, por lotes, y solo para quien tenga `private.puede_accion('clientes','exportar')`; la RPC de exportación DEBE validarlo en el servidor.
- **FR-012** (F-CLI-04): El archivo DEBE ser un `.xlsx` real; toda celda de dato se escribe como texto (nunca como fórmula) y los valores que empiezan con `=`, `+`, `-` o `@` se neutralizan. Se permite una librería de planillas de licencia permisiva (MIT/Apache 2.0), cargada de forma diferida solo al exportar.
- **FR-013**: Toda RPC nueva de `public` DEBE llevar `revoke … from public, anon` y `grant execute … to authenticated`; el test pgTAP de `anon` debe seguir verde.
- **FR-014**: La interfaz DEBE usar el sistema de diseño (MSF-117) y los patrones compartidos de carga, vacío, error y éxito; funcionar con teclado y lector de pantalla (foco al abrir y cerrar diálogos, etiquetas, errores asociados al campo) y en 320/768/1440 px, en español de Argentina, sin identificadores técnicos visibles. La navegación (ítem «Clientes», ruta `/clientes`) existente no cambia.
- **FR-015**: Las migraciones DEBEN ser aditivas (columnas nullable o con default, índices, funciones, políticas reemplazadas) con reversión documentada; los clientes ya cargados reciben `numero`, `tipo = 'minorista'` y quedan activos.

### Fuera de alcance / no objetivos

Todo lo siguiente aparece en el prototipo o en la épica pero es de otras historias o épicas y **no** se implementa aquí:
- Cuenta web del cliente, invitación, «Tiendas / Habilitado en» y filtro «Con cuenta web» (MSF-237); la cuenta web por empresa es de esa épica.
- Ranking por facturación (MSF-126), correo masivo a seleccionados (MSF-155), Importar clientes (MSF-142), Etiquetas.
- Pantalla «Tipos de cliente» (crear tipos, descuento adicional, condición de pago): el documento siembra dos tipos fijos.
- «Expreso preferido» (Ventas y despacho) y datos de comprobantes (Facturado, Participación).
- Filtro por empresa/tienda del clientes (los clientes son de la organización).
- Eliminar cliente (se archiva).
- Mejoras de clientes y proveedores (MSF-445); Proveedores.

## Decisiones (respondidas por Nicolás el 2026-10-16; el resto no bloquea)

1. **Permisos y matriz**: se usa `nivel_seccion('clientes')` (ya en `main`), no `puede_escribir()` como supone el texto de la épica (que partía del template con dos roles). Es lo que permite que Operador, Mostrador y Administración editen. La matriz inicial vigente (`Roles.dc.html`) da a **Depósito** `ninguno` en Clientes (la épica dice «solo lee») y a **Consulta** `lectura`; esta épica no cambia la matriz (es de MSF-125, editable en Usuarios y roles). **Resuelta (Nicolás: «no se»)**: Depósito NO pasa a solo lectura en Clientes; se conserva la matriz vigente sin cambios. La divergencia con el texto de la épica queda anotada en el PR.
2. **Archivar vs. «Eliminar cliente» del prototipo**: se archiva y restaura (requisito); el diálogo «Eliminar» del prototipo no se implementa. Anotar en el PR.
3. **`escala_de_cliente`** — *confirmada por Nicolás*: regla provisoria hasta que Precios decida. Se implementa la lectura mínima derivada del prototipo (Minorista = `x1` siempre; Mayorista = `por_cantidad`) como contrato estable; si Precios decide otra cosa, solo cambia el cuerpo de la función.
4. **`clientes` en `public` vs `dominio`**: excepción documentada arriba; confirmar el traslado a `dominio` en una épica propia.
5. **Duplicados** — *decidido por Nicolás*: DNI y CUIT NO se pueden repetir (único por organización, FR-016); sí pueden existir personas con el mismo nombre y/o apellido. Sin validación del dígito verificador del CUIT.
6. **Formato de exportación** — *confirmado por Nicolás (2026-10-16, «sí a xlsx excel»)*: planilla Excel `.xlsx` real, no CSV. Reemplaza la lectura anterior (CSV para Excel). Implica una dependencia nueva de licencia permisiva (ver plan), con carga diferida.
7. **Eventos de actividad**: *confirmados por Nicolás* (`cliente.creado/editado/archivado/restaurado`) como válidos con el documento del componente. La exportación no genera evento salvo que se pida.
8. **Service técnico**: con qué rol entra a Clientes sigue abierto; no se toca la sección `service_tecnico`.
9. **Cliente compartido en la organización** (supuesto a confirmar con el cliente): si cambiara a por empresa, afectaría la clave de `clientes` y las políticas.

## Success Criteria

- **SC-001**: un usuario con edición crea, edita, archiva y restaura un cliente; Consulta lo ve sin poder cambiarlo (Vitest + pgTAP).
- **SC-002**: la búsqueda, los filtros y la paginación se resuelven en el servidor con 5.000+ clientes de prueba, sin cargar todos (pgTAP/Vitest y evidencia del plan de consulta).
- **SC-003**: toda organización tiene un único Consumidor final inmutable; `escala_de_cliente` devuelve lo esperado para minorista, mayorista y Consumidor final (pgTAP).
- **SC-004**: la exportación incluye todas las filas filtradas, respeta la acción `exportar` en UI y servidor y neutraliza fórmulas (Vitest + pgTAP).
- **SC-007**: un DNI/CUIT repetido en la misma organización es rechazado por la base y por la interfaz (también con otro formato de puntos/guiones); el mismo nombre repetido se guarda; otra organización puede usar el mismo documento (pgTAP + Vitest).
- **SC-005**: aislamiento por organización y por sección verificado (otra organización y rol `ninguno` no leen ni escriben); `anon` sin acceso (pgTAP).
- **SC-006**: `pnpm lint && pnpm build && pnpm test && pnpm docs:check` sin errores.

## Matriz de trazabilidad Jira ↔ US ↔ FR ↔ tareas

| Jira | Historia | FR | Tareas |
|------|----------|----|--------|
| F-CLI-01 | US1 Alta y edición de cliente | FR-001…005, FR-013…016 | T002, T004, T007, T009, T010, T011, T013, T015 |
| F-CLI-02 | US2 Listado y búsqueda | FR-006, FR-007, FR-014 | T005, T008, T012, T016, T019 |
| F-CLI-03 | US3 Tipo y Consumidor final | FR-008, FR-009, FR-010 | T003, T007, T008, T013 |
| F-CLI-04 | US4 Exportar clientes | FR-011, FR-012 | T006, T008, T014, T016 |
| MSF-180 (épica) | Integración, datos de prueba, docs y cierre | FR-013…015, Principio VIII | T001, T017–T022 |
