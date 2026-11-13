# Feature Specification: Visor por componente, épica e historia

**Feature Branch**: `feat/023-visor-componentes`

**Created**: 2026-10-21

**Status**: Draft

**Input**: El visor muestra épicas sueltas y pelado. Se quiere navegar Componente → Épica → Historia y que se vea bien: cards con progreso, miniaturas, búsqueda y filtros.

**Alcance de entrega**: `refine` (ruta `/cobertura-e2e`).

## User Scenarios & Testing

### User Story 1 - Navegar por componente (Priority: P1)

Quien revisa cobertura entra al visor y ve los componentes de la app (p. ej. Acceso, Stock); dentro de cada uno, sus épicas; dentro de cada épica, sus historias con checklist y video.

**Independent Test**: Con `componente:` declarado en 3 specs, el visor agrupa Acceso → {MSF-119, MSF-121} y Stock → {MSF-136}.

**Acceptance Scenarios**:

1. **Given** specs con `**Componente**:` distinto, **When** abro `/cobertura-e2e`, **Then** veo una sección por componente con sus épicas.
2. **Given** una spec sin componente, **When** abro el visor, **Then** cae en "Sin clasificar" (no se pierde).

### User Story 2 - Ver qué mirar primero (Priority: P2)

Cada épica e historia muestra progreso (ítems cubiertos/total), conteo de videos y estado (cubierto / sin cubrir / fallido). Hay búsqueda por texto y filtro por estado.

**Independent Test**: Con el manifiesto del CI, la ficha de MSF-136 muestra 1 historia, su video y su checklist.

**Acceptance Scenarios**:

1. **Given** el manifiesto con fallidos y sin cubrir, **When** filtro por "fallido", **Then** solo veo lo fallido.
2. **Given** un video disponible, **When** miro la card, **Then** veo su miniatura (primer cuadro) sin descargar el video entero.

### User Story 3 - Probar el visor sin bucket (Priority: P3)

Si el bucket no tiene manifiesto (sin secretos de CI), el visor intenta `/cobertura-e2e.json` local (carpeta `public/`) y lo indica con una insignia; si tampoco hay, mantiene el vacío con instrucciones.

**Independent Test**: Con un manifiesto en `apps/web/public/cobertura-e2e.json` y sin bucket, el visor lo muestra marcado como local.

## Requirements

### Functional

- FR-001: `**Componente**: <Nombre>` en `spec.md` (junto a `**Jira Epic**:`); el manifiesto lo propaga por evidencia e ítem sin cubrir; sin línea cae en "Sin clasificar".
- FR-002: La lista agrupa Componente → Épica con barra de progreso, conteos y enlace a la ficha.
- FR-003: Buscador por texto (épica, historia, ítem, test) y filtro por estado.
- FR-004: La ficha de historia muestra miniatura del video (`preload="metadata"`, sin descarga completa) y reproductor bajo demanda como hoy.
- FR-005: Fuente de datos: bucket `latest/` primero, `/cobertura-e2e.json` local después, con insignia de origen; vacío con instrucciones si no hay ninguno.

### Non-Functional

- NFR-001: Sin identificadores técnicos como identidad visible (nombres primero, claves MSF como referencia).
- NFR-002: Carga diferida de videos (la miniatura no descarga el archivo entero).

## Modelo de datos (DER)

Sin cambios de esquema: el campo nuevo vive en `spec.md` (texto) y en el JSON del manifiesto (archivo en Storage). Sin migraciones.

## Success Criteria

- SC-001: Las 3 specs de ejemplo declaran componente y el manifiesto generado las agrupa.
- SC-002: El visor filtra, busca y muestra progreso + miniaturas.
- SC-003: `pnpm lint && pnpm build && pnpm test:web && pnpm docs:check` en verde.

## Matriz pantalla↔criterios

El visor no tiene prototipo en `design/pantallas` (es una pantalla interna de
desarrollo); la fuente de verdad es esta spec y `docs/e2e-app.md`.

| Elemento visible | Criterio |
| --- | --- |
| Título "Cobertura E2E" + corrida/fecha/modo + insignia de origen | FR-005 (bucket vs local) |
| Buscador por texto | FR-003 |
| Selector de estado (Todos / Cubierto / Sin cubrir / Fallido) | FR-003, US2-AC1 |
| Sección por componente con sus tarjetas de épica | FR-001, FR-002, US1-AC1 |
| Tarjeta: clave MSF, nombre, insignia de estado, barra de progreso, conteos | FR-002, US2-AC1 |
| Botón "Volver a componentes" | FR-002 (navegación) |
| Chips "Componente: …" y clave MSF en la ficha | FR-001 |
| Miniatura del video con botón "Ver video" | FR-004, US2-AC2, NFR-002 |
| Checklist de ítems con estado (hecho / pendiente / ambiguo / fallido / omitido) | US2 |
| Bloque "Ítems sin E2E" | FR-002 (progreso) |
| Vacío con instrucciones | FR-005, US3 |
