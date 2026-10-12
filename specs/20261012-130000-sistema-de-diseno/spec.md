# Feature Specification: Plataforma · Sistema de diseño

**Feature Branch**: `epic/MSF-117-plataforma-sistema-de-diseno`

**Jira Epic**: MSF-117 — Plataforma · Sistema de diseño (spec `sistema-de-diseno`)

**Created**: 2026-10-12

**Status**: Ready for implementation — la especificación viene completa desde Jira; las dudas de "A revisar" son de planificación (horas, hito, alcance de calendario) y no bloquean la implementación

**Delivery scope**: `refine` (apps/web). Sin `supabase`, `kestra`, `superset` ni `workers`.

**Prioridad / Hito**: P0 · Hito 1 (antes de las épicas con pantallas) · Bloqueada por: ninguna · Bloquea a: MSF-114 (precios-e-iva), MSF-116 (dolar-y-recalculo) y toda épica con pantallas.

**Input**: Epic MSF-117. Objetivo: "Al terminar, el producto tiene un sistema de diseño propio que define su estética general (colores, tipografías, espaciados, formas y componentes base), aplicado sobre el tema del template, y todas las pantallas nuevas lo usan en vez de copiar cada una el prototipo."

**Regla de fuentes** (literal de la épica):

- Comportamiento y datos: mandan los requisitos y escenarios de esta historia.
- Qué se ve: el prototipo validado es referencia visual, no hace falta que quede idéntico.
- Cómo se construye: mandan el template y el system design del producto. No copiar HTML ni CSS del prototipo: reproducir lo que muestra con los componentes del template y los tokens del sistema de diseño.
- El prototipo muestra más que esta historia: implementar solo lo que piden los requisitos; el resto es de otras historias.
- Si algo no se puede igualar: usar lo más cercano, sin inventar, y anotar la diferencia en la descripción del PR.
- Si prototipo y requisitos se contradicen: requisitos para comportamiento, prototipo para lo visual, y anotar la contradicción en el PR.

**Prototipo (solo lectura, rama `design/prototipo`, carpeta `design/pantallas/`)**: Panel administrativo — `Main`, `AdminHeader`, `AdminSider`, `Categorias`, `ProductoAlta`, `Stores`; Tiendas públicas — `MJC_Home`, `MJC_Catalogo`, `MJC_Producto` y equivalentes `SJ_*`; Identidad visual por empresa — `StoreIdentidad`, `SJ_StoreIdentidad`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Tokens y tema del panel (DS-01, P0, talla M)

Como equipo de producto, quiero que la estética general del panel (colores, tipografías, espaciados y formas) esté definida como tokens y aplicada como tema sobre el tema del template, para que cualquier pantalla del panel herede el mismo aspecto sin definirlo por su cuenta.

**Why this priority**: Es la base de las otras tres historias y de toda épica con pantallas.

**Independent Test**: Renderizar el panel con el tema aplicado y comprobar que tipografías, colores, altura/esquinas de botones y espaciados salen de los tokens, sin valores sueltos en las pantallas.

**Acceptance Scenarios**:

1. **Given** el panel administrativo, **When** se renderiza cualquier texto, **Then** los títulos usan Sora y el texto usa Instrument Sans.
2. **Given** un botón primario, **When** se renderiza y se pasa el cursor, **Then** usa el azul de acción `#2B55E6` (hover `#1E3FB8`), 38 px de alto y esquinas de 9 px.
3. **Given** el panel, **When** se revisan colores de texto, bordes, fondos y peligro, **Then** coinciden con los tokens: texto `#15181D`, secundario `#5F6670`, bordes `#D9D8D2` y `#E6E5E0`, fondos `#F5F5F2` y `#EEEDE8`, peligro `#C62828`.
4. **Given** el tema del template (MUI sobre Refine), **When** se aplican los tokens, **Then** se hace extendiendo ese tema (no copiando HTML/CSS del prototipo) y los valores quedan en un único lugar.

### User Story 2 - Componentes base y estados (DS-02, P0, talla L)

Como desarrollador de una épica con pantallas, quiero un catálogo documentado de componentes base con sus estados, para armar pantallas reutilizándolos en vez de copiar el prototipo.

**Why this priority**: Es el entregable que evita que cada épica reinterprete el prototipo.

**Independent Test**: Abrir el catálogo documentado, comprobar que cada componente base lista sus variantes y estados, y que existe en el código reutilizando componentes del template/MUI y los tokens de DS-01.

**Acceptance Scenarios**:

1. **Given** el catálogo, **When** se consulta, **Then** cada componente base (según el prototipo y los ya existentes en `apps/web/src/components`: botones, campos, tarjetas, etiquetas/estado, tablas y estados de página) indica variantes, estados y cuándo usarlo.
2. **Given** un componente base, **When** se renderiza en sus estados (normal, hover, foco, deshabilitado, error/peligro, cargando, vacío), **Then** cada estado se ve consistente con los tokens.
3. **Given** el catálogo, **When** una épica nueva lo consulta, **Then** encuentra las reglas de uso que debe seguir (usar el componente base, no valores sueltos, no copiar HTML/CSS del prototipo).
4. **Given** un componente ya existente del panel (p. ej. estados de página), **When** se alinea al sistema, **Then** conserva su comportamiento y sus tests.

### User Story 3 - Estructura del panel: encabezado, menú y selector de empresa (DS-03, P0, talla M)

Como usuario del panel, quiero un encabezado, un menú lateral y un selector de empresa con el aspecto del sistema de diseño, para orientarme igual en todas las pantallas.

**Why this priority**: Es el marco que comparten todas las pantallas del panel.

**Independent Test**: Abrir el panel y verificar que encabezado, menú lateral y selector de empresa usan los tokens y componentes base, y siguen funcionando como hoy.

**Acceptance Scenarios**:

1. **Given** el panel, **When** se ve el encabezado (`AdminHeader`), **Then** muestra el selector de empresa activa, la zona de acciones y el menú de cuenta con la estética del sistema.
2. **Given** el menú lateral (`AdminSider`), **When** se ve, **Then** usa los tokens y el estado activo/hover/colapsado es consistente con los componentes base.
3. **Given** un usuario con varias empresas, **When** abre el selector de empresa, **Then** ve el listado con la empresa activa marcada; con una sola empresa, el selector se muestra sin opción de cambio.
4. **Given** el comportamiento actual (empresa activa, destinos del menú, menú de cuenta), **When** se aplica el nuevo aspecto, **Then** no cambia la lógica ni los permisos.

### User Story 4 - Temas de las tiendas públicas por empresa (DS-04, P1, talla M)

Como empresa del producto, quiero que mi tienda pública tenga su propia identidad visual, para que cada tienda se vea distinta del panel y de las demás.

**Why this priority**: P1; las tiendas públicas llegan con la épica de Tiendas online (pendiente de confirmar si DS-04 entra junto con ella).

**Independent Test**: Renderizar dos tiendas con identidades distintas (p. ej. Mundo JC y San Javucho) y comprobar que cada una aplica su tipografía y colores sin afectar el tema del panel.

**Acceptance Scenarios**:

1. **Given** una empresa con identidad visual propia, **When** se renderiza su tienda pública, **Then** usa sus tipografías y colores (Mundo JC: Barlow Condensed para títulos y Barlow para texto).
2. **Given** dos empresas con identidades distintas, **When** se ven sus tiendas, **Then** cada una muestra la suya sin mezclar estilos.
3. **Given** el panel y una tienda pública, **When** se comparan, **Then** el tema del panel (Sora/Instrument Sans, azul `#2B55E6`) no se altera por el tema de la tienda.
4. **Given** la identidad visual de la empresa, **When** se configura, **Then** la configuración vive en Empresa · Identidad visual (pantalla de otra épica); esta historia solo define cómo un tema por empresa se aplica a las tiendas.

### Edge Cases

- Una empresa sin identidad visual configurada: la tienda usa un tema por defecto del sistema, sin romperse.
- Si algo del prototipo no se puede igualar con el template: usar lo más cercano y anotar la diferencia en el PR.
- Los valores observados en el prototipo "se confirman al definir los tokens": si al definirlos difieren, se documenta el valor final y la diferencia.
- Tipografías no disponibles: caer a la tipografía de sistema sin romper la maquetación.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** (DS-01): El panel DEBE tener tokens de diseño (colores, tipografías, espaciados, formas) definidos en un único lugar y aplicados como tema sobre el tema del template.
- **FR-002** (DS-01): Los títulos DEBEN usar Sora y el texto Instrument Sans.
- **FR-003** (DS-01): Los tokens iniciales DEBEN ser: azul de acción `#2B55E6` (hover `#1E3FB8`), texto `#15181D`, texto secundario `#5F6670`, bordes `#D9D8D2` y `#E6E5E0`, fondos `#F5F5F2` y `#EEEDE8`, peligro `#C62828`; botones de 38 px de alto y esquinas de 9 px (confirmables al definirlos).
- **FR-004** (DS-02): DEBE existir un conjunto de componentes base reutilizables, construidos sobre los componentes del template y los tokens, con sus estados.
- **FR-005** (DS-02): DEBE existir un catálogo documentado de componentes base y reglas de uso que las demás épicas deben seguir.
- **FR-006** (DS-03): El encabezado, el menú lateral y el selector de empresa del panel DEBEN usar el sistema de diseño sin cambiar su comportamiento.
- **FR-007** (DS-04): Las tiendas públicas DEBEN poder aplicar un tema propio por empresa (tipografías y colores) independiente del tema del panel.
- **FR-008** (todas): NO DEBE copiarse HTML ni CSS del prototipo; las pantallas nuevas DEBEN usar el sistema en lugar de replicar el prototipo.
- **FR-009** (todas): Las diferencias con el prototipo o contradicciones con los requisitos DEBEN anotarse en la descripción del PR.

### Key Entities

- **Tokens de diseño**: colores, tipografías, espaciados, formas y dimensiones de componentes del panel.
- **Tema del panel**: extensión del tema MUI/Refine del template que aplica los tokens.
- **Componente base**: componente reutilizable con variantes y estados documentados.
- **Tema de tienda por empresa**: identidad visual (tipografías, colores) de una empresa para su tienda pública; su configuración vive en Empresa · Identidad visual.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Los tokens existen en un único lugar y el tema del panel los aplica; ningún estilo base se define suelto en una pantalla.
- **SC-002**: El catálogo de componentes base está documentado con variantes, estados y reglas de uso.
- **SC-003**: Encabezado, menú lateral y selector de empresa usan el sistema y conservan su comportamiento; `pnpm test` verde.
- **SC-004**: Dos tiendas con identidades distintas se renderizan con su propio tema sin alterar el panel.
- **SC-005**: `pnpm lint`, `pnpm build` y `pnpm docs:check` verdes.

## Assumptions

- El prototipo es referencia visual; lo que debe cumplirse es la estética general que fija la épica.
- El sistema se construye sobre los componentes y el tema del template (MUI + Refine); no se copia HTML/CSS del prototipo.
- Los valores de los tokens son los observados en el prototipo y se confirman al definirlos.
- La identidad visual por empresa se configura desde Empresa · Identidad visual (otra épica); DS-04 solo cubre la aplicación del tema, no esa pantalla.
- Las pantallas de tienda pública (`MJC_*`, `SJ_*`) y el panel de identidad son referencia, no se implementan acá.
- Las claves Jira de las historias DS-01 a DS-04 todavía no existen; se usan los marcadores `DS-01`…`DS-04` hasta que se creen.
- Preguntas de planificación abiertas en Jira (horas, hito, si entra en diciembre, si DS-04 entra con Tiendas online) no bloquean esta spec.

## Trazabilidad Jira ↔ Historias de usuario ↔ Tareas

| Jira | US | Rel. Jira→US | Tareas | Rel. US→tareas |
|---|---|---|---|---|
| MSF-117 (epic) | US1–US4 | 1:N | — | — |
| DS-01 (por crear) | US1 — Tokens y tema del panel (P0) | 1:1 | T001–T005 | 1:N |
| DS-02 (por crear) | US2 — Componentes base y estados (P0) | 1:1 | T006–T012 | 1:N |
| DS-03 (por crear) | US3 — Estructura del panel (P0) | 1:1 | T013–T017 | 1:N |
| DS-04 (por crear) | US4 — Temas de tiendas por empresa (P1) | 1:1 | T018–T021 | 1:N |

Cobertura: FR-001/002/003 → US1; FR-004/005 → US2; FR-006 → US3; FR-007 → US4; FR-008/009 → transversal (T022–T023).
