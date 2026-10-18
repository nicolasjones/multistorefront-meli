# Feature Specification: Plataforma · Actividad y ambientes

**Feature Branch**: `epic/MSF-455-plataforma-actividad-y-ambientes`

**Jira Epic**: MSF-455 — Plataforma · Actividad y ambientes (spec `actividad-y-ambientes`)

**Created**: 2026-10-16

**Status**: Ready for implementation — la especificación viene completa desde Jira. Los puntos de «A revisar» no bloquean (ver *Decisiones abiertas*).

**Delivery scope**: `refine` (apps/web), `supabase` (migración + RPC + pgTAP) y CI/infra del repositorio (F-OPS-02: adopción y verificación, sin código nuevo de plataforma). Sin `kestra`, `superset` ni `workers`.

**Prioridad / Hito**: P0 · Hito 1 (6 al 30 de octubre de 2026) · ~18 h (F-AUD-01 ≈ 14 h, F-OPS-02 ≈ 4 h) · alcance diciembre. Ante conflicto de horas manda el roadmap.

**Dependencias**:
- Bloqueada por: MSF-125 (Acceso, organización y permisos · Usuarios y roles): trae `permisos_rol` y `private.nivel_seccion` — ya en `main` (`docs/permisos-por-rol.md`; la sección `actividad` ya está en la matriz).
- Bloquea a: MSF-456 (Catálogo · alta y edición), que registra `producto.creado` y demás eventos de producto. Los eventos de los otros componentes se enchufan a esta tabla por la cadena de sus propias épicas.
- Relacionada, sin bloqueo: MSF-457 (Operación, copias y documentación) usa los ambientes de F-OPS-02; MSF-117 (Sistema de diseño) define la estética de la pantalla Actividad.

**Input**: Epic MSF-455. Objetivo: «Al terminar, el administrador y el operador pueden ver en el panel qué pasó en el sistema, quién lo hizo y cuándo; todos los demás componentes ya tienen dónde registrar sus eventos; y todo cambio llega a producción pasando antes por un ambiente de prueba.»

**Regla de fuentes** (literal de la épica):
- Comportamiento y datos: mandan los requisitos y escenarios de esta spec.
- Qué se ve: el prototipo validado es la referencia visual y hay que ser lo más fiel posible (no se exige idéntico al pixel; lo que aún no se construye o queda fuera de alcance se anota, no se omite); los flujos aclaran estados y acciones.
- Cómo se construye: mandan el template y el sistema de diseño (MSF-117, `docs/sistema-de-diseno.md`). No copiar HTML ni CSS del prototipo.
- El prototipo muestra más que esta historia: solo se implementa lo que piden estos requisitos.
- Si algo no se puede igualar con el template / sistema de diseño: usar lo más cercano, sin inventar, y anotar la diferencia en el PR.
- Si prototipo y requisitos se contradicen: requisitos para el comportamiento, prototipo para lo visual, y anotar la contradicción en el PR.

**Prototipo**: la rama `design/prototipo` no existe en `origin` en este momento; se tomó `design/pantallas/Actividad.dc.html` del árbol de trabajo (solo lectura, sin modificar ni commitear). Muestra: título «Actividad / historial», filtro de tienda (Todas / San Javucho / Mundo JC), chips de período («Últimos 7 días») y de usuario («Todos los usuarios»), búsqueda «Buscar en la actividad», tabla Cuándo · Tipo · Tienda · Detalle · Quién, paginación («1–10 de 842») y un botón «Exportar».

## Modelo y supuestos

- El historial de la organización incluye a **todas sus empresas**.
- **El Operador ve todos los eventos**, también los de usuarios y permisos (a confirmar con el cliente). La matriz actual ya da `edicion` al Administrador y `lectura` al Operador sobre la sección `actividad`; el acceso se rige por `private.nivel_seccion('actividad')` (`lectura` o `edicion` ven; `ninguno` no).
- La hora se muestra en **America/Argentina/Buenos_Aires**.
- Hasta que lleguen los otros componentes, la pantalla se prueba con el **seed** y con los **eventos propios del componente de Acceso**.
- El registro es **solo de agregado**: nadie edita ni borra eventos desde la app.
- Los eventos de empresa ya emitidos por el frontend (`empresa.actualizada`, `empresa.pausada`, `empresa.reactivada`, ver `docs/empresas.md`) usan un punto de emisión (`apps/web/src/lib/eventosActividad.ts`) pensado para este destino; se enchufan registrando el destino, sin tocar a quien emite.
- F-OPS-02: el template **ya trae** el CI con promoción de staging a producción (spec `20261003-105444-cicd-staging-produccion`, `docs/adoptar-cicd-staging-produccion.md`) y el aislamiento por organización; la historia se reduce a **adoptarlo y verificarlo** en este producto. No crea mecanismos nuevos.

### Esquema de datos (Constitución, Principio VII)

| Tabla | Esquema | Justificación | RLS |
|-------|---------|---------------|-----|
| `registro_actividad` (nueva) | **`public`** | Registro transversal de plataforma: lo escriben todos los componentes y no es una entidad de negocio del producto (igual que `eventos_membresia`, `eventos_features`). | **Sí**, por organización con `private.organizacion_id()` y `private.nivel_seccion('actividad')`. **Sin policies de INSERT/UPDATE/DELETE** para `authenticated`; sin privilegios para `anon`. Escritura solo por la función de registro. |

Migración **aditiva** (tabla + índices + funciones); reversión en `plan.md`. Se re-verifica el esquema en spec, plan, tareas, implementación y PR.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Actividad e historial (F-AUD-01, P0, talla M)

Como administrador u operador, quiero ver en el panel qué pasó en el sistema, quién lo hizo y cuándo, para entender los cambios sin pedírselos a nadie.

**Why this priority**: es el objetivo visible de la épica y habilita que los demás componentes registren eventos.

**Independent Test**: con el seed (y los eventos propios de Acceso) cargados en dos organizaciones, el administrador de cada una ve solo su historial, filtra por período, empresa, usuario y tipo, busca por texto y pagina; un rol sin acceso no ve la sección.

**Acceptance Scenarios**:

1. **Given** el menú del panel, **Then** existe el destino «Actividad» (sección `actividad`), visible solo con `lectura` o `edicion`, y la ruta `/actividad` queda protegida por `RequiereAccesoSeccion`.
2. **Given** un administrador u operador, **When** abre Actividad, **Then** ve un listado ordenado del más reciente al más antiguo con **Cuándo** (hora de Buenos Aires), **Tipo**, **Tienda/empresa** (o «Compartido» si no aplica), **Detalle** y **Quién**.
3. **Given** el listado, **When** filtra por **período**, por **usuario** y/o por **tipo**, **Then** se muestran solo los eventos que cumplen todos los filtros combinados y el total/paginación se actualizan.
4. **Given** el listado, **When** escribe en «Buscar en la actividad», **Then** se filtra por coincidencia de texto en el detalle (sin distinguir mayúsculas/acentos de forma razonable) combinada con los filtros.
5. **Given** más eventos que el tamaño de página, **Then** hay paginación con rango y total («1–10 de N») y navegación anterior/siguiente.
6. **Given** una organización con varias empresas, **Then** el historial incluye los eventos de todas sus empresas; hay un **filtro por empresa/tienda** (Todas / una empresa) que se combina con los demás filtros (confirmado por Nicolás, 2026-10-15).
7. **Given** cualquier perfil, **Then** lo que ve y puede hacer en Actividad lo fija únicamente la matriz de permisos (`nivel_seccion('actividad')`): `lectura`/`edicion` ven todos los eventos de la organización (el Operador, con `lectura`, también los de usuarios y permisos); `ninguno` no ve nada. Si la matriz cambia, la pantalla y la RLS siguen a la matriz sin tocar código (confirmado por Nicolás, 2026-10-15).
8. **Given** un usuario con `ninguno` en `actividad` (consulta, mostrador, depósito, administración), **Then** no ve el menú, la ruta lo redirige y la consulta directa a `registro_actividad` devuelve cero filas.
9. **Given** dos organizaciones, **Then** ninguna ve ni cuenta eventos de la otra (RLS), ni siquiera con filtros o búsqueda manipulados.
10. **Given** otro componente, **When** registra un evento (tipo, detalle, actor, empresa opcional) por la función de registro, **Then** queda guardado con la organización del servidor, el actor autenticado y la fecha del servidor; no puede registrar en otra organización ni como otro usuario.
11. **Given** un evento de Acceso (p. ej. cambio de rol, invitación, suspensión), **Then** aparece en el listado con su tipo, detalle y actor.
12. **Given** el listado sin eventos (o sin resultados con los filtros), **Then** se muestra el estado vacío del patrón compartido; **Given** una falla de carga, **Then** el estado de error con reintento; mientras carga, el estado de carga. Utilizable con teclado y lector de pantalla a 320, 768 y 1440 px.
13. **Given** el registro, **Then** nadie puede editar ni borrar eventos desde la app (ni siquiera el administrador).

---

### User Story 2 - Ambientes y despliegue controlado (F-OPS-02, P0, talla M)

Como equipo, queremos que todo cambio llegue a producción pasando antes por un ambiente de prueba, para no romper producción.

**Why this priority**: es la segunda mitad del objetivo; garantiza el camino seguro a producción.

**Independent Test**: un cambio de prueba pasa de staging a producción por el flujo de CI; producción se rechaza si staging no corrió para el mismo commit.

**Acceptance Scenarios**:

1. **Given** el repositorio de este producto, **Then** existen y están configurados los GitHub Environments de staging y producción (`migraciones-cloud-*`, `deploy-infraestructura-vps-*`, `publicar-flows-kestra-*`) según `docs/adoptar-cicd-staging-produccion.md`. Supabase es **siempre self-hosted** (constitución v1.8.0): staging y producción son dos instancias de Postgres/Supabase en nuestro VPS, y el secreto `SUPABASE_DB_URL` de cada Environment apunta a ellas.
2. **Given** un cambio en `supabase/migrations/**`, **When** se integra, **Then** se aplica primero a staging y recién después se puede promover a producción.
3. **Given** una promoción a producción sin ejecución exitosa de staging para el mismo commit, **Then** el flujo la rechaza antes de tocar cualquier secreto (`scripts/verificar-staging-exitoso.mjs`).
4. **Given** el aislamiento por organización del template, **Then** staging y producción no comparten datos ni secretos.
5. **Given** un cambio de prueba (inocuo), **When** se promueve por el flujo, **Then** queda evidencia de que pasó por staging y llegó a producción; el procedimiento queda documentado.

---

### Edge Cases

- Evento sin empresa: se muestra «Compartido» en la columna de tienda.
- Actor eliminado o evento del sistema (sin actor): se muestra «Sistema»; el registro conserva el actor por id, sin exponer UUID como identidad visible.
- Eventos a medianoche / cambio de día: el período y el «Hoy/Ayer» se calculan en America/Argentina/Buenos_Aires, no en UTC.
- Texto de búsqueda con comodines (`%`, `_`) o muy largo: se trata como literal y se acota.
- Muchos eventos (decenas de miles por organización): la consulta usa índices y paginación en servidor; nunca trae todo al navegador.
- Escritura concurrente de eventos: no hay conflicto (solo agregado).
- Un destino de actividad que falla no revierte la operación de origen (contrato ya vigente en `eventosActividad.ts`).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** (F-AUD-01): tabla `public.registro_actividad` con al menos organización, empresa (opcional), actor, tipo, detalle y fecha del servidor; con RLS por organización y por `nivel_seccion('actividad')`; solo de agregado.
- **FR-002**: función de registro para los demás componentes (`private.registrar_actividad`, y su exposición controlada para el frontend) que fija organización y actor en el servidor, valida tipo/detalle y nunca ejecutable por `anon`.
- **FR-003**: pantalla «Actividad» (`/actividad`) con listado, filtros por período, empresa, usuario y tipo, búsqueda por texto y paginación en servidor.
- **FR-004**: hora mostrada en America/Argentina/Buenos_Aires.
- **FR-005**: todos los perfiles se adaptan a la matriz de permisos (`nivel_seccion('actividad')`); hoy Administrador (`edicion`) y Operador (`lectura`) ven todos los eventos, incluidos los de usuarios y permisos.
- **FR-006**: el historial de la organización incluye a todas sus empresas.
- **FR-007**: enchufar al destino los eventos propios de Acceso y los de empresa ya emitidos, y proveer un seed para probar la pantalla.
- **FR-008**: destino de menú «Actividad» con icono, ruta canónica, `seccionPermiso: 'actividad'`, entrada en `SECCION_POR_RECURSO` y guard de ruta (Principio VI); estados de carga/vacío/error/éxito compartidos; 320/768/1440 px; sin identificadores técnicos como identidad visible.
- **FR-009** (F-OPS-02): adoptar y verificar el CI de promoción staging → producción y el aislamiento del template en este producto, y documentar el procedimiento. Supabase es siempre self-hosted: los nombres `migraciones-cloud*` / `db:migrar:cloud` heredados del template son solo etiquetas; la verificación confirma que apuntan a instancias self-hosted y documenta la diferencia de nombre. No se crean proyectos ni se usa la Management API de Supabase Cloud.
- **FR-010**: documentación en `docs/` (contrato de registro de actividad para otros componentes y verificación de ambientes), Principio VIII.

### Fuera de alcance / no objetivos

- Detalle del registro con valor anterior y nuevo (F-AUD-02/03): no está dibujado ni pedido aquí; si se agrega después, será una migración aditiva.
- Botón «Exportar» y datos de otros componentes (productos, stock, importaciones, cotización, stores): los traen sus propias épicas.
- Registrar `producto.creado` y demás eventos de producto (MSF-456) y los de otros componentes.
- Mecanismos nuevos de CI/despliegue: se adopta lo que el template ya trae.
- Supabase Cloud en cualquier forma (proyectos, Management API, hooks de Cloud): no se usa; todo rige en el Supabase self-hosted.
- Operación, copias y documentación (MSF-457); sistema de diseño (MSF-117).

## Decisiones abiertas (no bloquean)

- **Operador ve usuarios y permisos**: resuelto — todos los perfiles siguen la matriz; el Operador (`lectura`) ve todo. Si el cliente lo niega, se ajusta la matriz.
- **Horas**: 18 h del documento; el roadmap a diciembre no lista esta épica por separado y manda ante conflicto.
- **Filtro de empresa**: resuelto — sí, se incluye (el historial sigue siendo de toda la organización).
- **«Exportar»** del prototipo: no figura en los requisitos; queda fuera.
- **Estructura de `tipo`**: formato `entidad.accion` (p. ej. `producto.creado`, `empresa.pausada`); catálogo de tipos para el filtro se deriva de los eventos existentes.

## Success Criteria

- **SC-001**: el administrador y el operador ven el historial de su organización con filtros, búsqueda y paginación (E2E del listado con filtros).
- **SC-002**: pgTAP de aislamiento entre dos organizaciones sobre `registro_actividad` (y `rls_en_toda_tabla` verde).
- **SC-003**: pgTAP de permisos por rol sobre `registro_actividad`: administrador y operador leen; los demás roles no; nadie escribe/edita/borra por API directa; `anon` sin acceso.
- **SC-004**: un cambio de prueba pasa de staging a producción por el flujo de CI y producción rechaza un commit sin staging verde.
- **SC-005**: otro componente puede registrar un evento con una llamada y aparece en la pantalla.

## Matriz de trazabilidad Jira ↔ US ↔ FR

| Jira | Historia | FR | Escenarios / SC |
|------|----------|----|-----------------|
| MSF-455 (épica) | Docs y cierre | FR-010 | SC-001…005 |
| F-AUD-01 | US1 Actividad e historial | FR-001…008 | US1 · SC-001, 002, 003, 005 |
| F-OPS-02 | US2 Ambientes y despliegue controlado | FR-009 | US2 · SC-004 |
