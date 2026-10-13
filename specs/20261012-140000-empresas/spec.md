# Feature Specification: Acceso, organización y permisos · Empresas

**Feature Branch**: `epic/MSF-138-acceso-organizacion-y-permisos-empresas`

**Jira Epic**: MSF-138 — Acceso, organización y permisos · Empresas (spec `empresas`)

**Created**: 2026-10-12

**Status**: Ready for implementation — la especificación viene completa desde Jira. Los puntos de "A revisar" son de planificación o dependen de otras épicas y no bloquean la implementación (ver *Decisiones abiertas*).

**Delivery scope**: `refine` (apps/web) y `supabase` (migración + pgTAP). Sin `kestra`, `superset` ni `workers`.

**Prioridad / Hito**: P0 · Hito 1 (6 al 30 de octubre de 2026) · ~12 h (las 4 historias S suman 16 h nominales; se mantienen 12 porque el patrón CRUD de clientes del template cubre la mecánica).

**Dependencias**: Bloqueada por ninguna épica (se apoya en la audiencia administrador, `private.puede_escribir()` y el patrón CRUD de clientes del template). Bloquea a MSF-121 (Permisos por empresa, F-ROL-04 usa la tabla `empresas`) y MSF-132 (Administración de usuarios y organización: F-ORG-03 lista empresas, F-EMP-03 crea sobre ellas). Otras épicas (Precios, Tiendas online, Mercado Libre, Ventas) consumen la tabla. Relacionada, sin bloqueo, con MSF-125 y con el registro de actividad F-AUD-01 (Plataforma). Entre historias: F-EMP-01 bloquea a F-EMP-02, F-EMP-04 y F-EMP-05.

**Input**: Epic MSF-138. Objetivo: "Al terminar, el administrador ve las dos empresas (San Javucho y Mundo JC), edita sus datos, pausa o reactiva su tienda y salta de una a otra sin perder lo que estaba haciendo."

**Regla de fuentes**:

- Comportamiento y datos: mandan los requisitos y escenarios de esta spec.
- Qué se ve: el prototipo (rama `design/prototipo`, `design/pantallas/`: `Stores.dc.html`, `StoreGeneral.dc.html`, `SJ_StoreGeneral.dc.html`) es referencia visual; la estética sale del sistema de diseño (MSF-117, `docs/sistema-de-diseno.md`). No copiar HTML ni CSS.
- El prototipo muestra más que esta épica (diálogo «Nueva empresa», pestañas Precios y moneda / Mercado Libre / Identidad visual / Contenido / Catálogo visible / Dominio y publicación, vista previa, publicar/descartar cambios): solo se implementa lo que piden estas historias.

## Modelo y supuestos

- Una **empresa** es quien vende, con su precio, su tienda web y sus cuentas de Mercado Libre; el producto, el stock y la cotización son de la organización.
- **Multitienda por diseño** (indicación de Nicolás, 2026-10-12): una organización puede tener **múltiples empresas**. En el lanzamiento el primer cliente tiene dos (San Javucho y Mundo JC), pero **ningún código, consulta, constraint ni prueba puede asumir que son exactamente dos**: el listado, el cambio de empresa y las reglas de acceso funcionan con 1..N empresas por organización.
- San Javucho y Mundo JC son **dos filas** de `empresas` dentro de **una única organización** (un usuario solo puede estar en una organización). El aislamiento *entre* empresas lo agrega MSF-121; hasta entonces los usuarios de la organización ven todas las de su organización.
- Idioma español de Argentina y moneda base ARS, sin selector.
- Las columnas de tienda web, Mercado Libre y precio del listado muestran «Sin configurar» hasta que existan las épicas que las alimentan.
- La actividad (F-AUD-01) es del componente Plataforma; esta épica solo le envía eventos.
- Son supuestos a confirmar con el cliente.
- El template no trae entidad empresa/marca/tienda: se crea.

### Esquema de datos (Constitución, Principio VII)

| Tabla | Esquema | Justificación | RLS |
|-------|---------|---------------|-----|
| `empresas` | **`dominio`** | Entidad de negocio del producto (quién vende), no mecanismo de plataforma como organizaciones o membresías. | Sí, por organización: SELECT con `private.organizacion_id()`; UPDATE con `private.organizacion_id()` y `private.puede_escribir()`. Sin política INSERT/DELETE en esta épica (crear es F-EMP-03, Etapa 2). |

Migración **aditiva** (tabla nueva); camino de reversión documentado en `plan.md`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Listado de empresas (F-EMP-01, P0, talla S)

Como administrador, quiero ver las empresas de mi organización en una lista, para tener a la vista quién vende y entrar a cualquiera de ellas.

**Why this priority**: Crea la tabla `empresas` y la ruta que usan las otras tres historias, y es la base de las épicas posteriores.

**Independent Test**: Con dos (y con tres) empresas cargadas en una organización, un administrador abre Empresas y las ve todas; un usuario de otra organización no ve ninguna.

**Acceptance Scenarios**:

1. **Given** una organización con las empresas San Javucho y Mundo JC, **When** el administrador abre Empresas, **Then** ve una fila (o tarjeta en pantallas angostas) por cada empresa con nombre, tienda web, Mercado Libre, precio, moneda y productos visibles.
2. **Given** que las épicas que alimentan tienda web, Mercado Libre y precio todavía no existen, **When** se muestra el listado, **Then** esas columnas dicen «Sin configurar» y la moneda dice ARS.
3. **Given** una organización con **tres o más** empresas (o con una sola), **When** el administrador abre Empresas, **Then** se listan todas, sin límite fijo de dos.
4. **Given** el listado, **When** el administrador elige una empresa, **Then** entra a sus datos generales (F-EMP-02).
5. **Given** que la carga falla / no hay empresas / está cargando, **When** se abre Empresas, **Then** se muestran los estados error (con reintentar) / vacío / carga del template.
6. **Given** un usuario con rol miembro (el rol Operador de MSF-125 aún no existe), **When** intenta entrar a Empresas, **Then** no ve el destino en la navegación y la ruta directa le muestra acceso restringido, sin datos (CA-EMP-01-4; se prueba con miembro hasta MSF-125).
7. **Given** dos organizaciones con empresas, **When** un usuario de la organización A consulta empresas, **Then** solo recibe las de A (RLS).

---

### User Story 2 - Datos generales de la empresa (F-EMP-02, P0, talla S)

Como administrador, quiero editar los datos generales de una empresa, para que su identidad comercial y de contacto estén al día.

**Why this priority**: Es el contenido útil de la entidad; depende de la ruta y la tabla de US1.

**Independent Test**: Editar nombre comercial y contacto de Mundo JC, guardar, recargar y ver los valores persistidos; el miembro no puede guardar.

**Acceptance Scenarios**:

1. **Given** la empresa Mundo JC (o San Javucho), **When** el administrador abre «General», **Then** ve nombre comercial, dominio o subdominio (solo lectura, «Sin configurar» hasta Tiendas online; se administra desde «Dominio y publicación»), idioma «Español (Argentina)» y moneda «ARS · Peso argentino» (ambos fijos, sin selector), WhatsApp, correo, Instagram y dirección (opcional).
2. **Given** datos válidos, **When** el administrador guarda, **Then** se persisten, se muestra confirmación de éxito y el nombre actualizado se refleja en el listado y en el selector de empresa.
3. **Given** un nombre comercial vacío o un correo con formato inválido, **When** intenta guardar, **Then** se indica el error en el campo y no se guarda.
4. **Given** cambios sin guardar, **When** el administrador intenta salir de la pantalla, **Then** el aviso de cambios sin guardar del template pide confirmación.
5. **Given** un usuario sin permiso de escritura, **When** llega por URL directa a editar, **Then** RLS impide el guardado aunque la interfaz lo permitiera.
6. **Given** una empresa de otra organización, **When** se pide su id, **Then** no se encuentra (RLS) y se muestra el estado de error/no encontrado.
7. **Given** que se guarda un cambio, **Then** se envía un evento de actividad a F-AUD-01 (actor, empresa, qué cambió, fecha).

---

### User Story 3 - Activar y desactivar la tienda de una empresa (F-EMP-04, P0, talla S)

Como administrador, quiero pausar o reactivar la tienda de una empresa, para sacarla de línea o volver a ponerla sin tocar el resto de sus datos.

**Why this priority**: Control operativo básico por empresa; el estado alimentará luego a Tiendas online.

**Independent Test**: Pausar Mundo JC, verificar estado «pausada» persistido y San Javucho intacta; reactivar y verificar «activa».

**Acceptance Scenarios**:

1. **Given** una empresa activa, **When** el administrador la pausa, **Then** el estado persiste como pausada y la pantalla y el listado lo reflejan.
2. **Given** una empresa pausada, **When** el administrador la reactiva, **Then** vuelve a activa.
3. **Given** que se pausa o reactiva una empresa, **Then** las demás empresas de la organización no cambian de estado.
4. **Given** el control de estado, **When** se muestra, **Then** aclara el efecto («Si la desactivás, el dominio muestra un aviso de “Volvemos pronto”»); el aviso en el dominio lo implementa Tiendas online, esta épica solo persiste y expone el estado.
5. **Given** un usuario sin permiso de escritura, **When** intenta cambiar el estado, **Then** la acción no está disponible y RLS la rechaza.
6. **Given** un cambio de estado, **Then** se envía el evento correspondiente a F-AUD-01.

---

### User Story 4 - Cambio rápido de empresa (F-EMP-05, P0, talla S)

Como administrador, quiero saltar de una empresa a otra desde cualquier pantalla de empresa, para trabajar en ambas sin perder lo que estaba haciendo.

**Why this priority**: Sostiene la operación diaria con varias empresas.

**Independent Test**: Estando en «General» de una empresa, cambiar a otra desde el selector y quedar en «General» de la otra; con cambios sin guardar, se pide confirmación antes de cambiar.

**Acceptance Scenarios**:

1. **Given** una organización con varias empresas, **When** el administrador abre el selector de empresa, **Then** ve todas las empresas de la organización (cualquier cantidad) y marcada la actual.
2. **Given** que está en la sección «General» de una empresa, **When** elige otra, **Then** va a la misma sección de la elegida, con sus datos.
3. **Given** cambios sin guardar en la pantalla, **When** elige otra empresa, **Then** el aviso de cambios sin guardar pide confirmar; si cancela, permanece donde estaba con sus cambios.
4. **Given** una sola empresa en la organización, **When** se muestra el selector, **Then** aparece como etiqueta fija, sin opción de cambio.
5. **Given** el cambio de empresa, **Then** no se pierde la sesión ni el contexto de organización.

---

### Edge Cases

- Organización sin empresas: estado vacío en el listado; selector sin opciones de cambio.
- Pérdida de conexión al guardar o pausar: error visible con reintento; el estado en pantalla no queda distinto del persistido.
- Dos administradores editando la misma empresa: gana el último guardado (sin control de versiones; no previsto por la épica).
- Empresa pausada sigue siendo visible, editable y seleccionable.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE tener una tabla `empresas` en el esquema `dominio`, con `organizacion_id` obligatorio, que admite **N empresas por organización** (sin constraint ni lógica que limite a dos).
- **FR-002**: `empresas` DEBE tener RLS: lectura limitada a la organización resuelta por `private.organizacion_id()`; modificación solo con `private.puede_escribir()`; la prueba pgTAP de aislamiento DEBE cubrir la tabla y fallar si no tuviera RLS.
- **FR-003**: Ningún código, dato semilla de prueba ni texto de UI DEBE asumir exactamente dos empresas; San Javucho y Mundo JC son datos, no constantes de código.
- **FR-004**: El panel DEBE ofrecer el destino «Empresas» (listado) y la ruta de datos generales por empresa, visibles solo para la audiencia administrador (CA-EMP-01-4: el rol Operador/miembro no accede y ve acceso restringido).
- **FR-005**: El listado DEBE mostrar por empresa: nombre, tienda web, Mercado Libre, precio, moneda (ARS) y productos visibles, con «Sin configurar» donde no hay origen de datos todavía, y adaptarse a 320/768/1440 px (`ContenidoAdaptable`).
- **FR-006**: Los datos generales DEBEN permitir editar nombre comercial, WhatsApp, correo, Instagram y dirección (opcional); idioma (es-AR) y moneda (ARS) son fijos y sin selector; el dominio se muestra en solo lectura.
- **FR-007**: El formulario DEBE validar nombre obligatorio y formato de correo, informar éxito/error con los patrones compartidos, y usar el aviso de cambios sin guardar del template.
- **FR-008**: El sistema DEBE persistir el estado activa/pausada de cada empresa y permitir al administrador alternarlo, sin afectar a otras empresas.
- **FR-009**: El selector de empresa DEBE listar todas las empresas de la organización, conservar la sección actual al cambiar y respetar el aviso de cambios sin guardar.
- **FR-010**: Editar datos y cambiar el estado DEBE emitir eventos de actividad hacia F-AUD-01 (esta épica no implementa el registro).
- **FR-011**: Las pantallas DEBEN usar el sistema de diseño (MSF-117), los patrones de estados carga/vacío/error/éxito y no mostrar identificadores técnicos (UUID) como identidad visible (Principio VI).
- **FR-012**: La interfaz DEBE estar en español de Argentina.

### Fuera de alcance

- F-EMP-03 (crear empresa, diálogo «Nueva empresa» del prototipo): Etapa 2 (P1).
- CA-EMP-01-5 (alerta de vencimiento de Mercado Libre): Etapa 2.
- Pestañas Precios y moneda, Mercado Libre, Identidad visual, Contenido, Catálogo visible, Dominio y publicación, vista previa y publicar/descartar: otras épicas.
- Aislamiento por empresa (MSF-121), rol Operador y pantalla de acceso restringido de F-ROL-03 (MSF-125), registro de actividad (F-AUD-01), aviso «Volvemos pronto» en el dominio (Tiendas online).

### Key Entities

- **Empresa** (`dominio.empresas`): pertenece a una organización; nombre comercial, datos de contacto (WhatsApp, correo, Instagram, dirección opcional), estado activa/pausada. Idioma y moneda son constantes del producto, no columnas.

## Success Criteria *(mandatory)*

- **SC-001**: Un administrador ve todas las empresas de su organización en el listado y ninguna de otra (pgTAP + E2E).
- **SC-002**: Un administrador edita y persiste los datos generales de una empresa y los ve reflejados en el listado (E2E).
- **SC-003**: Pausar y reactivar cambia solo el estado de la empresa elegida (E2E + pgTAP).
- **SC-004**: El administrador cambia de empresa conservando la sección, y con cambios sin guardar se le pide confirmación (E2E).
- **SC-005**: Funciona igual con 1, 2 y 3 empresas por organización.
- **SC-006**: `pnpm lint`, `pnpm build` y `pnpm test` pasan; la prueba pgTAP de aislamiento cubre `empresas`.

## Decisiones abiertas ("A revisar", no bloqueantes)

- Confirmar con Nicolás que no se quiere mantener el bloqueo MSF-125 → MSF-138; CA-EMP-01-4 se verifica con miembro y se completa con el Operador cuando llegue MSF-125.
- Horas: se mantienen 12 aunque las tallas sumen 16. Roadmap manda ante conflicto con otros documentos.
- Interpretación de esta spec: la columna «Productos visibles» del listado también muestra «Sin configurar» (el catálogo no existe aún); la épica solo lo dice de tienda, Mercado Libre y precio.
- Carga inicial de las dos empresas del primer cliente: es un dato (no código), ver plan.

## Trazabilidad Jira ↔ historia ↔ requisitos

| Jira | Historia | Prioridad / Talla | Requisitos | Éxito |
|------|----------|-------------------|------------|-------|
| MSF-138 / F-EMP-01 | US1 Listado de empresas | P0 / S | FR-001–005, FR-011, FR-012 | SC-001, SC-005 |
| MSF-138 / F-EMP-02 | US2 Datos generales | P0 / S | FR-006, FR-007, FR-010 | SC-002 |
| MSF-138 / F-EMP-04 | US3 Activar/desactivar tienda | P0 / S | FR-008, FR-010 | SC-003 |
| MSF-138 / F-EMP-05 | US4 Cambio rápido de empresa | P0 / S | FR-009 | SC-004 |
| MSF-138 (transversal) | Multitienda, aislamiento | P0 | FR-001–003 | SC-005, SC-006 |
