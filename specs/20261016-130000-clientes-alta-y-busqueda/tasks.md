# Tasks: Clientes y proveedores · Clientes alta y búsqueda

**Input**: `specs/20261016-130000-clientes-alta-y-busqueda/` (spec.md, plan.md)

**Formato**: `- [ ] T### [P] [STORY-x][USy] descripción`. **[P]** = paralelizable (archivos distintos, sin dependencia; las [P] del mismo grupo van en paralelo); sin [P] = secuencial. Regla del proyecto: ninguna tarea queda `[ ]` al cierre — se hace con evidencia o se cierra con `[x]` + `Desvío:` y seguimiento trazado.

**Delivery scope**: `refine`, `supabase`

## Matriz de trazabilidad Jira ↔ US ↔ tasks

| Jira | Historia | Tasks |
|------|----------|-------|
| F-CLI-01 | US1 Alta y edición de cliente | T002, T004, T007, T009, T010, T011, T013, T015 |
| F-CLI-02 | US2 Listado y búsqueda | T005, T008, T012, T016, T019 |
| F-CLI-03 | US3 Tipo y Consumidor final | T003, T007, T008, T013 |
| F-CLI-04 | US4 Exportar clientes | T006, T008, T014, T016 |
| Tarea de cierre (label `cierre`) | Integración, datos de prueba, docs y cierre | T001, T017–T022 |

## Phase 1: Base de datos (supabase)

**Goal**: `clientes` extendida, con RLS por sección, Consumidor final, búsqueda y exportación en servidor.

- [ ] T001 [CIERRE] Inventariar consumidores de `public.clientes` (`clientes_identificadores_externos`, pruebas pgTAP, `App.tsx`, `lib/permisos.ts`) y re-verificar el esquema de cada tabla (sin tablas nuevas; `clientes` en `public` por excepción documentada); anotar el resultado en plan.md (Principio VII)
- [x] T002 [F-CLI-01][US1] Migración M1 `<ts>_clientes_ficha_y_numeracion.sql`: columnas de ficha y `archivado_en`/`updated_at`, backfill de `numero`, unicidad `(organizacion_id, numero)`, disparador de numeración con advisory lock, recorte/validación de `nombre`, unicidad de DNI/CUIT por organización (`private.documento_normalizado` + índice único parcial `clientes_org_documento_uq`, documento vacío → nulo), índices de búsqueda (btree y, si hay `pg_trgm`, GIN); reversión en el encabezado (FR-001, FR-002, FR-003, FR-006, FR-007, FR-015, FR-016)
- [ ] T003 [F-CLI-03][US3] Migración M2 `<ts>_clientes_tipo_y_consumidor_final.sql`: `tipo` (minorista/mayorista), `es_consumidor_final` con índice único parcial, backfill por organización, disparador en `organizaciones`, inmutabilidad del Consumidor final, `public.escala_de_cliente` con `revoke … anon`/`grant … authenticated` (FR-008, FR-009, FR-010, FR-013)
- [x] T004 [F-CLI-01][US1] Migración M3 `<ts>_clientes_rls_por_seccion_y_actividad.sql`: políticas con `nivel_seccion('clientes')` (sin DELETE), grants por columna que protegen `numero`/`es_consumidor_final`/`organizacion_id`, disparador de actividad (`cliente.creado/editado/archivado/restaurado`) sin datos de contacto (FR-003, FR-004, FR-005)
- [ ] T005 [F-CLI-02][US2] Migración M4 (parte 1) `public.buscar_clientes` (security invoker; escape de comodines; filtros tipo y archivados; paginación con total y tope de tamaño; grants) (FR-006, FR-007, FR-013)
- [ ] T006 [F-CLI-04][US4] Migración M4 (parte 2) `public.exportar_clientes` (security definer, exige `puede_accion('clientes','exportar')`, keyset, tope de lote y total; grants) (FR-011, FR-013)
- [x] T007 [P] [F-CLI-01][US1] pgTAP `clientes_alta_y_edicion.test.sql`: roles que editan vs. leen vs. `ninguno`; aislamiento entre organizaciones; archivar/restaurar con evento (y sin evento sin sesión); número correlativo sin duplicados en dos sesiones; columnas protegidas; DNI/CUIT repetido rechazado (otro formato, archivados, concurrencia), nombre repetido aceptado, mismo documento en otra organización aceptado; sin DELETE; `anon` sin acceso; Consumidor final inmutable y único por organización (SC-001, SC-003, SC-005, SC-007) Nota: sin Consumidor final (es de T003); pgTAP no corrido local (sin Docker), lo valida el CI — ver commit 24d01a1. Desvío: concurrencia (número en dos sesiones, DNI/CUIT simultáneo) no se ejercita en pgTAP (una sola sesión); la garantía es el advisory lock + índice único — seguimiento: test de concurrencia con dos conexiones.
- [ ] T008 [P] [F-CLI-02][US2] pgTAP `clientes_busqueda_exportacion.test.sql`: búsqueda parcial por nombre/documento/correo/teléfono/localidad/número, escape de `%`/`_`, tipo, archivados, paginación y total; `exportar_clientes` solo con permiso, keyset sin repetidos ni omisiones y tope; `escala_de_cliente` para minorista, mayorista, Consumidor final y ajeno (SC-002, SC-003, SC-004)
- [x] T009 [P] [F-CLI-01][US1] Ajustar y confirmar verdes `permisos_por_rol` (la aserción que fijaba `puede_escribir()` en clientes), `rls_en_toda_tabla`, `aislamiento_organizaciones`, `mapeo_identificadores_clientes` y el test de ejecutabilidad por `anon` con las RPC nuevas (FR-013, SC-005) Nota: ajustado `permisos_por_rol`; el resto no necesitó cambios; verdes a confirmar en el CI — ver commit 24d01a1.

**Checkpoint**: `pnpm test:db` (pgTAP) verde.

## Phase 2: Pantallas de Clientes (refine)

**Goal**: listado con búsqueda/filtros/paginación, ficha, alta/edición, archivado y exportación.

- [x] T010 [F-CLI-01][US1] `lib/permisos.ts`: quitar `clientes` de `RECURSOS_ESCRITURA_SOLO_ADMINISTRADOR`, `usePuedeAccion('exportar')` sobre el contexto de permisos; tests de `accessControl` actualizados (FR-004)
- [x] T011 [F-CLI-01][US1] `FormularioCliente` compartido por `create.tsx` y `edit.tsx` (campos, validación de nombre en el campo, error «Ya existe un cliente con ese DNI/CUIT» en el campo documento (FR-016), selector de tipo con explicación y aviso de cambio de tipo, error de servidor con reintento, envío deshabilitado mientras guarda, foco y accesibilidad) y ficha `show.tsx` + ruta `show` en `App.tsx`; confirmaciones «Cliente creado» / «Cliente guardado» (FR-001, FR-014) Desvío: sin selector de tipo (la columna `tipo` llega con M2/T003, F-CLI-03); archivar/restaurar vive en la ficha — ver commit 24d01a1.
- [ ] T012 [F-CLI-02][US2] `pages/clientes/list.tsx` + hook `useBuscarClientes`: buscador con espera, filtros Todos/Minorista/Mayorista y Activos/Archivados, paginación en servidor, total, estados vacío/sin resultados/error/carga compartidos, vista adaptable 320/768/1440 px (FR-006, FR-014)
- [ ] T013 [F-CLI-03][US3] Archivar/restaurar con confirmación del patrón compartido (idempotente) y presentación del Consumidor final sin «Editar»/«Archivar»; sin «Eliminar» en ninguna pantalla (FR-003, FR-009)
- [ ] T014 [F-CLI-04][US4] `lib/exportarClientes.ts` + botón «Exportar» (solo con acción `exportar`): lotes por `exportar_clientes`, `.xlsx` real (agregar la dependencia MIT con carga diferida y revisar su licencia con `supply-chain-security`), celdas como texto, neutralización de fórmulas, progreso, cancelación, confirmación y error con reintento (FR-011, FR-012)
- [x] T015 [P] [F-CLI-01][US1] Vitest del formulario, la ficha y el archivado/restauración: validación, tipo, doble envío, error de servidor, permisos de botones por rol, DNI/CUIT repetido (error en el campo) y nombre repetido (se guarda), Consumidor final sin acciones, textos del prototipo (SC-001, SC-007) Desvío: tipo/Consumidor final van con F-CLI-03; sin tests de `create.tsx`/`edit.tsx` (mensajes «Sin permiso», navegación) — seguimiento Jira.
- [ ] T016 [P] [F-CLI-02][US2] Vitest del listado y la exportación: búsqueda con espera, filtros combinados, paginación, vacío/sin resultados/error, escape de entrada, botón «Exportar» solo con permiso, lotes, `.xlsx` válido y reabrible, fórmulas neutralizadas, progreso y error (SC-002, SC-004)
- [ ] T017 [CIERRE] E2E «alta, búsqueda y exportación de un cliente» — si aún no hay suite Playwright de la app (MSF-499), cerrar con `[x]` + `Desvío:` y deuda trazada en MSF-499, nunca `[ ]` (SC-001)

**Checkpoint**: flujo completo operativo; `pnpm lint`, `pnpm build`, `pnpm test` verdes.

## Phase 3: Datos de prueba, documentación y cierre

- [ ] T018 [P] [CIERRE] `docs/clientes.md` (modelo, permisos, Consumidor final, `escala_de_cliente` como contrato, búsqueda, exportación, reversión) y actualización de `docs/permisos-por-rol.md` y `docs/aislamiento-por-organizacion.md` (Principio VIII)
- [ ] T019 [F-CLI-02][US2] Datos de prueba: seed local de ~5.000 clientes mixtos (tipos, archivados, tildes) y evidencia (`EXPLAIN`) de que la búsqueda y la paginación usan índices; ajustar M1 si no (SC-002)
- [ ] T020 [CIERRE] Revisión de seguridad (`authz-security`, `database-reviewer`) de RLS, `exportar_clientes` y disparadores; validación final `pnpm lint && pnpm build && pnpm test && pnpm docs:check`; anotar en el PR las contradicciones con el prototipo (Eliminar vs. archivar, Tiendas, Tipos de cliente, Importar/Etiquetas/Ranking/Correo fuera de alcance) y la matriz de Depósito (SC-006)
- [ ] T021 [CIERRE] Abrir el seguimiento trazado (Tarea `seguimiento` en Jira) para trasladar `public.clientes` a `dominio`; anotar el link en esta tarea
- [ ] T022 [CIERRE] Al merge del PR (merge commit `--no-ff`): actualizar la fila de `docs/roadmap-template.md` (paso manual) y comprobar que ninguna tarea queda `[ ]`

## Dependencias

T001 → T002 → T003 → T004 → T005 → T006 → (T007 [P], T008 [P], T009 [P]) → T010 → T011 → T012 → T013 → T014 → (T015 [P], T016 [P]) → T017 → (T018 [P], T019) → T020 → T021 → T022. T018 puede arrancar en paralelo con la Fase 2 una vez cerrada la T006.
