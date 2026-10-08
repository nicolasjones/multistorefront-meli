# Tasks: Kit de panel operable

**Nota de ejecución**: esta spec se implementó de una sola vez, portando un
patrón de navegación/presentación ya validado en producción en un producto
derivado real, en vez de construirlo incrementalmente tarea por tarea. Las
tareas quedan documentadas y marcadas como completadas para trazabilidad,
mismo criterio que la spec 017 (blindaje de imágenes de workers).

## Fase 1 — Contexto de panel

- [X] T001 Migración `contexto_panel_actual()` (`security definer`, sin
      parámetros, deriva de `private.is_superadmin/organizacion_id/rol_id/puede_escribir`).
- [X] T002 `ContextoPanelProvider`/`useContextoPanel`: cachea el contexto,
      invalida en un único punto (cambio de organización).
- [X] T003 pgTAP: permisos de la RPC nueva (revocada de `anon`, ejecutable
      solo por `authenticated`), sin exponer datos de otra organización.

**Checkpoint**: el contexto de panel resuelve superadmin/organización/rol sin
duplicar consultas.

## Fase 2 — Navegación declarativa

- [X] T004 `destinosPanel.ts`: tipos `AudienciaDestino`/`DestinoPanel`/
      `SeccionPanel` + `destinoVisible`.
- [X] T005 `SECCIONES_PANEL` con los recursos existentes del template,
      agrupados en Inicio/Operación/Configuración/Plataforma por audiencia.
- [X] T006 `SiderPanel`: acordeón por sección, filtrado por `destinoVisible`,
      íconos decorativos para el lector de pantalla.
- [X] T007 `EncabezadoPanel` + `MenuCuenta`: header fijo con el menú de
      cuenta separado del menú de navegación principal.
- [X] T008 Reemplazar `SiderConSeccionesSuperadmin` por `SiderPanel`/
      `EncabezadoPanel` en `App.tsx`, envolviendo las rutas en
      `ContextoPanelProvider`. Ninguna URL existente cambia.

**Checkpoint**: cada audiencia ve solo sus secciones; el menú de cuenta vive
aparte del sider.

## Fase 3 — Identidad de presentación

- [X] T009 `IdentidadVisible` + `resolverNombreVisible` +
      `CopiarIdentificadorTecnico` (componente de presentación, sin acoplar
      a ninguna tabla de negocio).
- [X] T010 Tests de `IdentidadVisible`: nombre completo, parcial, perfil sin
      completar, eliminado, sistema, organización no disponible.

**Checkpoint**: ninguna superficie de este kit muestra un UUID como texto
principal.

## Fase 4 — Estados y contenido adaptable

- [X] T011 `EstadosPagina` (carga, vacío, error con reintentar, éxito).
- [X] T012 `EncabezadoPagina` (título, descripción, acción, contexto).
- [X] T013 `ContenidoAdaptable` (tabla ≥600px, tarjeta <600px, mismas
      columnas y acciones).
- [X] T014 `ContenedorSeccion` (contorno visual contenido).
- [X] T015 `ContextoOrganizacionActiva` (texto de contexto de organización
      para `EncabezadoPagina`).

**Checkpoint**: el kit completo compila, lintea y pasa sus tests de Vitest y
pgTAP contra el esquema real del template.

## Nota de desvío

Se excluyó explícitamente la resolución de actor de ejecución
(`actorEjecucion.ts`/`resolver_actores_ejecucion` del producto derivado de
origen) por estar acoplada a un diseño de tabla `ejecuciones` todavía sin
reconciliar entre este template (spec 016) y ese producto — ver nota de
alcance en spec.md.
