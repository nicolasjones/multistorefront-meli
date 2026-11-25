# Feature Specification: Acceso, organización y permisos · Alta de empresas

**Feature Branch**: `epic/MSF-475-acceso-organizacion-y-permisos-alta-de-e`

**Jira Epic**: MSF-475 — Acceso, organización y permisos · Alta de empresas (spec `alta-de-empresas`)

**Created**: 2026-10-15

**Status**: Ready for implementation — la especificación viene completa desde Jira. Los puntos de "A revisar" no bloquean (ver *Decisiones abiertas*).

**Delivery scope**: `refine` (apps/web) y `supabase` (migración + RPC + pgTAP). Sin `kestra`, `superset` ni `workers`.

**Prioridad / Hito**: P0 (antes P1) · Hito 1 (adelantada desde Etapa 2 por pedido del cliente) · ~8 h (talla M) · alcance diciembre.

**Dependencias**:
- Bloqueada por: MSF-138 (Empresas: listado, datos generales y activar tienda) — la empresa nueva copia esa configuración; ya está en `main` (`dominio.empresas`, `pages/empresas`).
- Bloquea a: ninguna épica.
- Relacionada, sin bloqueo: MSF-121 (Permisos por empresa): el Administrador accede a las empresas nuevas automáticamente.

**Input**: Epic MSF-475. Objetivo: «Al terminar, el administrador puede dar de alta una empresa nueva dentro de su organización, copiando la configuración de otra, sin armar todo de cero.»

**Regla de fuentes**:
- Comportamiento y datos: mandan los requisitos y escenarios de esta spec.
- Qué se ve: el prototipo (rama `design/prototipo`, `Stores.dc.html`) es referencia visual; la estética sale del sistema de diseño (MSF-117, `docs/sistema-de-diseno.md`). No copiar HTML ni CSS. La rama `design/prototipo` no está en `origin` en este momento: se tomó la pantalla de `design/pantallas/Stores.dc.html` del árbol de trabajo (solo lectura, sin modificar).
- El prototipo muestra más que esta historia (columnas Publicada / Vence en 5 días / «Ver tienda» / «Configurar», bloque «Cómo se organiza»): solo se implementa lo que pide F-EMP-03.
- Si el prototipo y los requisitos se contradicen: requisitos para el comportamiento, prototipo para lo visual, y se anota en el PR.

## Modelo y supuestos

- Se copian **reglas de precio, configuración de tienda y reglas de Mercado Libre**; **no** se copian dominio ni cuentas.
- La empresa nueva queda **sin tienda publicada y sin cuenta de Mercado Libre**. Término único en la interfaz: **«borrador»** (el prototipo dice «Empresa creada como borrador»).
- Catálogo, stock, clientes y proveedores son de la organización y se **comparten** entre empresas: no se duplican.
- Hoy `dominio.empresas` solo guarda datos generales (nombre, contacto, `activa`). Las reglas de precio, la configuración de tienda y las reglas de Mercado Libre pertenecen a épicas que aún no tienen tabla (Precios, Tiendas online, Mercado Libre). Por eso la copia se implementa como **punto de extensión** (`private.copiar_configuracion_empresa`) que cada una de esas épicas completa con sus tablas; esta épica copia lo que existe hoy y deja el contrato probado. Si al implementar ya existiera alguna tabla de configuración por empresa, se incluye en la copia.
- Multitienda por diseño (MSF-138): nada asume exactamente dos empresas.
- Acceso del Administrador a la empresa nueva: hoy no existe aislamiento entre empresas (lo agrega MSF-121); toda persona de la organización ve las empresas de su organización por RLS, de modo que el Administrador accede a la nueva sin pasos extra. Esta épica no crea permisos por empresa.
- Navegación: «Empresas» ya existe en el menú (grupo «Operación» hoy). No se toca el menú; solo se agrega el botón y el diálogo a la pantalla existente.

### Esquema de datos (Constitución, Principio VII)

| Tabla | Esquema | Justificación | RLS |
|-------|---------|---------------|-----|
| `empresas` (existente, MSF-138) | **`dominio`** | Entidad de negocio (quién vende). Se agrega un índice único `(organizacion_id, lower(btrim(nombre)))` para el nombre repetido. | Ya activa. **Sin política INSERT** para `authenticated`: el alta es solo por la RPC `public.crear_empresa` (security definer, con `private.puede_escribir()`), igual que `actualizar_organizacion`. |

No se crean tablas nuevas. Migración **aditiva** (índice + funciones); reversión en `plan.md`. Cualquier tabla de configuración que sumen las épicas futuras declara su propio esquema (`dominio`) y RLS.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Crear una empresa nueva (F-EMP-03, MSF-277, P0, talla M)

Como administrador, quiero crear una empresa nueva copiando la configuración de otra, para no armar todo de cero.

**Why this priority**: Es la única historia de la épica y cumple el objetivo completo.

**Independent Test**: Con San Javucho y Mundo JC cargadas, el administrador crea «Tienda Oeste» copiando de Mundo JC; aparece en el listado como borrador, sin tienda publicada ni cuenta de Mercado Libre; un miembro no puede crearla.

**Acceptance Scenarios** (CA-EMP-03-1…3 de la épica; los dos últimos no están dibujados en el prototipo):

1. **CA-EMP-03-1** — **Given** la pantalla Empresas con al menos una empresa, **When** el administrador pulsa «Nueva empresa» (botón arriba a la derecha) o «Crear» en la fila final «Nueva empresa», **Then** se abre el diálogo «Nueva empresa» con el campo Nombre (placeholder «Ej.: Tienda Oeste»), el selector «Copiar configuración de» (ayuda: «Precios, tienda web y reglas de Mercado Libre se copian como punto de partida.») y los botones Cancelar y «Crear empresa».
2. **Given** un nombre válido y una empresa de origen elegida, **When** pulsa «Crear empresa», **Then** se crea una empresa de la misma organización con ese nombre, se copian las reglas de precio, la configuración de tienda y las reglas de Mercado Libre del origen (no dominio ni cuentas), el diálogo se cierra, el listado la muestra y aparece «Empresa creada como borrador».
3. **Given** la empresa recién creada, **Then** queda sin tienda publicada y sin cuenta de Mercado Libre, y comparte catálogo, stock, clientes y proveedores de la organización (no se duplican).
4. **CA-EMP-03-2** — **Given** que ya existe una empresa con ese nombre en la organización (sin distinguir mayúsculas ni espacios al borde), **When** intenta crear, **Then** el diálogo muestra el error en el campo Nombre y no crea nada; dos altas simultáneas con el mismo nombre no producen duplicados.
5. **Given** un nombre vacío o solo espacios, **When** intenta crear, **Then** se indica el error en el campo y no se crea.
6. **CA-EMP-03-3** — **Given** una organización sin ninguna empresa de origen posible, **When** se abre el diálogo, **Then** «Copiar configuración de» se muestra deshabilitado con un mensaje de que no hay empresa de la que copiar, y se puede crear la empresa igual (sin configuración copiada).
7. **Given** que el administrador elige «sin copiar» (opción vacía del selector) con empresas existentes, **Then** se crea la empresa sin configuración copiada. *(Opción mínima de la lista del selector; ver Decisiones abiertas.)*
8. **Given** el administrador de una organización, **When** la empresa nueva se crea, **Then** puede abrirla y editarla desde el listado y el selector de empresa sin ningún paso adicional de acceso.
9. **Given** un usuario sin permiso de escritura (miembro/operador/consulta/suspendido), **Then** no ve «Nueva empresa» ni «Crear», y la RPC lo rechaza aunque la llame directo.
10. **Given** un origen de otra organización (id manipulado), **Then** la RPC lo rechaza y no crea nada (aislamiento).
11. **Given** que la creación falla (red, servidor), **Then** el diálogo muestra el error con la posibilidad de reintentar, conserva lo escrito y no deja una empresa a medias (alta y copia son atómicas).
12. **Given** un fallo parcial en la copia, **Then** la transacción se revierte completa (no queda empresa sin su configuración).

---

### Edge Cases

- Doble clic en «Crear empresa»: el botón queda deshabilitado mientras envía; el índice único evita el duplicado.
- Origen pausada: se puede copiar de una empresa pausada; la nueva nace con el estado por defecto de `activa` (la «Activa/Pausada» de MSF-138 no se reinterpreta).
- Nombre con espacios al borde: se guarda recortado.
- La empresa de origen se edita o se pausa mientras se abre el diálogo: se copia el estado vigente en el momento de crear.
- Pantallas angostas (320 px): el diálogo es utilizable y el botón «Nueva empresa» sigue accesible.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE ofrecer la RPC `public.crear_empresa(p_nombre, p_copiar_de)` como único camino de alta; la organización la resuelve el servidor (`private.organizacion_id()`), nunca el llamador; exige `private.puede_escribir()`.
- **FR-002**: La RPC DEBE recortar y validar el nombre (no vacío) y rechazar un nombre repetido dentro de la organización sin distinguir mayúsculas/minúsculas, con un error que la interfaz traduce al campo Nombre; la unicidad DEBE garantizarla un índice único (no solo una consulta previa) para cubrir la concurrencia.
- **FR-003**: Si se indica origen, la RPC DEBE verificar que pertenece a la misma organización y copiar al destino, en la misma transacción, las reglas de precio, la configuración de tienda y las reglas de Mercado Libre — **sin dominio ni cuentas** — mediante `private.copiar_configuracion_empresa(origen, destino)`.
- **FR-004**: La empresa nueva DEBE quedar sin tienda publicada y sin cuenta de Mercado Libre, sin duplicar catálogo, stock, clientes ni proveedores.
- **FR-005**: La RPC DEBE tener `revoke … from public, anon` y `grant execute … to authenticated` explícitos (constitución del proyecto; el test pgTAP de `anon` debe seguir verde).
- **FR-006**: La pantalla Empresas DEBE mostrar, solo a quien puede escribir, el botón «Nueva empresa» y la fila final «Nueva empresa» con «Crear», que abren el diálogo de F-EMP-03; el resto de las secciones del prototipo no se implementan.
- **FR-007**: El diálogo DEBE seguir el texto del prototipo (título, placeholder, ayuda, botones), validar el nombre en el campo, mostrar el error de nombre repetido, el estado «sin empresa de origen» y el error de servidor con reintento, y confirmar con «Empresa creada como borrador».
- **FR-008**: El diálogo y la acción DEBEN usar el sistema de diseño (MSF-117) y los patrones compartidos de estados, funcionar con teclado y lector de pantalla (foco al abrir y al cerrar, etiquetas, errores asociados al campo) y en 320/768/1440 px, en español de Argentina, sin identificadores técnicos visibles.
- **FR-009**: La tabla `dominio.empresas` DEBE seguir sin política INSERT/DELETE para `authenticated`; el alta ocurre solo por la RPC. Aislamiento por organización verificado con pgTAP.
- **FR-010**: La copia DEBE ser un punto de extensión documentado: cada épica que agregue configuración por empresa (precio, tienda, Mercado Libre) la suma a `private.copiar_configuracion_empresa` y a su prueba, excluyendo dominio y cuentas.

### Fuera de alcance / no objetivos

- Importar empresas existentes («carga de empresas» masiva): hoy solo hay alta manual (ver Decisiones abiertas).
- Publicar la tienda, conectar cuentas de Mercado Libre, asignar dominio: son de Tiendas online / Mercado Libre.
- Permisos por empresa (MSF-121); borrar o archivar empresas.
- Evento de actividad `empresa.creada` hacia F-AUD-01: la épica no lo pide (ver Decisiones abiertas).
- Mover «Empresas» de grupo del menú.

## Decisiones abiertas (no bloquean)

1. **Término «borrador»**: se adopta «borrador» en la interfaz (sin agregar un estado nuevo en base: la empresa nueva nace con `activa` por defecto y se la distingue por no tener tienda ni cuenta, «Sin configurar»). Confirmar si «borrador» debe ser además un estado visible en la etiqueta del listado.
2. **Importar empresas existentes**: pendiente de confirmar con el cliente; fuera de esta spec.
3. **Copia hoy**: sin tablas de configuración todavía, la copia efectiva se limita a lo que exista al implementar; el resto se suma cuando nazcan esas tablas (FR-010).
4. **«Sin copiar»** (escenario 7) y **evento de actividad** `empresa.creada`: no están en la épica; se incluye la opción vacía del selector por coherencia con CA-EMP-03-3 y se deja el evento fuera salvo que Nicolás lo pida.
5. **Menú**: «Empresas» está en «Operación», no en «Canales» como indica la nota de Jira. No se mueve (no se pide); anotarlo en el PR.

## Success Criteria

- **SC-001**: el administrador crea una empresa copiando de otra y la ve en el listado como borrador (Vitest + pgTAP).
- **SC-002**: nombre repetido y nombre vacío se rechazan, también en altas simultáneas (pgTAP + Vitest).
- **SC-003**: miembro, operador, consulta y suspendido no pueden crear, ni por UI ni por RPC; un origen ajeno se rechaza (pgTAP).
- **SC-004**: la copia excluye dominio y cuentas, y alta + copia son atómicas (pgTAP).
- **SC-005**: `pnpm lint && pnpm build && pnpm test && pnpm docs:check` sin errores.

## Matriz de trazabilidad Jira ↔ US ↔ FR ↔ tareas

| Jira | Historia | CA | FR | Tareas |
|------|----------|----|----|--------|
| MSF-277 (F-EMP-03) | US1 Crear una empresa nueva | CA-EMP-03-1 | FR-006, FR-007, FR-008 | T005–T008, T010 |
| MSF-277 | US1 | CA-EMP-03-2 | FR-002, FR-007 | T001, T002, T003, T007, T009 |
| MSF-277 | US1 | CA-EMP-03-3 | FR-003, FR-007 | T004, T007 |
| MSF-277 | US1 | Supuestos de copia | FR-003, FR-004, FR-009, FR-010 | T002, T003, T004, T011 |
| MSF-475 (épica) | Cierre | — | Principio VIII | T012–T014 |
